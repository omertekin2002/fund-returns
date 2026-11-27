#!/usr/bin/env python3
"""Download fund returns from TEFAS and write them as JSON for the website.

Fetches the same data as the export on TEFAS > Fon Getirileri > Menkul Kıymet
Yatırım Fonları (https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT),
limited to funds traded on TEFAS (the page's default), plus each fund's daily
prices over the last six months from TEFAS > Fon Verileri, which the website
uses for the Sharpe ratio and the 4-week price line, and each fund's size
(total value in TL) on its latest price date.

Usage: python3 scripts/fetch_funds.py [output_path]

Uses only the Python standard library so the workflow needs no install step.
The output file is only replaced after the response passes validation.

Before replacing it, the script keeps the existing file's content as
previous.json next to it, so the website can show which funds entered or left
the passing list since the last update. It does this only when the new data's
last price date is later than the existing file's, so previous.json is always
the edition of the last earlier price day. A run that brings no new price date
(a TEFAS holiday on a weekday, or a second run on the same day) keeps the
existing previous.json, so the page still shows that trading day's changes.
An existing file without valid price dates is kept only when it was fetched on
an earlier Istanbul day.
"""

import http.client
import json
import math
import os
import re
import sys
import tempfile
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
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
# The fund's total value in TL, on the same price rows. Extra information: a
# missing or invalid value never fails the update (see parse_sizes).
SIZE_FIELD = "portfoyBuyukluk"

# There are ~1000 traded YAT funds; far fewer means the response is broken.
MIN_EXPECTED_FUNDS = 200
# The returns the rules use. In the 44 editions from 2026-09-30 to 2026-11-20,
# a return was missing or exactly 0 for at most 5.3% of funds for 1M, 6.8% for
# 3M, 9.7% for 6M and 17.6% for 1Y. Far more means TEFAS sent an empty column.
# YTD, 3Y and 5Y aren't in the rules (3Y and 5Y are missing for up to ~65% of
# funds), so they aren't checked.
RULE_RETURNS = ["1m", "3m", "6m", "1y"]
MAX_MISSING_RETURN_PERCENT = 40
# The fund count went from 1,070 to 1,076 over those editions and never fell
# from one to the next, so a list much shorter than the last one is cut off.
MIN_KEPT_FUNDS_PERCENT = 90

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


def to_size(value):
    """A positive, finite size in TL, or None for anything else."""
    if isinstance(value, bool):
        return None
    try:
        size = float(value)
    except (TypeError, ValueError):
        return None
    return size if math.isfinite(size) and size > 0 else None


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
    check_returns(funds)
    funds.sort(key=lambda fund: fund["code"])
    return funds


def check_returns(funds):
    """Raise ValueError if many funds lack a return the rules use.

    A return counts as lacking when it is missing or exactly 0: the rules allow
    a missing 3M, 6M or 1Y return, so an empty column would let funds pass.
    """
    for key in RULE_RETURNS:
        lacking = sum(1 for fund in funds if not fund["returns"][key])
        if lacking * 100 > MAX_MISSING_RETURN_PERCENT * len(funds):
            raise ValueError(
                f"{key.upper()} return missing or 0 for {lacking:,} of {len(funds):,} "
                f"funds (more than {MAX_MISSING_RETURN_PERCENT}%); "
                "TEFAS may have sent an empty column"
            )


def check_fund_count(funds, output):
    """Raise ValueError if funds is much shorter than the existing output's list.

    A missing, unreadable or invalid output file, or one without a funds list,
    skips the check.
    """
    try:
        with open(output, encoding="utf-8") as handle:
            data = json.load(handle)
        old_count = len(data["funds"]) if isinstance(data["funds"], list) else None
    except (OSError, ValueError, TypeError, KeyError):
        return
    if old_count is None or len(funds) * 100 >= MIN_KEPT_FUNDS_PERCENT * old_count:
        return
    old_fetched_at = data.get("fetchedAt")
    since = (
        f"the data fetched at {old_fetched_at}"
        if isinstance(old_fetched_at, str)
        else "the existing data"
    )
    raise ValueError(
        f"Only {len(funds):,} funds returned, down from {old_count:,} in {since} "
        f"(expected at least {MIN_KEPT_FUNDS_PERCENT}%)"
    )


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


def parse_sizes(responses, codes):
    """Return each fund code's size (total value in TL), or None.

    A fund's size is its most recent positive portfoyBuyukluk in the window,
    normally the one on the latest price date. Rows without the field, or with
    an empty, zero or non-numeric value, are skipped, so a fund with no valid
    value gets None. Never raises on the size values themselves: parse_prices
    checks the responses.
    """
    latest = {}
    for raw in responses:
        for row in result_rows(raw):
            if not isinstance(row, dict) or row.get("fonKodu") not in codes:
                continue
            size = to_size(row.get(SIZE_FIELD))
            day = row.get("tarih")
            if size is None or not isinstance(day, str):
                continue
            code = row["fonKodu"]
            if code not in latest or day > latest[code][0]:
                latest[code] = (day, size)
    return {code: latest[code][1] if code in latest else None for code in codes}


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


def istanbul_date(iso):
    """The Istanbul calendar date of an ISO timestamp such as "2026-10-20T07:15:33Z"."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ISTANBUL).date()


def valid_price_date(value):
    """value if it is a "YYYY-MM-DD" date string, otherwise None."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def last_price_date(data):
    """The last of data's priceDates if it is a valid date, otherwise None."""
    dates = data.get("priceDates")
    if not isinstance(dates, list) or not dates:
        return None
    return valid_price_date(dates[-1])


def rotate_previous(output, previous, fetched_at, new_last_price_date):
    """Copy the existing output file to previous if the new data is newer.

    The new data is newer when its last price date (new_last_price_date) is
    later than the existing file's. On a TEFAS holiday, or a second run that
    brings no new price date, previous keeps the edition of the last earlier
    price day. If either file has no valid last price date, the existing file
    is copied only when it was fetched on an earlier Istanbul day than
    fetched_at.

    Returns True if previous was written. A missing, unreadable or invalid
    output file leaves previous as it is. Never raises: the new data must still
    be written.
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
        old_last = last_price_date(data)
        new_last = valid_price_date(new_last_price_date)
        if old_last and new_last:
            if new_last <= old_last:
                print(
                    f"Keeping {os.path.normpath(previous)}: "
                    f"no new price date since {old_last}"
                )
                return False
        elif istanbul_date(old_fetched_at) >= istanbul_date(fetched_at):
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
    check_fund_count(funds, output)

    end = now.astimezone(ISTANBUL).date()
    start = end - timedelta(days=PRICE_WINDOW_DAYS)
    codes = [fund["code"] for fund in funds]
    price_responses = fetch_prices(start, end)
    price_dates, prices = parse_prices(price_responses, codes)
    sizes = parse_sizes(price_responses, set(codes))
    for fund in funds:
        fund["size"] = sizes[fund["code"]]
        fund["prices"] = prices[fund["code"]]

    fetched_at = now.isoformat().replace("+00:00", "Z")
    text = render(funds, fetched_at, price_dates)
    json.loads(text)  # sanity check that the hand-assembled JSON is valid
    rotate_previous(output, previous, fetched_at, price_dates[-1])
    write_atomically(output, text)
    sized = sum(1 for fund in funds if fund["size"] is not None)
    print(
        f"Wrote {len(funds)} funds with prices for {len(price_dates)} dates "
        f"({price_dates[0]} to {price_dates[-1]}) and sizes for {sized} funds "
        f"to {os.path.normpath(output)}"
    )


if __name__ == "__main__":
    main()
