# Run with: npm test (or only these: python3 -m unittest discover -s tests -v)
"""Tests for scripts/fetch_funds.py. They make no network calls and never sleep."""

import http.client
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "fetch_funds.py"
spec = importlib.util.spec_from_file_location("fetch_funds", SCRIPT)
fetch_funds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_funds)

# Small limits keep the fixtures short. RealLimitsTest runs the script's own.
MIN_FUNDS = 3
MIN_DATES = 3
MAX_ROWS = 20
small_limits = mock.patch.multiple(
    fetch_funds,
    MIN_EXPECTED_FUNDS=MIN_FUNDS,
    MIN_PRICE_DATES=MIN_DATES,
    MAX_PRICE_ROWS=MAX_ROWS,
)

CODES = ["AAA", "BBB", "CCC"]
DATES = ["2026-09-30", "2026-10-01", "2026-10-02"]


def fund_row(code, **fields):
    """A Fon Getirileri row with every field parse() reads."""
    row = {
        "fonKodu": code,
        "fonUnvan": f"{code} ÖRNEK PORTFÖY HİSSE SENEDİ FONU",
        "fonTurAciklama": "Hisse Senedi Şemsiye Fonu",
        "riskDegeri": 6,
        "tefasDurum": True,
        "getiri1a": 3.5,
        "getiri3a": 9.5,
        "getiri6a": 20.25,
        "getiri1y": 45,
        "getiriyb": 30.1,
        "getiri3y": 210.4,
        "getiri5y": 400,
    }
    row.update(fields)
    return row


def without(row, field):
    return {key: value for key, value in row.items() if key != field}


def funds_response(codes=CODES):
    return {"resultList": [fund_row(code) for code in codes]}


def price_row(code, day, price=1.5):
    return {"fonKodu": code, "tarih": day, "fiyat": price}


def prices_response(codes=CODES, dates=DATES):
    return {"resultList": [price_row(code, day) for day in dates for code in codes]}


def parse_prices(raw, codes):
    """parse_prices() for a window that one response covers."""
    return fetch_funds.parse_prices([raw], codes)


def codes_of(funds):
    return [fund["code"] for fund in funds]


@small_limits
class ParseTest(unittest.TestCase):
    def test_maps_fields_to_website_keys(self):
        funds = fetch_funds.parse(funds_response())
        self.assertEqual(
            funds[0],
            {
                "code": "AAA",
                "name": "AAA ÖRNEK PORTFÖY HİSSE SENEDİ FONU",
                "umbrella": "Hisse Senedi Şemsiye Fonu",
                "risk": 6,
                "returns": {
                    "1m": 3.5,
                    "3m": 9.5,
                    "6m": 20.25,
                    "1y": 45.0,
                    "ytd": 30.1,
                    "3y": 210.4,
                    "5y": 400.0,
                },
            },
        )
        self.assertEqual(
            list(funds[0]["returns"]), ["1m", "3m", "6m", "1y", "ytd", "3y", "5y"]
        )

    def test_converts_numbers_given_as_strings(self):
        raw = funds_response()
        raw["resultList"][0].update(getiri1a="2.75", riskDegeri="3")
        fund = fetch_funds.parse(raw)[0]
        self.assertEqual(fund["returns"]["1m"], 2.75)
        self.assertEqual(fund["risk"], 3)

    def test_empty_returns_become_none(self):
        raw = funds_response()
        raw["resultList"][0].update(getiri3a="", getiri5y=None)
        returns = fetch_funds.parse(raw)[0]["returns"]
        self.assertIsNone(returns["3m"])
        self.assertIsNone(returns["5y"])
        self.assertEqual(returns["1m"], 3.5)

    def test_bad_risk_becomes_none(self):
        for risk in [None, "", "yüksek", [6]]:
            with self.subTest(risk=risk):
                raw = funds_response()
                raw["resultList"][0]["riskDegeri"] = risk
                self.assertIsNone(fetch_funds.parse(raw)[0]["risk"])
        # riskDegeri is optional.
        raw = funds_response()
        raw["resultList"][0] = without(raw["resultList"][0], "riskDegeri")
        self.assertIsNone(fetch_funds.parse(raw)[0]["risk"])

    def test_skips_funds_not_traded_on_tefas(self):
        rows = [
            fund_row("AAA"),
            fund_row("BBB", tefasDurum=False),
            fund_row("CCC"),
            # Only an explicit false skips a fund.
            without(fund_row("DDD"), "tefasDurum"),
            fund_row("EEE", tefasDurum=None),
        ]
        funds = fetch_funds.parse({"resultList": rows})
        self.assertEqual(codes_of(funds), ["AAA", "CCC", "DDD", "EEE"])

    def test_sorts_by_code(self):
        funds = fetch_funds.parse(funds_response(["CCC", "AAA", "BBB"]))
        self.assertEqual(codes_of(funds), ["AAA", "BBB", "CCC"])

    def test_rejects_a_row_missing_a_required_field(self):
        for field in fetch_funds.REQUIRED_FIELDS:
            with self.subTest(field=field):
                raw = funds_response()
                raw["resultList"][1] = without(raw["resultList"][1], field)
                with self.assertRaisesRegex(ValueError, "missing fields") as caught:
                    fetch_funds.parse(raw)
                self.assertIn(repr([field]), str(caught.exception))

    def test_rejects_too_few_funds(self):
        self.assertEqual(len(fetch_funds.parse(funds_response())), MIN_FUNDS)
        with self.assertRaisesRegex(ValueError, "Only 2 funds returned"):
            fetch_funds.parse(funds_response(CODES[:2]))
        # Skipped funds don't count.
        raw = funds_response()
        raw["resultList"][0]["tefasDurum"] = False
        with self.assertRaisesRegex(ValueError, "Only 2 funds returned"):
            fetch_funds.parse(raw)


@small_limits
class ParsePricesTest(unittest.TestCase):
    def test_returns_sorted_dates_with_one_price_per_date_for_every_fund(self):
        rows = [
            price_row("BBB", "2026-10-02", 2.3),
            price_row("AAA", "2026-10-02", 1.3),
            price_row("CCC", "2026-09-30", 3.1),
            price_row("AAA", "2026-09-30", 1.1),
            price_row("BBB", "2026-09-30", 2.1),
            price_row("AAA", "2026-10-01", 1.2),
            price_row("CCC", "2026-10-02", 3.3),
        ]
        dates, prices = parse_prices(
            {"resultList": rows}, ["AAA", "BBB", "CCC", "DDD"]
        )
        self.assertEqual(dates, ["2026-09-30", "2026-10-01", "2026-10-02"])
        self.assertEqual(
            prices,
            {
                "AAA": [1.1, 1.2, 1.3],
                "BBB": [2.1, None, 2.3],
                "CCC": [3.1, None, 3.3],
                # A fund with no rows at all still gets a list.
                "DDD": [None, None, None],
            },
        )

    def test_zero_or_empty_price_becomes_none(self):
        raw = prices_response()
        raw["resultList"][0]["fiyat"] = 0
        raw["resultList"][1]["fiyat"] = ""
        raw["resultList"][2]["fiyat"] = None
        raw["resultList"][3]["fiyat"] = "2.25"
        _, prices = parse_prices(raw, CODES)
        self.assertEqual(prices["AAA"], [None, 2.25, 1.5])
        self.assertEqual(prices["BBB"], [None, 1.5, 1.5])
        self.assertEqual(prices["CCC"], [None, 1.5, 1.5])

    def test_ignores_codes_not_in_the_fund_list(self):
        raw = prices_response(CODES + ["ZZZ"])
        _, prices = parse_prices(raw, CODES)
        self.assertEqual(sorted(prices), CODES)
        # Nor do they count as priced funds.
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            parse_prices(raw, CODES[:2] + ["DDD"])

    def test_rejects_a_list_that_may_be_cut_off(self):
        codes = CODES + ["DDD"]
        dates = DATES + ["2026-10-05", "2026-10-06"]
        raw = prices_response(codes, dates)
        self.assertEqual(len(raw["resultList"]), MAX_ROWS)
        with self.assertRaisesRegex(ValueError, "may be cut off"):
            parse_prices(raw, codes)
        raw["resultList"].pop()
        parse_prices(raw, codes)

    def test_rejects_too_few_dates(self):
        dates, _ = parse_prices(prices_response(), CODES)
        self.assertEqual(len(dates), MIN_DATES)
        with self.assertRaisesRegex(ValueError, "only 2 dates"):
            parse_prices(prices_response(dates=DATES[:2]), CODES)

    def test_rejects_too_few_priced_funds(self):
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            parse_prices(prices_response(CODES[:2]), CODES)
        # A fund whose prices are all missing doesn't count.
        raw = prices_response()
        for row in raw["resultList"]:
            if row["fonKodu"] == "CCC":
                row["fiyat"] = 0
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            parse_prices(raw, CODES)

    def test_rejects_a_row_missing_a_field(self):
        for field in fetch_funds.PRICE_FIELDS:
            with self.subTest(field=field):
                raw = prices_response()
                raw["resultList"][4] = without(raw["resultList"][4], field)
                with self.assertRaisesRegex(ValueError, "missing fields") as caught:
                    parse_prices(raw, CODES)
                self.assertIn(repr([field]), str(caught.exception))


class PriceRangesTest(unittest.TestCase):
    def test_splits_the_window_into_ranges_tefas_accepts(self):
        end = date(2026, 11, 10)
        start = end - timedelta(days=fetch_funds.PRICE_WINDOW_DAYS)
        ranges = fetch_funds.price_ranges(start, end)
        self.assertEqual(len(ranges), 7)
        self.assertEqual((ranges[0][0], ranges[-1][1]), (start, end))
        for first, last in ranges:
            self.assertLessEqual(first, last)
            self.assertLessEqual((last - first).days, fetch_funds.PRICE_REQUEST_DAYS)
        # In date order, with no day left out or fetched twice.
        for (_, last), (first, _) in zip(ranges, ranges[1:]):
            self.assertEqual(first, last + timedelta(days=1))

    def test_a_short_window_is_one_range(self):
        day = date(2026, 11, 10)
        self.assertEqual(fetch_funds.price_ranges(day, day), [(day, day)])
        start = day - timedelta(days=fetch_funds.PRICE_REQUEST_DAYS)
        self.assertEqual(fetch_funds.price_ranges(start, day), [(start, day)])


class FetchPricesTest(unittest.TestCase):
    def test_fetches_each_range_with_a_pause_between_requests(self):
        end = date(2026, 11, 10)
        start = end - timedelta(days=2 * fetch_funds.PRICE_REQUEST_DAYS + 5)
        ranges = fetch_funds.price_ranges(start, end)
        self.assertEqual(len(ranges), 3)
        with mock.patch.object(fetch_funds, "fetch_json", side_effect=["a", "b", "c"]) as fetch, \
                mock.patch.object(fetch_funds.time, "sleep") as sleep:
            self.assertEqual(fetch_funds.fetch_prices(start, end), ["a", "b", "c"])
        self.assertEqual(
            [call.args[1] for call in fetch.call_args_list],
            [fetch_funds.prices_payload(first, last) for first, last in ranges],
        )
        self.assertEqual(
            sleep.call_args_list,
            [mock.call(fetch_funds.PRICE_REQUEST_DELAY_SECONDS)] * 2,
        )


@small_limits
class ParsePricesAcrossResponsesTest(unittest.TestCase):
    def test_joins_the_dates_of_every_response(self):
        dates, prices = fetch_funds.parse_prices(
            [prices_response(dates=DATES[2:]), prices_response(dates=DATES[:2])], CODES
        )
        self.assertEqual(dates, DATES)
        self.assertEqual(prices["AAA"], [1.5, 1.5, 1.5])

    def test_checks_each_response(self):
        with self.assertRaisesRegex(ValueError, "TEFAS returned an error"):
            fetch_funds.parse_prices(
                [prices_response(), {"resultList": [], "errorMessage": "Hata"}], CODES
            )
        # The cut-off limit is per response, not for the whole window.
        codes = CODES + ["DDD"]
        halves = [prices_response(codes, DATES), prices_response(codes, ["2026-10-05", "2026-10-06", "2026-10-07"])]
        self.assertGreater(sum(len(raw["resultList"]) for raw in halves), MAX_ROWS)
        dates, _ = fetch_funds.parse_prices(halves, codes)
        self.assertEqual(len(dates), 6)


@small_limits
class ResultRowsTest(unittest.TestCase):
    """Response checks shared by parse() and parse_prices()."""

    PARSERS = {
        "parse": fetch_funds.parse,
        "parse_prices": lambda raw: parse_prices(raw, CODES),
    }

    def assert_rejected(self, make_raw, message):
        for name, parser in self.PARSERS.items():
            with self.subTest(parser=name):
                with self.assertRaisesRegex(ValueError, message):
                    parser(make_raw())

    def test_rejects_a_response_that_is_not_an_object(self):
        for raw in [None, [], "<html>Request Rejected</html>"]:
            with self.subTest(raw=raw):
                self.assert_rejected(lambda: raw, "Unexpected response type")

    def test_rejects_a_tefas_error(self):
        self.assert_rejected(
            lambda: {**funds_response(), "errorCode": "E01"}, "TEFAS returned an error"
        )
        self.assert_rejected(
            lambda: {**prices_response(), "errorMessage": "Hata"},
            "TEFAS returned an error",
        )

    def test_accepts_empty_error_fields(self):
        funds = fetch_funds.parse(
            {**funds_response(), "errorCode": None, "errorMessage": ""}
        )
        self.assertEqual(codes_of(funds), CODES)
        dates, _ = parse_prices(
            {**prices_response(), "errorCode": "", "errorMessage": None}, CODES
        )
        self.assertEqual(dates, DATES)

    def test_rejects_a_missing_or_non_list_result_list(self):
        for raw in [{}, {"resultList": None}, {"resultList": {"fonKodu": "AAA"}}]:
            with self.subTest(raw=raw):
                self.assert_rejected(lambda: raw, "no resultList")


class RealLimitsTest(unittest.TestCase):
    """The tests above shrink the limits; these use the script's own."""

    codes = [f"F{n:04d}" for n in range(fetch_funds.MIN_EXPECTED_FUNDS)]
    dates = [
        (date(2026, 9, 1) + timedelta(days=n)).isoformat()
        for n in range(fetch_funds.MIN_PRICE_DATES)
    ]

    def test_parse(self):
        self.assertEqual(
            len(fetch_funds.parse(funds_response(self.codes))), len(self.codes)
        )
        with self.assertRaisesRegex(ValueError, "funds returned"):
            fetch_funds.parse(funds_response(self.codes[1:]))

    def test_parse_prices(self):
        parse_prices(prices_response(self.codes, self.dates), self.codes)
        with self.assertRaisesRegex(ValueError, "dates returned"):
            parse_prices(
                prices_response(self.codes, self.dates[1:]), self.codes
            )
        with self.assertRaisesRegex(ValueError, "funds returned"):
            parse_prices(
                prices_response(self.codes[1:], self.dates), self.codes
            )


class RenderTest(unittest.TestCase):
    funds = [
        {
            "code": "AAA",
            "name": "ÖRNEK PORTFÖY ŞEMSİYE ĞÜÇ FONU",
            "umbrella": "Para Piyasası Şemsiye Fonu",
            "risk": 1,
            "returns": {
                "1m": 2.93,
                "3m": None,
                "6m": 17.5,
                "1y": 42.0,
                "ytd": 31.2,
                "3y": None,
                "5y": None,
            },
            "prices": [3.6, None, 3.61],
        },
        {
            "code": "BBB",
            "name": "İKİNCİ FON",
            "umbrella": "Hisse Senedi Şemsiye Fonu",
            "risk": None,
            "returns": {
                "1m": 5.0,
                "3m": 9.1,
                "6m": None,
                "1y": None,
                "ytd": None,
                "3y": None,
                "5y": None,
            },
            "prices": [None, None, None],
        },
    ]

    def render(self, rates=None):
        return fetch_funds.render(self.funds, "2026-10-20T07:15:33Z", DATES, rates)

    def test_output_is_json_with_header_and_funds(self):
        data = json.loads(self.render())
        self.assertEqual(
            list(data),
            ["fetchedAt", "source", "fundType", "fundCount", "priceDates", "funds"],
        )
        self.assertEqual(data["fetchedAt"], "2026-10-20T07:15:33Z")
        self.assertEqual(data["source"], fetch_funds.PAGE_URL)
        self.assertEqual(data["fundType"], "YAT")
        self.assertEqual(data["fundCount"], 2)
        self.assertEqual(data["priceDates"], DATES)
        self.assertEqual(data["funds"], self.funds)

    def test_rates_follow_the_price_dates(self):
        rates = {"tlref": [39.98, None, 40.01], "policy": [37.0, 37.0, 36.0]}
        data = json.loads(self.render(rates))
        self.assertEqual(
            list(data),
            ["fetchedAt", "source", "fundType", "fundCount", "priceDates", "riskFreeRates", "funds"],
        )
        self.assertEqual(data["riskFreeRates"], rates)
        self.assertEqual(data["funds"], self.funds)
        # On one line, like the price dates.
        self.assertEqual(
            [line for line in self.render(rates).splitlines() if "riskFreeRates" in line],
            ['  "riskFreeRates": ' + json.dumps(rates) + ","],
        )

    def test_one_fund_per_line(self):
        text = self.render()
        self.assertTrue(text.endswith("\n"))
        lines = text.splitlines()
        start = lines.index('  "funds": [') + 1
        self.assertEqual(lines[start + len(self.funds) :], ["  ]", "}"])
        for line, fund in zip(lines[start:], self.funds):
            self.assertEqual(json.loads(line.strip().rstrip(",")), fund)

    def test_keeps_turkish_characters_unescaped(self):
        text = self.render()
        self.assertIn("ÖRNEK PORTFÖY ŞEMSİYE ĞÜÇ FONU", text)
        self.assertIn("Para Piyasası Şemsiye Fonu", text)
        self.assertNotIn("\\u", text)


class WriteAtomicallyTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name) / "data"
        self.path = self.directory / "funds.json"

    def files(self):
        return sorted(os.listdir(self.directory))

    def test_writes_the_file(self):
        fetch_funds.write_atomically(str(self.path), '{"name": "ŞEMSİYE"}\n')
        self.assertEqual(self.path.read_text(encoding="utf-8"), '{"name": "ŞEMSİYE"}\n')
        self.assertEqual(self.files(), ["funds.json"])
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o644)

    def test_replaces_an_existing_file(self):
        fetch_funds.write_atomically(str(self.path), "old\n")
        fetch_funds.write_atomically(str(self.path), "new\n")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "new\n")
        self.assertEqual(self.files(), ["funds.json"])

    def test_failed_write_leaves_the_old_file(self):
        fetch_funds.write_atomically(str(self.path), "old\n")
        with self.assertRaises(UnicodeEncodeError):
            # A lone surrogate can't be encoded as UTF-8.
            fetch_funds.write_atomically(str(self.path), "new \ud800\n")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "old\n")
        self.assertEqual(self.files(), ["funds.json"])

    def test_failed_replace_leaves_the_old_file(self):
        fetch_funds.write_atomically(str(self.path), "old\n")
        with mock.patch.object(
            fetch_funds.os, "replace", side_effect=OSError("disk full")
        ):
            with self.assertRaisesRegex(OSError, "disk full"):
                fetch_funds.write_atomically(str(self.path), "new\n")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "old\n")
        self.assertEqual(self.files(), ["funds.json"])


def response(body):
    """Stands in for what urlopen returns: a context manager with read()."""
    return io.BytesIO(body.encode("utf-8"))


class FetchJsonTest(unittest.TestCase):
    URL = "https://example.invalid/api"
    PAYLOAD = {"fonTipi": "YAT", "fonKodu": None}
    REFERER = "https://example.invalid/page"

    def setUp(self):
        self.urlopen = self.patch(fetch_funds.urllib.request, "urlopen")
        self.sleep = self.patch(fetch_funds.time, "sleep")
        self.stderr = self.patch(fetch_funds.sys, "stderr", io.StringIO())

    def patch(self, target, attribute, *new):
        patcher = mock.patch.object(target, attribute, *new)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def fetch(self):
        return fetch_funds.fetch_json(self.URL, self.PAYLOAD, self.REFERER)

    def test_posts_the_payload_and_returns_the_parsed_body(self):
        self.urlopen.return_value = response(
            '{"resultList": [{"fonUnvan": "ŞEMSİYE"}]}'
        )
        self.assertEqual(self.fetch(), {"resultList": [{"fonUnvan": "ŞEMSİYE"}]})
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.full_url, self.URL)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(json.loads(request.data), self.PAYLOAD)
        self.assertEqual(request.get_header("Referer"), self.REFERER)
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.sleep.assert_not_called()

    def test_without_a_payload_it_is_a_get_request(self):
        self.urlopen.return_value = response("<table></table>")
        text = fetch_funds.fetch(self.URL, None, None, str.upper, attempts=2)
        self.assertEqual(text, "<TABLE></TABLE>")
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertIsNone(request.get_header("Referer"))
        self.assertIsNone(request.get_header("Content-type"))
        self.assertIsNone(request.get_header("Origin"))
        self.assertTrue(request.get_header("User-agent"))

    def test_retries_a_body_the_decoder_rejects_up_to_the_given_attempts(self):
        self.urlopen.side_effect = [response("<html>oops</html>"), response("<html>oops</html>")]

        def decode(text):
            raise ValueError("no table")

        with self.assertRaisesRegex(RuntimeError, f"Could not fetch {self.URL}: no table"):
            fetch_funds.fetch(self.URL, None, self.REFERER, decode, attempts=2)
        self.assertEqual(self.urlopen.call_count, 2)
        self.assertEqual(self.sleep.call_count, 1)

    def test_retries_after_a_network_error_and_a_non_json_body(self):
        self.urlopen.side_effect = [
            OSError("Connection reset by peer"),
            response("<html>Request Rejected</html>"),
            response('{"resultList": []}'),
        ]
        self.assertEqual(self.fetch(), {"resultList": []})
        self.assertEqual(self.urlopen.call_count, 3)
        delay = fetch_funds.RETRY_DELAY_SECONDS
        self.assertEqual(
            self.sleep.call_args_list, [mock.call(delay), mock.call(2 * delay)]
        )
        self.assertIn("Attempt 1/", self.stderr.getvalue())
        self.assertIn("Attempt 2/", self.stderr.getvalue())

    def test_retries_after_an_http_protocol_error(self):
        self.urlopen.side_effect = [
            http.client.IncompleteRead(b"{"),
            response('{"resultList": []}'),
        ]
        self.assertEqual(self.fetch(), {"resultList": []})
        self.assertEqual(self.urlopen.call_count, 2)

    def test_gives_up_after_every_attempt_fails(self):
        attempts = fetch_funds.ATTEMPTS
        self.urlopen.side_effect = [
            OSError(f"error {n}") for n in range(1, attempts + 1)
        ]
        with self.assertRaisesRegex(
            RuntimeError, f"Could not fetch .*error {attempts}"
        ):
            self.fetch()
        self.assertEqual(self.urlopen.call_count, attempts)
        # No sleep after the last attempt.
        self.assertEqual(self.sleep.call_count, attempts - 1)
        self.assertIn(f"Attempt {attempts}/{attempts} failed", self.stderr.getvalue())


def tlref_response(rates):
    """Borsa İstanbul's response for {ISO date: rate}, newest first as it sends it."""
    return {
        "status": "success",
        "source": "api",
        "data": [
            {"indSname": "TLREF", "clval": f"{rate:.4f}", "date": day}
            for day, rate in sorted(rates.items(), reverse=True)
        ],
    }


def policy_page(rows):
    """The TCMB page's table for (date as DD.MM.YYYY, lending rate) rows."""
    body = "".join(
        f"<tr>\n\t<td>{day}</td>\n\t<td>-</td>\n\t<td>{rate}</td>\n</tr>\n" for day, rate in rows
    )
    return (
        '<html><table id="midTable"><thead><tr><th>DATE</th><th>Borrowing</th>'
        f"<th>Lending</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr>{body}</tbody></table></html>"
    )


POLICY_ROWS = [(f"{day:02d}.01.2020", f"{10 + day}.00") for day in range(1, 11)] + [
    ("23.01.2026", "37.00"),
    ("23.10.2026", "36.00"),
]


class ParseTlrefTest(unittest.TestCase):
    def test_maps_dates_to_rates(self):
        rates = {"2026-10-01": 39.9846, "2026-09-30": 40.0}
        self.assertEqual(fetch_funds.parse_tlref(tlref_response(rates)), rates)

    def test_keeps_the_date_of_a_timestamp(self):
        raw = tlref_response({"2026-10-01": 39.5})
        raw["data"][0]["date"] = "2026-10-01T00:00:00"
        self.assertEqual(fetch_funds.parse_tlref(raw), {"2026-10-01": 39.5})

    def test_rejects_an_unexpected_response(self):
        good = tlref_response({"2026-10-01": 39.5})
        for raw in [
            [],
            {"status": "error", "data": good["data"]},
            {"status": "success"},
            {"status": "success", "data": []},
            {"status": "success", "data": [{"date": "2026-10-01"}]},
            {"status": "success", "data": [{"date": "01.10.2026", "clval": "39.5"}]},
            {"status": "success", "data": [{"date": "2026-10-01", "clval": "n/a"}]},
            {"status": "success", "data": [{"date": "2026-10-01", "clval": None}]},
            {"status": "success", "data": [{"date": "2026-10-01", "clval": "-1"}]},
            {"status": "success", "data": [{"date": "2026-10-01", "clval": "3950"}]},
            {"status": "success", "data": [{"date": "2026-10-01", "clval": "nan"}]},
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                fetch_funds.parse_tlref(raw)


class ParsePolicyRateTest(unittest.TestCase):
    def test_returns_the_changes_oldest_first(self):
        changes = fetch_funds.parse_policy_rate(policy_page(reversed(POLICY_ROWS)))
        self.assertEqual(len(changes), len(POLICY_ROWS))
        self.assertEqual(changes[0], ("2020-01-01", 11.0))
        self.assertEqual(changes[-2:], [("2026-01-23", 37.0), ("2026-10-23", 36.0)])

    def test_reads_a_decimal_comma(self):
        rows = POLICY_ROWS[:-1] + [("23.10.2026", "36,50")]
        self.assertEqual(fetch_funds.parse_policy_rate(policy_page(rows))[-1], ("2026-10-23", 36.5))

    def test_rejects_a_page_without_the_table(self):
        for page in ["<html>Request Rejected</html>", policy_page(POLICY_ROWS[:3])]:
            with self.subTest(page=page[:30]), self.assertRaisesRegex(ValueError, "policy rates found"):
                fetch_funds.parse_policy_rate(page)

    def test_rejects_a_rate_that_is_not_a_number(self):
        rows = POLICY_ROWS[:-1] + [("23.10.2026", "-")]
        with self.assertRaises(ValueError):
            fetch_funds.parse_policy_rate(policy_page(rows))

    def test_rejects_an_impossible_date(self):
        rows = POLICY_ROWS[:-1] + [("31.02.2026", "36.00")]
        with self.assertRaises(ValueError):
            fetch_funds.parse_policy_rate(policy_page(rows))


class PolicyRateOnTest(unittest.TestCase):
    CHANGES = [("2026-01-23", 37.0), ("2026-10-23", 36.0)]

    def test_each_date_has_the_rate_in_effect(self):
        dates = ["2026-01-22", "2026-01-23", "2026-10-22", "2026-10-23", "2026-11-12"]
        self.assertEqual(
            fetch_funds.policy_rate_on(self.CHANGES, dates),
            {"2026-01-23": 37.0, "2026-10-22": 37.0, "2026-10-23": 36.0, "2026-11-12": 36.0},
        )


class RatesForTest(unittest.TestCase):
    def test_one_rate_per_price_date(self):
        known = {"2026-09-29": 1.0, "2026-09-30": 2.0, "2026-10-01": 3.0, "2026-10-02": 4.0}
        self.assertEqual(fetch_funds.rates_for(DATES, known), [2.0, 3.0, 4.0])

    def test_a_date_without_a_rate_takes_the_latest_earlier_one(self):
        self.assertEqual(
            fetch_funds.rates_for(DATES, {"2026-09-29": 1.0, "2026-10-01": 3.0}),
            [1.0, 3.0, 3.0],
        )

    def test_but_not_one_that_is_too_old(self):
        limit = fetch_funds.RATE_MAX_AGE_DAYS
        day = date(2026, 10, 2)
        at_limit = (day - timedelta(days=limit)).isoformat()
        too_old = (day - timedelta(days=limit + 1)).isoformat()
        self.assertEqual(fetch_funds.rates_for([day.isoformat()], {at_limit: 5.0}), [5.0])
        self.assertEqual(fetch_funds.rates_for([day.isoformat()], {too_old: 5.0}), [None])

    def test_no_rates_at_all(self):
        self.assertEqual(fetch_funds.rates_for(DATES, {}), [None, None, None])
        # A later rate is never used for an earlier date.
        self.assertEqual(fetch_funds.rates_for(DATES, {"2026-10-03": 9.0}), [None, None, None])


class ExistingRatesTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "funds.json"

    def write(self, data):
        self.path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")

    def test_maps_each_rate_to_its_price_date(self):
        self.write(
            {
                "priceDates": DATES,
                "riskFreeRates": {"tlref": [40.0, None, 39.5], "policy": [37.0, 37.0, 36.0]},
                "funds": [],
            }
        )
        self.assertEqual(
            fetch_funds.existing_rates(self.path),
            {
                "tlref": {DATES[0]: 40.0, DATES[2]: 39.5},
                "policy": {DATES[0]: 37.0, DATES[1]: 37.0, DATES[2]: 36.0},
            },
        )

    def test_a_file_without_usable_rates_has_none(self):
        self.assertEqual(fetch_funds.existing_rates(self.path), {})  # no file
        for data in [
            "<html>oops</html>",
            {"priceDates": DATES, "funds": []},
            {"priceDates": DATES, "riskFreeRates": {"tlref": ["high", 1, 2]}},
            {"priceDates": DATES, "riskFreeRates": [1, 2, 3]},
            {"riskFreeRates": {"tlref": [1, 2, 3]}},
            [],
        ]:
            with self.subTest(data=data):
                self.write(data)
                self.assertEqual(fetch_funds.existing_rates(self.path), {})


class FetchRatesTest(unittest.TestCase):
    """The two rate requests, with the network mocked."""

    def setUp(self):
        self.urlopen = mock.patch.object(fetch_funds.urllib.request, "urlopen").start()
        mock.patch.object(fetch_funds.time, "sleep").start()
        mock.patch.object(fetch_funds.sys, "stderr", io.StringIO()).start()
        self.addCleanup(mock.patch.stopall)

    def test_tlref_is_a_get_request_for_the_given_days(self):
        self.urlopen.return_value = response(json.dumps(tlref_response({"2026-10-01": 39.5})))
        self.assertEqual(fetch_funds.fetch_tlref(200), {"2026-10-01": 39.5})
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertTrue(request.full_url.startswith("https://www.borsaistanbul.com/"))
        self.assertTrue(request.full_url.endswith("&day=200"))
        self.assertEqual(request.get_header("Referer"), fetch_funds.TLREF_PAGE_URL)

    def test_the_policy_rate_is_a_get_request_for_the_tcmb_page(self):
        self.urlopen.return_value = response(policy_page(POLICY_ROWS))
        self.assertEqual(fetch_funds.fetch_policy_rate()[-1], ("2026-10-23", 36.0))
        request = self.urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, fetch_funds.POLICY_RATE_URL)

    def test_a_broken_response_is_retried_then_given_up(self):
        self.urlopen.side_effect = lambda *args, **kwargs: response("<html>Request Rejected</html>")
        for fetch_rate in [lambda: fetch_funds.fetch_tlref(200), fetch_funds.fetch_policy_rate]:
            self.urlopen.reset_mock()
            with self.assertRaises(RuntimeError):
                fetch_rate()
            self.assertEqual(self.urlopen.call_count, fetch_funds.RATE_ATTEMPTS)


class RiskFreeRatesTest(unittest.TestCase):
    TLREF = {"2026-09-29": 40.2, "2026-09-30": 40.1, "2026-10-01": 40.0}
    CHANGES = [("2026-01-23", 37.0), ("2026-10-02", 36.0)]

    def setUp(self):
        self.fetch_tlref = mock.patch.object(fetch_funds, "fetch_tlref", return_value=self.TLREF).start()
        self.fetch_policy_rate = mock.patch.object(
            fetch_funds, "fetch_policy_rate", return_value=self.CHANGES
        ).start()
        self.stderr = mock.patch.object(fetch_funds.sys, "stderr", io.StringIO()).start()
        self.addCleanup(mock.patch.stopall)

    def rates(self, existing=None):
        return fetch_funds.risk_free_rates(DATES, 182, existing or {})

    def test_a_rate_per_price_date_from_both_sources(self):
        self.assertEqual(
            self.rates(),
            # The newest date has no TLREF yet and takes the day before's.
            {"tlref": [40.1, 40.0, 40.0], "policy": [37.0, 37.0, 36.0]},
        )
        # TLREF is asked for from before the window's first date.
        (days,), _ = self.fetch_tlref.call_args
        self.assertGreater(days, 182)
        self.assertEqual(self.stderr.getvalue(), "")

    def test_fetched_rates_replace_the_existing_ones(self):
        existing = {"tlref": {DATES[0]: 1.0, DATES[2]: 2.0}, "policy": {DATES[0]: 3.0}}
        self.assertEqual(
            self.rates(existing),
            {"tlref": [40.1, 40.0, 2.0], "policy": [37.0, 37.0, 36.0]},
        )

    def test_a_source_that_fails_keeps_the_existing_rates(self):
        existing = {
            "tlref": {DATES[0]: 40.1, DATES[1]: 40.0},
            "policy": {DATES[0]: 37.0, DATES[1]: 37.0},
        }
        expected = self.rates(existing)
        for name, broken, error in [
            ("tlref", self.fetch_tlref, RuntimeError("Could not fetch")),
            ("policy", self.fetch_policy_rate, ValueError("no table")),
            ("tlref", self.fetch_tlref, KeyError("date")),
        ]:
            with self.subTest(name=name, error=error):
                self.stderr.seek(0)
                self.stderr.truncate()
                broken.side_effect = error
                rates = self.rates(existing)
                broken.side_effect = None
                # The new date takes the latest earlier rate of the old file.
                kept = existing[name]
                self.assertEqual(rates[name], [kept[DATES[0]], kept[DATES[1]], kept[DATES[1]]])
                other = "policy" if name == "tlref" else "tlref"
                self.assertEqual(rates[other], expected[other])
                self.assertIn(f"Keeping the earlier {name} rates", self.stderr.getvalue())

    def test_no_source_and_no_existing_rates_gives_none(self):
        self.fetch_tlref.side_effect = RuntimeError("down")
        self.fetch_policy_rate.side_effect = RuntimeError("down")
        self.assertEqual(
            self.rates(), {"tlref": [None, None, None], "policy": [None, None, None]}
        )


def data_file(fetched_at, codes=("AAA",)):
    """The text of a funds.json fetched at fetched_at."""
    funds = [{"code": code, "returns": {}, "prices": []} for code in codes]
    return fetch_funds.render(funds, fetched_at, DATES)


class RotatePreviousTest(unittest.TestCase):
    NOW = "2026-10-28T07:15:00Z"  # 10:15 on 28 Oct in Istanbul

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.output = self.directory / "funds.json"
        self.previous = self.directory / "previous.json"
        stdout = mock.patch("sys.stdout", new_callable=io.StringIO)
        stderr = mock.patch("sys.stderr", new_callable=io.StringIO)
        stdout.start()
        self.stderr = stderr.start()
        self.addCleanup(stdout.stop)
        self.addCleanup(stderr.stop)

    def rotate(self):
        return fetch_funds.rotate_previous(str(self.output), str(self.previous), self.NOW)

    def files(self):
        return sorted(os.listdir(self.directory))

    def test_keeps_data_from_an_earlier_day(self):
        old = data_file("2026-10-27T07:15:00Z")
        self.output.write_text(old, encoding="utf-8")
        self.previous.write_text(data_file("2026-10-24T07:15:00Z"), encoding="utf-8")
        self.assertTrue(self.rotate())
        self.assertEqual(self.previous.read_text(encoding="utf-8"), old)
        self.assertEqual(self.output.read_text(encoding="utf-8"), old)
        self.assertEqual(self.files(), ["funds.json", "previous.json"])

    def test_compares_istanbul_dates(self):
        # 23:30 UTC on 27 Oct is already 02:30 on 28 Oct in Istanbul.
        self.output.write_text(data_file("2026-10-27T23:30:00Z"), encoding="utf-8")
        self.assertFalse(self.rotate())
        self.assertFalse(self.previous.exists())
        # 20:59 UTC on 27 Oct is still 23:59 on 27 Oct in Istanbul.
        self.output.write_text(data_file("2026-10-27T20:59:00Z"), encoding="utf-8")
        self.assertTrue(self.rotate())
        self.assertTrue(self.previous.exists())

    def test_leaves_previous_alone_when_the_data_is_from_the_same_day(self):
        kept = data_file("2026-10-27T07:15:00Z")
        self.previous.write_text(kept, encoding="utf-8")
        self.output.write_text(data_file("2026-10-28T07:16:00Z"), encoding="utf-8")
        self.assertFalse(self.rotate())
        self.assertEqual(self.previous.read_text(encoding="utf-8"), kept)

    def test_missing_output_writes_no_previous(self):
        self.assertFalse(self.rotate())
        self.assertEqual(self.files(), [])
        self.assertEqual(self.stderr.getvalue(), "")

    def test_invalid_output_writes_no_previous(self):
        kept = data_file("2026-10-24T07:15:00Z")
        for text in [
            "not json",
            "[]",
            '{"fetchedAt": "2026-10-27T07:15:00Z"}',
            '{"funds": []}',
            '{"fetchedAt": "yesterday", "funds": []}',
            '{"fetchedAt": 5, "funds": []}',
        ]:
            with self.subTest(text=text):
                self.output.write_text(text, encoding="utf-8")
                self.previous.write_text(kept, encoding="utf-8")
                self.assertFalse(self.rotate())
                self.assertEqual(self.previous.read_text(encoding="utf-8"), kept)
                self.assertIn("Not keeping the previous data", self.stderr.getvalue())

    def test_a_failed_write_is_only_logged(self):
        self.output.write_text(data_file("2026-10-27T07:15:00Z"), encoding="utf-8")
        with mock.patch.object(fetch_funds.os, "replace", side_effect=OSError("disk full")):
            self.assertFalse(self.rotate())
        self.assertFalse(self.previous.exists())
        self.assertIn("disk full", self.stderr.getvalue())
        self.assertEqual(self.files(), ["funds.json"])


class FixedDatetime(fetch_funds.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 28, 7, 15, 0, 123, tzinfo=tz)


@small_limits
class MainTest(unittest.TestCase):
    """The whole script with TEFAS mocked: which files it writes."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.output = self.directory / "funds.json"
        self.previous = self.directory / "previous.json"
        for patcher in [
            # A window that one price request covers.
            mock.patch.object(fetch_funds, "PRICE_WINDOW_DAYS", fetch_funds.PRICE_REQUEST_DAYS),
            mock.patch.object(fetch_funds, "datetime", FixedDatetime),
            mock.patch("sys.argv", ["fetch_funds.py", str(self.output)]),
            mock.patch("sys.stdout", new_callable=io.StringIO),
            mock.patch("sys.stderr", new_callable=io.StringIO),
            mock.patch.object(fetch_funds, "fetch_tlref", return_value=self.TLREF),
            mock.patch.object(fetch_funds, "fetch_policy_rate", return_value=self.CHANGES),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)

    TLREF = {DATES[0]: 40.1, DATES[1]: 40.0}
    CHANGES = [("2026-01-23", 37.0), (DATES[2], 36.0)]
    RATES = {"tlref": [40.1, 40.0, 40.0], "policy": [37.0, 37.0, 36.0]}

    def run_main(self, responses=None):
        responses = responses or [funds_response(), prices_response()]
        with mock.patch.object(fetch_funds, "fetch_json", side_effect=responses):
            fetch_funds.main()

    def test_moves_yesterdays_data_to_previous(self):
        old = data_file("2026-10-27T07:15:00Z", ["OLD"])
        self.output.write_text(old, encoding="utf-8")
        self.run_main()
        self.assertEqual(self.previous.read_text(encoding="utf-8"), old)
        new = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(new["fetchedAt"], "2026-10-28T07:15:00Z")
        self.assertEqual(codes_of(new["funds"]), CODES)

    def test_writes_the_rates_for_the_price_dates(self):
        self.run_main()
        new = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(new["priceDates"], DATES)
        self.assertEqual(new["riskFreeRates"], self.RATES)

    def test_rates_that_cannot_be_fetched_do_not_stop_the_update(self):
        self.run_main()
        with mock.patch.object(fetch_funds, "fetch_tlref", side_effect=RuntimeError("down")), \
                mock.patch.object(fetch_funds, "fetch_policy_rate", side_effect=ValueError("no table")):
            # The rates of the file being replaced are kept.
            self.run_main()
            new = json.loads(self.output.read_text(encoding="utf-8"))
            self.assertEqual(new["riskFreeRates"], self.RATES)
            self.assertEqual(codes_of(new["funds"]), CODES)
            # With no earlier file there are no rates, and still the fund data.
            self.output.unlink()
            self.run_main()
            new = json.loads(self.output.read_text(encoding="utf-8"))
            self.assertEqual(new["riskFreeRates"], {"tlref": [None] * 3, "policy": [None] * 3})
            self.assertEqual(codes_of(new["funds"]), CODES)

    def test_a_second_run_on_the_same_day_keeps_previous(self):
        old = data_file("2026-10-27T07:15:00Z", ["OLD"])
        self.output.write_text(old, encoding="utf-8")
        self.run_main()
        self.run_main()
        self.assertEqual(self.previous.read_text(encoding="utf-8"), old)
        self.assertEqual(codes_of(json.loads(self.output.read_text(encoding="utf-8"))["funds"]), CODES)

    def test_first_run_writes_no_previous(self):
        self.run_main()
        self.assertTrue(self.output.exists())
        self.assertFalse(self.previous.exists())

    def test_invalid_old_file_writes_no_previous_but_the_new_data(self):
        self.output.write_text("<html>oops</html>", encoding="utf-8")
        self.run_main()
        self.assertFalse(self.previous.exists())
        self.assertEqual(codes_of(json.loads(self.output.read_text(encoding="utf-8"))["funds"]), CODES)

    def test_a_failed_or_invalid_fetch_changes_neither_file(self):
        old = data_file("2026-10-27T07:15:00Z", ["OLD"])
        kept = data_file("2026-10-24T07:15:00Z", ["OLDER"])
        for responses in [
            [RuntimeError("Could not fetch data from TEFAS")],
            [funds_response(CODES[:1]), prices_response()],  # too few funds
            [funds_response(), prices_response(dates=DATES[:1])],  # too few dates
        ]:
            with self.subTest(responses=responses):
                self.output.write_text(old, encoding="utf-8")
                self.previous.write_text(kept, encoding="utf-8")
                with self.assertRaises((RuntimeError, ValueError)):
                    self.run_main(responses)
                self.assertEqual(self.output.read_text(encoding="utf-8"), old)
                self.assertEqual(self.previous.read_text(encoding="utf-8"), kept)
                self.assertEqual(sorted(os.listdir(self.directory)), ["funds.json", "previous.json"])


if __name__ == "__main__":
    unittest.main()
