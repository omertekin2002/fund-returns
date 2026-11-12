#!/usr/bin/env python3
"""Download fund returns from TEFAS and write them as JSON for the website.

Fetches the same data as the export on TEFAS > Fon Getirileri > Menkul Kıymet
Yatırım Fonları (https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT),
limited to funds traded on TEFAS (the page's default), plus each fund's daily
prices over the last six months from TEFAS > Fon Verileri, which the website
uses for the Sharpe ratio and the 4-week price line.

Also fetches two interest rates for the risk-free return behind the Sharpe
ratio: TLREF, the Turkish lira overnight reference rate, from Borsa İstanbul,
and the central bank's policy rate (the one-week repo rate) from the TCMB.
The fund data doesn't depend on them: when a rate can't be fetched, the
script keeps the rates the existing file has and still writes the new data.

Usage: python3 scripts/fetch_funds.py [output_path]

Uses only the Python standard library so the workflow needs no install step.
The output file is only replaced after the response passes validation.

Before replacing it, the script keeps the existing file's content as
previous.json next to it, so the website can show which funds entered or left
the passing list since the last update. It does this only when the existing
file is from an earlier Istanbul day, so a second run on the same day still
compares against the last earlier day.
"""

import http.client
import json
import os
import re
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
# The data behind the TLREF table on Borsa İstanbul's TLREF page: the rate of
# every business day in the last {days} days.
TLREF_API_URL = (
    "https://www.borsaistanbul.com/bist-tlrefk.php"
    "?op=fetchTlrefkData&dataType=tlref-history&day={days}"
)
TLREF_PAGE_URL = "https://www.borsaistanbul.com/en/indices/tlref"
# The TCMB's table of one-week repo rates: one row per change, with the day
# the rate took effect.
POLICY_RATE_URL = (
    "https://www.tcmb.gov.tr/wps/wcm/connect/en/tcmb+en/main+menu/core+functions"
    "/monetary+policy/central+bank+interest+rates/1+week+repo"
)
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

# Daily prices of every YAT fund over the last six months (26 weeks). TEFAS
# rejects ranges longer than one month, so the window is fetched in requests
# of four weeks each, with a pause between them (see RETRY_DELAY_SECONDS).
PRICE_WINDOW_DAYS = 182
PRICE_REQUEST_DAYS = 28
PRICE_REQUEST_DELAY_SECONDS = 15
# The price endpoint pages its rows; all funds over four weeks is ~41,000.
MAX_PRICE_ROWS = 100000
# 26 weeks hold ~125 business days; the public holidays in them remove up to
# ~15, so far fewer means a response is broken.
MIN_PRICE_DATES = 100
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

# The interest rates are fetched with fewer attempts: the update goes on
# without them.
RATE_ATTEMPTS = 2
# A price date without a rate takes the latest earlier one, up to this many
# days back. The newest date needs it every day: TLREF is published in the
# afternoon, after the update has run.
RATE_MAX_AGE_DAYS = 10
# Annual rates in percent outside this range mean a response is broken.
MAX_RATE = 500
# The TCMB table has ~60 rows; far fewer means the page has changed.
MIN_POLICY_RATE_ROWS = 10


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


def fetch(url, payload, referer, decode, attempts=ATTEMPTS):
    """Return decode(the response body as text), retrying failed attempts.

    Posts payload as JSON, or sends a GET request when it is None. decode
    raises ValueError for a body that isn't what the caller expects.
    """
    if payload is None:
        body = None
        headers = {"User-Agent": HEADERS["User-Agent"], "Accept": "*/*"}
    else:
        body = json.dumps(payload).encode("utf-8")
        headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    last_error = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return decode(response.read().decode("utf-8"))
        # OSError covers URLError/HTTPError, timeouts and dropped connections;
        # ValueError covers an unexpected body such as a bot-protection page.
        except (OSError, http.client.HTTPException, ValueError) as exc:
            last_error = exc
            print(f"Attempt {attempt}/{attempts} failed: {exc}", file=sys.stderr)
            if attempt < attempts:
                time.sleep(RETRY_DELAY_SECONDS * attempt)
    raise RuntimeError(f"Could not fetch {url}: {last_error}")


def fetch_json(url, payload, referer, attempts=ATTEMPTS):
    return fetch(url, payload, referer, json.loads, attempts)


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


def price_ranges(start, end):
    """Split start..end (dates, both included) into ranges TEFAS accepts.

    The ranges are in date order, don't overlap, and each spans at most
    PRICE_REQUEST_DAYS days from its first to its last date.
    """
    ranges = []
    while start <= end:
        last = min(start + timedelta(days=PRICE_REQUEST_DAYS), end)
        ranges.append((start, last))
        start = last + timedelta(days=1)
    return ranges


def fetch_prices(start, end):
    """Return the TEFAS responses with the prices from start to end, oldest first."""
    responses = []
    for first, last in price_ranges(start, end):
        if responses:
            time.sleep(PRICE_REQUEST_DELAY_SECONDS)
        responses.append(
            fetch_json(PRICES_API_URL, prices_payload(first, last), PRICES_PAGE_URL)
        )
    return responses


def parse_prices(responses, codes):
    """Return the price dates and, per fund code, its price on each date.

    responses is the list of TEFAS responses that together cover the window.
    A fund's list has None for a date it has no price on.
    """
    rows = []
    for raw in responses:
        chunk = result_rows(raw)
        if len(chunk) >= MAX_PRICE_ROWS:
            raise ValueError(f"{len(chunk)} price rows returned; the list may be cut off")
        rows.extend(chunk)

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


def to_rate(value):
    """An annual rate in percent as a float; ValueError if it can't be one."""
    try:
        rate = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Not a rate: {value!r}") from None
    if not 0 <= rate <= MAX_RATE:  # also rejects NaN
        raise ValueError(f"Rate out of range: {value!r}")
    return rate


def parse_tlref(raw):
    """Return {ISO date: TLREF in percent} from Borsa İstanbul's response."""
    if not isinstance(raw, dict) or raw.get("status") != "success":
        raise ValueError("Unexpected TLREF response")
    rows = raw.get("data")
    if not isinstance(rows, list) or not rows:
        raise ValueError("TLREF response has no data")
    rates = {}
    for row in rows:
        if not isinstance(row, dict) or "date" not in row or "clval" not in row:
            raise ValueError(f"TLREF row is missing fields: {row}")
        day = str(row["date"])[:10]
        datetime.strptime(day, "%Y-%m-%d")  # ValueError if it isn't a date
        rates[day] = to_rate(row["clval"])
    return rates


def parse_policy_rate(page):
    """Return the policy rate changes on the TCMB page, oldest first.

    Each is (ISO date the rate took effect, rate in percent). The table's
    rows are "DD.MM.YYYY", a borrowing rate ("-" for years now) and the
    lending rate, which is the policy rate.
    """
    changes = []
    for row in re.findall(r"<tr\b.*?</tr>", page, flags=re.S | re.I):
        cells = [
            re.sub(r"<[^>]+>", "", cell).strip()
            for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S | re.I)
        ]
        if len(cells) < 3 or not re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", cells[0]):
            continue
        day = datetime.strptime(cells[0], "%d.%m.%Y").strftime("%Y-%m-%d")
        changes.append((day, to_rate(cells[-1].replace(",", "."))))
    if len(changes) < MIN_POLICY_RATE_ROWS:
        raise ValueError(
            f"Only {len(changes)} policy rates found (expected at least {MIN_POLICY_RATE_ROWS})"
        )
    return sorted(changes)


def fetch_tlref(days):
    """Return {ISO date: TLREF in percent} for the last `days` days."""
    return fetch(
        TLREF_API_URL.format(days=days),
        None,
        TLREF_PAGE_URL,
        lambda text: parse_tlref(json.loads(text)),
        RATE_ATTEMPTS,
    )


def fetch_policy_rate():
    """Return the policy rate changes, see parse_policy_rate."""
    return fetch(POLICY_RATE_URL, None, None, parse_policy_rate, RATE_ATTEMPTS)


def policy_rate_on(changes, dates):
    """Return {date: the policy rate in effect} for the dates a rate covers."""
    rates = {}
    for date in dates:
        in_effect = [rate for day, rate in changes if day <= date]
        if in_effect:
            rates[date] = in_effect[-1]
    return rates


def rates_for(price_dates, known):
    """Return one rate (or None) per price date from known, {ISO date: rate}.

    A date without a rate takes the latest earlier one, if that is at most
    RATE_MAX_AGE_DAYS days before it.
    """
    days = sorted(known)
    rates = []
    for date in price_dates:
        earlier = [day for day in days if day <= date]
        oldest = (
            datetime.strptime(date, "%Y-%m-%d") - timedelta(days=RATE_MAX_AGE_DAYS)
        ).strftime("%Y-%m-%d")
        rates.append(known[earlier[-1]] if earlier and earlier[-1] >= oldest else None)
    return rates


def existing_rates(path):
    """Return the rates in the data file at path, as {name: {ISO date: rate}}.

    Empty for a missing or unreadable file, or one without rates.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return {
            name: {
                date: to_rate(rate)
                for date, rate in zip(data["priceDates"], rates)
                if rate is not None
            }
            for name, rates in data["riskFreeRates"].items()
        }
    # Whatever is wrong with the old file, the update goes on without it.
    except Exception:
        return {}


def risk_free_rates(price_dates, window_days, existing):
    """Return {"tlref": [...], "policy": [...]}: a rate per price date, or None.

    The rates are annual, in percent. existing is what existing_rates() read
    from the data file being replaced: its rates fill in for a source that
    can't be fetched. Never raises: the fund data must still be written.
    """
    sources = {
        # Reaching back before the window gives its first date a rate too.
        "tlref": lambda: fetch_tlref(window_days + 2 * RATE_MAX_AGE_DAYS),
        "policy": lambda: policy_rate_on(fetch_policy_rate(), price_dates),
    }
    rates = {}
    for name, fetch_rates in sources.items():
        known = dict(existing.get(name, {}))
        try:
            known.update(fetch_rates())
        # Any error here is only logged: it must not stop the fund data being written.
        except Exception as exc:
            print(f"Keeping the earlier {name} rates: {exc}", file=sys.stderr)
        rates[name] = rates_for(price_dates, known)
    return rates


def render(funds, fetched_at, price_dates, rates=None):
    header = {
        "fetchedAt": fetched_at,
        "source": PAGE_URL,
        "fundType": "YAT",
        "fundCount": len(funds),
        # Each fund's "prices" list has one price (or null) per date here.
        "priceDates": price_dates,
    }
    if rates:
        # Annual interest rates in percent, one (or null) per date in
        # priceDates: TLREF and the central bank's policy rate.
        header["riskFreeRates"] = rates
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


def istanbul_date(iso):
    """The Istanbul calendar date of an ISO timestamp such as "2026-10-20T07:15:33Z"."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ISTANBUL).date()


def rotate_previous(output, previous, fetched_at):
    """Copy the existing output file to previous if it is from an earlier day.

    Returns True if previous was written. A missing, unreadable or invalid
    output file, or one from the same Istanbul day as fetched_at, leaves
    previous as it is. Never raises: the new data must still be written.
    """
    try:
        with open(output, encoding="utf-8") as handle:
            text = handle.read()
    except FileNotFoundError:
        return False
    except (OSError, ValueError) as exc:
        print(f"Not keeping the previous data: {exc}", file=sys.stderr)
        return False
    try:
        data = json.loads(text)
        if not isinstance(data, dict) or not isinstance(data.get("funds"), list):
            raise ValueError("it has no funds list")
        old_fetched_at = data.get("fetchedAt")
        if not isinstance(old_fetched_at, str):
            raise ValueError("it has no fetchedAt")
        if istanbul_date(old_fetched_at) >= istanbul_date(fetched_at):
            print(f"Keeping {os.path.normpath(previous)}: the data was already fetched today")
            return False
        # The same text as the old file, so git stores it only once.
        write_atomically(previous, text)
    # Any error here is only logged: it must not stop the new data being written.
    except Exception as exc:
        print(f"Not keeping the previous data: {exc}", file=sys.stderr)
        return False
    print(f"Kept the data fetched at {old_fetched_at} in {os.path.normpath(previous)}")
    return True


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    previous = os.path.join(os.path.dirname(output), "previous.json")
    now = datetime.now(timezone.utc).replace(microsecond=0)
    funds = parse(fetch_json(API_URL, PAYLOAD, PAGE_URL))

    end = now.astimezone(ISTANBUL).date()
    start = end - timedelta(days=PRICE_WINDOW_DAYS)
    price_dates, prices = parse_prices(
        fetch_prices(start, end), [fund["code"] for fund in funds]
    )
    for fund in funds:
        fund["prices"] = prices[fund["code"]]

    rates = risk_free_rates(price_dates, PRICE_WINDOW_DAYS, existing_rates(output))
    for name, values in rates.items():
        print(f"{name}: a rate for {sum(v is not None for v in values)} of {len(values)} dates")

    fetched_at = now.isoformat().replace("+00:00", "Z")
    text = render(funds, fetched_at, price_dates, rates)
    json.loads(text)  # sanity check that the hand-assembled JSON is valid
    rotate_previous(output, previous, fetched_at)
    write_atomically(output, text)
    print(
        f"Wrote {len(funds)} funds with prices for {len(price_dates)} dates "
        f"({price_dates[0]} to {price_dates[-1]}) to {os.path.normpath(output)}"
    )


if __name__ == "__main__":
    main()
