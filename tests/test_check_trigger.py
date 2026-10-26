# Run with: npm test (or only these: python3 -m unittest discover -s tests -v)
"""Tests for scripts/check_trigger.py. They make no network calls."""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_trigger.py"
spec = importlib.util.spec_from_file_location("check_trigger", SCRIPT)
check_trigger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_trigger)

OWNER = "owner-login"
RUN_URL = "https://github.com/o/r/actions/runs/1"
README_URL = "https://github.com/o/r#daily-trigger-cron-joborg"


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def run(created_at, event="workflow_dispatch", conclusion="success"):
    """A `gh run list --json createdAt,event,conclusion` entry."""
    return {"createdAt": created_at, "event": event, "conclusion": conclusion}


# Shaped like the real `gh run list` output for update.yml in October 2026.
TODAY_DISPATCH = run("2026-10-26T07:15:29Z")
YESTERDAY_DISPATCH = run("2026-10-23T07:15:28Z")
TODAY_SCHEDULE = run("2026-10-26T14:23:57Z", event="schedule")
# A typical late fallback run on Monday 2026-10-26 (17:23 Istanbul).
FALLBACK_NOW = utc("2026-10-26T14:23:57")


class TriggerDayTest(unittest.TestCase):
    def test_afternoon_run_checks_the_same_day(self):
        self.assertEqual(check_trigger.trigger_day(FALLBACK_NOW), date(2026, 10, 26))

    def test_on_time_run_checks_the_same_day(self):
        # 09:37 UTC is 12:37 Istanbul, the fallback's scheduled time.
        self.assertEqual(
            check_trigger.trigger_day(utc("2026-10-26T09:37:00")), date(2026, 10, 26)
        )

    def test_run_just_before_istanbul_midnight_checks_that_day(self):
        # 20:59 UTC is 23:59 Istanbul.
        self.assertEqual(
            check_trigger.trigger_day(utc("2026-10-26T20:59:00")), date(2026, 10, 26)
        )

    def test_run_started_after_istanbul_midnight_checks_the_previous_day(self):
        # 21:30 UTC Monday is 00:30 Tuesday in Istanbul: still Monday's fallback.
        self.assertEqual(
            check_trigger.trigger_day(utc("2026-10-26T21:30:00")), date(2026, 10, 26)
        )

    def test_late_friday_run_on_saturday_checks_friday(self):
        self.assertEqual(
            check_trigger.trigger_day(utc("2026-10-31T02:00:00")), date(2026, 10, 30)
        )


class DecideTest(unittest.TestCase):
    def decide(self, runs, issues=(), now=FALLBACK_NOW):
        action, issue, _day = check_trigger.decide(list(runs), list(issues), now)
        return action, issue

    def test_dispatch_run_today_needs_no_alert(self):
        self.assertEqual(self.decide([TODAY_SCHEDULE, TODAY_DISPATCH]), ("none", None))

    def test_no_dispatch_run_today_opens_an_issue(self):
        self.assertEqual(
            self.decide([TODAY_SCHEDULE, YESTERDAY_DISPATCH]), ("open", None)
        )

    def test_no_runs_at_all_opens_an_issue(self):
        self.assertEqual(self.decide([]), ("open", None))

    def test_failed_dispatch_run_today_is_not_a_trigger_problem(self):
        failed = run("2026-10-26T07:15:29Z", conclusion="failure")
        self.assertEqual(self.decide([failed]), ("none", None))

    def test_queued_dispatch_run_today_counts(self):
        queued = {"createdAt": "2026-10-26T07:15:29Z", "event": "workflow_dispatch"}
        self.assertEqual(self.decide([queued]), ("none", None))

    def test_schedule_and_push_runs_are_not_dispatch_runs(self):
        push = run("2026-10-26T08:00:00Z", event="push")
        self.assertEqual(self.decide([TODAY_SCHEDULE, push]), ("open", None))

    def test_missed_trigger_with_an_open_issue_comments_on_it(self):
        self.assertEqual(
            self.decide([YESTERDAY_DISPATCH], [{"number": 21}]), ("comment", 21)
        )

    def test_comments_on_the_oldest_open_issue(self):
        self.assertEqual(
            self.decide([], [{"number": 30}, {"number": 21}]), ("comment", 21)
        )

    def test_working_trigger_closes_the_open_issue(self):
        self.assertEqual(self.decide([TODAY_DISPATCH], [{"number": 21}]), ("close", 21))

    def test_dispatch_just_after_istanbul_midnight_belongs_to_the_new_day(self):
        # 21:00 UTC Sunday is 00:00 Monday in Istanbul.
        self.assertEqual(self.decide([run("2026-10-25T21:00:00Z")]), ("none", None))

    def test_dispatch_just_before_istanbul_midnight_belongs_to_the_old_day(self):
        # 20:59 UTC Monday is 23:59 Monday in Istanbul; Tuesday's check misses it.
        tuesday = utc("2026-10-27T14:00:00")
        self.assertEqual(
            self.decide([run("2026-10-26T20:59:59Z")], now=tuesday), ("open", None)
        )

    def test_fallback_after_midnight_still_finds_that_mornings_dispatch(self):
        self.assertEqual(
            self.decide([TODAY_DISPATCH], now=utc("2026-10-26T22:30:00")),
            ("none", None),
        )


class MessageTest(unittest.TestCase):
    def message(self, action):
        return check_trigger.message(
            action, date(2026, 10, 26), OWNER, RUN_URL, README_URL
        )

    def test_new_issue_mentions_the_owner_and_links_the_token_steps(self):
        body = self.message("open")
        self.assertTrue(body.startswith(f"@{OWNER} "))
        self.assertIn("2026-10-26", body)
        self.assertIn("HTTP 401", body)
        self.assertIn(README_URL, body)
        self.assertIn(RUN_URL, body)

    def test_comment_has_the_date_and_the_run(self):
        body = self.message("comment")
        self.assertIn("2026-10-26", body)
        self.assertIn(RUN_URL, body)

    def test_closing_comment_says_the_trigger_works_again(self):
        body = self.message("close")
        self.assertIn("works again", body)
        self.assertIn(RUN_URL, body)

    def test_no_action_has_no_message(self):
        self.assertEqual(self.message("none"), "")


class MainTest(unittest.TestCase):
    def main(self, runs, issues, now):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "runs.json").write_text(json.dumps(runs), encoding="utf-8")
            (tmp / "issues.json").write_text(json.dumps(issues), encoding="utf-8")
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                check_trigger.main(
                    [
                        str(tmp / "runs.json"),
                        str(tmp / "issues.json"),
                        "--owner", OWNER,
                        "--run-url", RUN_URL,
                        "--readme-url", README_URL,
                        "--message-file", str(tmp / "message.md"),
                        "--now", now,
                    ]
                )
            return stdout.getvalue(), (tmp / "message.md").read_text(encoding="utf-8")

    def test_prints_github_output_lines_and_writes_the_issue_body(self):
        output, body = self.main(
            [TODAY_SCHEDULE, YESTERDAY_DISPATCH], [], "2026-10-26T14:23:57Z"
        )
        self.assertEqual(output, "action=open\nissue=\nday=2026-10-26\n")
        self.assertIn(f"@{OWNER}", body)

    def test_close_names_the_issue(self):
        output, body = self.main([TODAY_DISPATCH], [{"number": 21}], "2026-10-26T14:23:57Z")
        self.assertEqual(output, "action=close\nissue=21\nday=2026-10-26\n")
        self.assertIn("works again", body)

    def test_nothing_to_do_writes_an_empty_message(self):
        output, body = self.main([TODAY_DISPATCH], [], "2026-10-26T14:23:57Z")
        self.assertEqual(output, "action=none\nissue=\nday=2026-10-26\n")
        self.assertEqual(body, "")


if __name__ == "__main__":
    unittest.main()
