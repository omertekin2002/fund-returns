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
        dates, prices = fetch_funds.parse_prices(
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
        _, prices = fetch_funds.parse_prices(raw, CODES)
        self.assertEqual(prices["AAA"], [None, 2.25, 1.5])
        self.assertEqual(prices["BBB"], [None, 1.5, 1.5])
        self.assertEqual(prices["CCC"], [None, 1.5, 1.5])

    def test_ignores_codes_not_in_the_fund_list(self):
        raw = prices_response(CODES + ["ZZZ"])
        _, prices = fetch_funds.parse_prices(raw, CODES)
        self.assertEqual(sorted(prices), CODES)
        # Nor do they count as priced funds.
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            fetch_funds.parse_prices(raw, CODES[:2] + ["DDD"])

    def test_rejects_a_list_that_may_be_cut_off(self):
        codes = CODES + ["DDD"]
        dates = DATES + ["2026-10-05", "2026-10-06"]
        raw = prices_response(codes, dates)
        self.assertEqual(len(raw["resultList"]), MAX_ROWS)
        with self.assertRaisesRegex(ValueError, "may be cut off"):
            fetch_funds.parse_prices(raw, codes)
        raw["resultList"].pop()
        fetch_funds.parse_prices(raw, codes)

    def test_rejects_too_few_dates(self):
        dates, _ = fetch_funds.parse_prices(prices_response(), CODES)
        self.assertEqual(len(dates), MIN_DATES)
        with self.assertRaisesRegex(ValueError, "only 2 dates"):
            fetch_funds.parse_prices(prices_response(dates=DATES[:2]), CODES)

    def test_rejects_too_few_priced_funds(self):
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            fetch_funds.parse_prices(prices_response(CODES[:2]), CODES)
        # A fund whose prices are all missing doesn't count.
        raw = prices_response()
        for row in raw["resultList"]:
            if row["fonKodu"] == "CCC":
                row["fiyat"] = 0
        with self.assertRaisesRegex(ValueError, "Prices for only 2 funds"):
            fetch_funds.parse_prices(raw, CODES)

    def test_rejects_a_row_missing_a_field(self):
        for field in fetch_funds.PRICE_FIELDS:
            with self.subTest(field=field):
                raw = prices_response()
                raw["resultList"][4] = without(raw["resultList"][4], field)
                with self.assertRaisesRegex(ValueError, "missing fields") as caught:
                    fetch_funds.parse_prices(raw, CODES)
                self.assertIn(repr([field]), str(caught.exception))


@small_limits
class ResultRowsTest(unittest.TestCase):
    """Response checks shared by parse() and parse_prices()."""

    PARSERS = {
        "parse": fetch_funds.parse,
        "parse_prices": lambda raw: fetch_funds.parse_prices(raw, CODES),
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
        dates, _ = fetch_funds.parse_prices(
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
        fetch_funds.parse_prices(prices_response(self.codes, self.dates), self.codes)
        with self.assertRaisesRegex(ValueError, "dates returned"):
            fetch_funds.parse_prices(
                prices_response(self.codes, self.dates[1:]), self.codes
            )
        with self.assertRaisesRegex(ValueError, "funds returned"):
            fetch_funds.parse_prices(
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

    def render(self):
        return fetch_funds.render(self.funds, "2026-10-20T07:15:33Z", DATES)

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
            mock.patch.object(fetch_funds, "datetime", FixedDatetime),
            mock.patch("sys.argv", ["fetch_funds.py", str(self.output)]),
            mock.patch("sys.stdout", new_callable=io.StringIO),
            mock.patch("sys.stderr", new_callable=io.StringIO),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)

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
