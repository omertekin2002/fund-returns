# Run with: npm test (or only these: python3 -m unittest discover -s tests -v)
"""Tests for scripts/fallback_action.py. They make no network calls."""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "fallback_action.py"
spec = importlib.util.spec_from_file_location("fallback_action", SCRIPT)
fallback_action = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fallback_action)


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


# Friday 2026-11-20: the 10:15 run fetched at 10:15:31 Istanbul (07:15:31 UTC).
TODAY_EDITION = utc("2026-11-20T07:15:31")
# Thursday's edition, the one a failed Friday deploy leaves live.
YESTERDAY_EDITION = utc("2026-11-19T07:15:28")
# The fallback started on time, 12:37 Istanbul.
FALLBACK_NOW = utc("2026-11-20T09:37:00")


def funds_json(fetched_at):
    return json.dumps({"fetchedAt": fetched_at, "funds": []})


class DecideTest(unittest.TestCase):
    def action(self, committed, live, now=FALLBACK_NOW):
        return fallback_action.decide(committed, live, now)[0]

    def test_no_edition_today_fetches(self):
        self.assertEqual(self.action(YESTERDAY_EDITION, YESTERDAY_EDITION), "fetch")

    def test_no_edition_today_fetches_whatever_the_site_serves(self):
        self.assertEqual(self.action(YESTERDAY_EDITION, None), "fetch")

    def test_matching_live_edition_skips(self):
        self.assertEqual(self.action(TODAY_EDITION, TODAY_EDITION), "skip")

    def test_same_moment_in_another_offset_still_matches(self):
        live = TODAY_EDITION.astimezone(fallback_action.ISTANBUL)
        self.assertEqual(self.action(TODAY_EDITION, live), "skip")

    def test_older_live_edition_recovers(self):
        action, reason = fallback_action.decide(
            TODAY_EDITION, YESTERDAY_EDITION, FALLBACK_NOW
        )
        self.assertEqual(action, "recover")
        self.assertIn("2026-11-19T07:15:28Z", reason)

    def test_other_live_edition_from_today_recovers(self):
        # E.g. a manual run fetched again after the 10:15 deploy failed.
        self.assertEqual(
            self.action(TODAY_EDITION, utc("2026-11-20T06:00:00")), "recover"
        )

    def test_unreadable_live_edition_recovers(self):
        self.assertEqual(self.action(TODAY_EDITION, None), "recover")

    def test_unreadable_committed_edition_fetches(self):
        self.assertEqual(self.action(None, TODAY_EDITION), "fetch")

    def test_edition_fetched_just_after_istanbul_midnight_is_today(self):
        # 21:30 UTC Thursday is 00:30 Friday in Istanbul.
        committed = utc("2026-11-19T21:30:00")
        self.assertEqual(self.action(committed, committed), "skip")

    def test_late_run_after_istanbul_midnight_fetches_for_the_new_day(self):
        # Thursday's fallback started at 00:30 Friday Istanbul (21:30 UTC):
        # "today" is the calendar day in Istanbul, as before, so Thursday's
        # committed edition is not today's, whatever the site serves.
        now = utc("2026-11-19T21:30:00")
        self.assertEqual(self.action(YESTERDAY_EDITION, YESTERDAY_EDITION, now), "fetch")

    def test_late_run_before_istanbul_midnight_still_checks_that_day(self):
        # 20:59 UTC is 23:59 Istanbul, still Friday.
        now = utc("2026-11-20T20:59:00")
        self.assertEqual(self.action(TODAY_EDITION, YESTERDAY_EDITION, now), "recover")
        self.assertEqual(self.action(TODAY_EDITION, TODAY_EDITION, now), "skip")


class ReadFetchedAtTest(unittest.TestCase):
    def test_reads_a_funds_json(self):
        self.assertEqual(
            fallback_action.read_fetched_at(funds_json("2026-11-20T07:15:31Z")),
            TODAY_EDITION,
        )

    def test_unreadable_texts_give_none(self):
        for text in [
            "",
            "<!DOCTYPE html><title>Page not found</title>",
            "[]",
            "{}",
            '{"fetchedAt": null}',
            '{"fetchedAt": 12}',
            '{"fetchedAt": "yesterday"}',
            '{"fetchedAt": "2026-11-20T07:15:31"}',  # no time zone
            '{"fetchedAt": "2026-11-20T07:15',  # cut off
        ]:
            with self.subTest(text=text):
                self.assertIsNone(fallback_action.read_fetched_at(text))


class MainTest(unittest.TestCase):
    def main(self, committed, live=None, now="2026-11-20T09:37:00Z", live_path=None):
        with tempfile.TemporaryDirectory() as tmp:
            committed_path = Path(tmp) / "funds.json"
            committed_path.write_text(committed, encoding="utf-8")
            args = [str(committed_path), "--now", now]
            if live is not None:
                live_path = Path(tmp) / "live.json"
                live_path.write_text(live, encoding="utf-8")
            if live_path is not None:
                args += ["--live", str(live_path)]
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                fallback_action.main(args)
        return dict(line.split("=", 1) for line in out.getvalue().splitlines())

    def test_prints_github_output_lines_for_skip(self):
        same = funds_json("2026-11-20T07:15:31Z")
        self.assertEqual(
            self.main(same, same),
            {
                "action": "skip",
                "committed": "2026-11-20T07:15:31Z",
                "live": "2026-11-20T07:15:31Z",
                "reason": "today's edition is committed and live",
            },
        )

    def test_recovers_from_an_older_live_edition(self):
        output = self.main(
            funds_json("2026-11-20T07:15:31Z"), funds_json("2026-11-19T07:15:28Z")
        )
        self.assertEqual(output["action"], "recover")
        self.assertEqual(output["live"], "2026-11-19T07:15:28Z")

    def test_recovers_when_the_probe_saved_nothing(self):
        output = self.main(funds_json("2026-11-20T07:15:31Z"))
        self.assertEqual(output["action"], "recover")
        self.assertEqual(output["live"], "")

    def test_recovers_when_the_live_file_is_missing(self):
        output = self.main(
            funds_json("2026-11-20T07:15:31Z"), live_path="/nonexistent/live.json"
        )
        self.assertEqual(output["action"], "recover")

    def test_recovers_from_an_error_page(self):
        output = self.main(funds_json("2026-11-20T07:15:31Z"), "<html>404</html>")
        self.assertEqual(output["action"], "recover")

    def test_fetches_when_the_committed_edition_is_old(self):
        output = self.main(funds_json("2026-11-19T07:15:28Z"))
        self.assertEqual(output["action"], "fetch")
        self.assertEqual(output["committed"], "2026-11-19T07:15:28Z")

    def test_every_output_is_one_line(self):
        output = self.main(
            funds_json("2026-11-20T07:15:31Z"), funds_json("2026-11-19T07:15:28Z")
        )
        self.assertEqual(set(output), {"action", "committed", "live", "reason"})


if __name__ == "__main__":
    unittest.main()
