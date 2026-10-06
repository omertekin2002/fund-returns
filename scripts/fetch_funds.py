#!/usr/bin/env python3
"""Download fund returns from TEFAS and write them as JSON for the website.

Fetches the same data as the export on TEFAS > Fon Getirileri > Menkul Kıymet
Yatırım Fonları (https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT),
limited to funds traded on TEFAS (the page's default), plus each fund's daily
prices over the last four weeks from TEFAS > Fon Verileri, which the website
uses for the Sharpe ratio.

Usage: python3 scripts/fetch_funds.py [output_path]

Uses only the Python standard library so the workflow needs no install step.
The output file is only replaced after the response passes validation.
"""

import http.client
import json
import os
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

API_URL = "https://www.tefas.gov.tr/api/funds/fonGetiriBazliBilgiGetir"
PAGE_URL = "https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT"
PRICES_API_URL = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir"
PRICES_PAGE_URL = "https://www.tefas.gov.tr/tr/fon-verileri"
DEFAULT_OUTPUT = os.path.join(
    os.path.dirname(__file__), "..", "site", "data", "funds.json"
)

# Mirrors the request the TEFAS page makes for its default view.
PAYLOAD = {
    "dil": "TR",
    "fonTipi": "YAT",  # Menkul Kıymet Yatırım Fonları
    "islem": 1,  # 1 = traded on TEFAS, 0 = not traded on TEFAS
    "calismaTipi": 2,  # period-based returns (1M, 3M, ...) rather than a date range
    "kurucuKodu": None,
    "sfonTurKod": None,
    "fonTurAciklama": None,
    "fonTurKod": None,
    "fonGrubu": None,
    "donemGetiri1a": "1",
    "donemGetiri3a": "1",
    "donemGetiri6a": "1",
    "donemGetiri1y": "1",
    "donemGetiriyb": "1",
    "donemGetiri3y": "1",
    "donemGetiri5y": "1",
    "basTarih": None,
    "bitTarih": None,
    "getiriOrani": "1",
}

# Daily prices of every YAT fund over the last four weeks. TEFAS rejects
# ranges longer than one month, so this is a single request.
PRICE_WINDOW_DAYS = 28
# The price endpoint pages its rows; all funds over four weeks is ~41,000.
MAX_PRICE_ROWS = 100000
# Four weeks hold ~20 business days; a long holiday (Kurban Bayramı) removes
# up to ~7, so far fewer means the response is broken.
MIN_PRICE_DATES = 10
ISTANBUL = ZoneInfo("Europe/Istanbul")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.tefas.gov.tr",
}

# TEFAS field -> key used by the website.
RETURN_FIELDS = {
    "getiri1a": "1m",
    "getiri3a": "3m",
    "getiri6a": "6m",
    "getiri1y": "1y",
    "getiriyb": "ytd",
    "getiri3y": "3y",
    "getiri5y": "5y",
}
REQUIRED_FIELDS = ["fonKodu", "fonUnvan", "fonTurAciklama", *RETURN_FIELDS]
PRICE_FIELDS = ["fonKodu", "tarih", "fiyat"]

# There are ~1000 traded YAT funds; far fewer means the response is broken.
MIN_EXPECTED_FUNDS = 200

ATTEMPTS = 4
RETRY_DELAY_SECONDS = 20  # TEFAS rate-limits to a few requests per minute


def prices_payload(start, end):
    """Request body of the TEFAS > Fon Verileri page for all YAT funds."""
    return {
        "fonTipi": "YAT",
        "fonKodu": None,  # all funds
        "aramaMetni": None,
        "fonTurKod": None,
        "fonGrubu": None,
        "sfonTurKod": None,
        "fonTurAciklama": None,
        "kurucuKod": None,
        "basTarih": start.strftime("%Y%m%d"),
        "bitTarih": end.strftime("%Y%m%d"),
        "basSira": 1,
        "bitSira": MAX_PRICE_ROWS,
        "dil": "TR",
        "sFonTurKod": "",
        "fonKod": "",
        "fonGrup": "",
        "fonUnvanTip": "",
    }


def fetch_json(url, payload, referer):
    body = json.dumps(payload).encode("utf-8")
    headers = {**HEADERS, "Referer": referer}
    last_error = None
    for attempt in range(1, ATTEMPTS + 1):
        request = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        # OSError covers URLError/HTTPError, timeouts and dropped connections;
        # ValueError covers a non-JSON body such as a bot-protection page.
        except (OSError, http.client.HTTPException, ValueError) as exc:
            last_error = exc
            print(f"Attempt {attempt}/{ATTEMPTS} failed: {exc}", file=sys.stderr)
            if attempt < ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS * attempt)
    raise RuntimeError(f"Could not fetch data from TEFAS: {last_error}")


def to_number(value):
    if value is None or value == "":
        return None
    return float(value)


def to_risk(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def to_price(value):
    price = to_number(value)
    # TEFAS reports 0 for some days a fund has no price.
    return price if price else None


def result_rows(raw):
    if not isinstance(raw, dict):
        raise ValueError(f"Unexpected response type: {type(raw).__name__}")
    if raw.get("errorCode") or raw.get("errorMessage"):
        raise ValueError(
            f"TEFAS returned an error: {raw.get('errorCode')} {raw.get('errorMessage')}"
        )
    rows = raw.get("resultList")
    if not isinstance(rows, list):
        raise ValueError("Response has no resultList")
    return rows


def parse(raw):
    rows = result_rows(raw)
    funds = []
    for row in rows:
        missing = [field for field in REQUIRED_FIELDS if field not in row]
        if missing:
            raise ValueError(f"Fund row is missing fields {missing}: {row}")
        # islem=1 already limits the list to funds traded on TEFAS; this is a safeguard.
        if row.get("tefasDurum") is False:
            continue
        funds.append(
            {
                "code": row["fonKodu"],
                "name": row["fonUnvan"],
                "umbrella": row["fonTurAciklama"],
                "risk": to_risk(row.get("riskDegeri")),
                "returns": {
                    key: to_number(row[field]) for field, key in RETURN_FIELDS.items()
                },
            }
        )

    if len(funds) < MIN_EXPECTED_FUNDS:
        raise ValueError(
            f"Only {len(funds)} funds returned (expected at least {MIN_EXPECTED_FUNDS})"
        )
    funds.sort(key=lambda fund: fund["code"])
    return funds


def parse_prices(raw, codes):
    """Return the price dates and, per fund code, its price on each date.

    A fund's list has None for a date it has no price on.
    """
    rows = result_rows(raw)
    if len(rows) >= MAX_PRICE_ROWS:
        raise ValueError(f"{len(rows)} price rows returned; the list may be cut off")

    by_code = {code: {} for code in codes}
    dates = set()
    for row in rows:
        missing = [field for field in PRICE_FIELDS if field not in row]
        if missing:
            raise ValueError(f"Price row is missing fields {missing}: {row}")
        dates.add(row["tarih"])
        if row["fonKodu"] in by_code:
            by_code[row["fonKodu"]][row["tarih"]] = to_price(row["fiyat"])

    dates = sorted(dates)
    if len(dates) < MIN_PRICE_DATES:
        raise ValueError(
            f"Prices for only {len(dates)} dates returned (expected at least {MIN_PRICE_DATES})"
        )
    priced = sum(1 for prices in by_code.values() if any(prices.values()))
    if priced < MIN_EXPECTED_FUNDS:
        raise ValueError(
            f"Prices for only {priced} funds returned (expected at least {MIN_EXPECTED_FUNDS})"
        )
    return dates, {
        code: [prices.get(date) for date in dates] for code, prices in by_code.items()
    }


def render(funds, fetched_at, price_dates):
    header = {
        "fetchedAt": fetched_at,
        "source": PAGE_URL,
        "fundType": "YAT",
        "fundCount": len(funds),
        # Each fund's "prices" list has one price (or null) per date here.
        "priceDates": price_dates,
    }
    header_lines = "".join(
        f"  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},\n"
        for key, value in header.items()
    )
    # One fund per line keeps the daily git diffs readable.
    fund_lines = ",\n".join(
        "    " + json.dumps(fund, ensure_ascii=False) for fund in funds
    )
    return "{\n" + header_lines + '  "funds": [\n' + fund_lines + "\n  ]\n}\n"


def write_atomically(path, text):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, path)
    except BaseException:
        os.unlink(tmp_path)
        raise


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    now = datetime.now(timezone.utc).replace(microsecond=0)
    funds = parse(fetch_json(API_URL, PAYLOAD, PAGE_URL))

    end = now.astimezone(ISTANBUL).date()
    start = end - timedelta(days=PRICE_WINDOW_DAYS)
    raw_prices = fetch_json(PRICES_API_URL, prices_payload(start, end), PRICES_PAGE_URL)
    price_dates, prices = parse_prices(raw_prices, [fund["code"] for fund in funds])
    for fund in funds:
        fund["prices"] = prices[fund["code"]]

    text = render(funds, now.isoformat().replace("+00:00", "Z"), price_dates)
    json.loads(text)  # sanity check that the hand-assembled JSON is valid
    write_atomically(output, text)
    print(
        f"Wrote {len(funds)} funds with prices for {len(price_dates)} dates "
        f"({price_dates[0]} to {price_dates[-1]}) to {os.path.normpath(output)}"
    )


if __name__ == "__main__":
    main()
