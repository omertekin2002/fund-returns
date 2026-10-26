#!/usr/bin/env python3
"""Decide whether the 12:37 fallback run should report a missed 10:15 trigger.

cron-job.org starts update.yml through the API (a `workflow_dispatch` run) at
10:15 Istanbul time on weekdays. When its token expires, those calls fail with
HTTP 401 and only the GitHub schedule keeps the data updating, hours late. The
scheduled fallback run uses this script to tell the owner on GitHub.

Usage: python3 scripts/check_trigger.py RUNS_JSON ISSUES_JSON
           --owner LOGIN --run-url URL --readme-url URL --message-file PATH
           [--now ISO_TIME]

RUNS_JSON is the output of `gh run list --workflow update.yml --event
workflow_dispatch --json createdAt,event`, ISSUES_JSON the output of
`gh issue list --label <label> --state open --json number`. The script prints
`action=open|comment|close|none`, `issue=<number>` and `day=<YYYY-MM-DD>` lines
for $GITHUB_OUTPUT, and writes the issue body or comment for that action to
--message-file. It only decides; the workflow makes the API calls.

Whether a dispatch run's fetch succeeded doesn't matter: if cron-job.org
started it, the token works, and a failed fetch already shows up in Actions.

Uses only the Python standard library so the workflow needs no install step.
"""

import argparse
import json
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ISTANBUL = ZoneInfo("Europe/Istanbul")

# The fallback's time in update.yml (`37 9 * * 1-5` UTC is 12:37 Istanbul).
# GitHub often starts it hours late, sometimes after midnight Istanbul time; a
# run that starts before 12:37 belongs to the previous day's schedule.
FALLBACK_TIME = time(12, 37)


def trigger_day(now):
    """The Istanbul date whose 10:15 trigger this fallback run checks."""
    local = now.astimezone(ISTANBUL)
    if local.time() < FALLBACK_TIME:
        return local.date() - timedelta(days=1)
    return local.date()


def parse_time(value):
    """Parse a GitHub timestamp such as 2026-10-26T07:15:29Z."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp without a time zone: {value!r}")
    return parsed


def dispatched_on(runs, day):
    """Whether any workflow_dispatch run was created on the Istanbul date day."""
    return any(
        run.get("event", "workflow_dispatch") == "workflow_dispatch"
        and parse_time(run["createdAt"]).astimezone(ISTANBUL).date() == day
        for run in runs
    )


def decide(runs, open_issues, now):
    """Return (action, issue number or None, trigger day)."""
    day = trigger_day(now)
    issue = min((item["number"] for item in open_issues), default=None)
    if dispatched_on(runs, day):
        return ("close" if issue else "none"), issue, day
    return ("comment" if issue else "open"), issue, day


def message(action, day, owner, run_url, readme_url):
    """The issue body (open) or comment (comment, close) for an action."""
    if action == "open":
        return (
            f"@{owner} The 10:15 daily trigger didn't start the update on {day}.\n"
            "\n"
            "cron-job.org didn't start a `workflow_dispatch` run of `update.yml` "
            "that day, so only the GitHub schedule fallback fetched the data, "
            "hours late. The most likely cause is that the cron-job.org token "
            "has expired (cron-job.org gets HTTP 401).\n"
            "\n"
            f"Create a new token and put it in the cron-job.org job: see "
            f"[Daily trigger (cron-job.org)]({readme_url}). This issue closes "
            "itself after the next day the trigger works.\n"
            "\n"
            f"Fallback run: {run_url}\n"
        )
    if action == "comment":
        return (
            f"The 10:15 daily trigger didn't start the update on {day} either.\n"
            "\n"
            f"Fallback run: {run_url}\n"
        )
    if action == "close":
        return (
            f"The 10:15 daily trigger started the update on {day}, so it works "
            "again. Closing.\n"
            "\n"
            f"Checked by: {run_url}\n"
        )
    return ""


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("runs", help="gh run list JSON")
    parser.add_argument("issues", help="gh issue list JSON")
    parser.add_argument("--owner", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--readme-url", required=True)
    parser.add_argument("--message-file", required=True)
    parser.add_argument("--now", type=parse_time, help="default: the current time")
    args = parser.parse_args(argv)

    with open(args.runs, encoding="utf-8") as f:
        runs = json.load(f)
    with open(args.issues, encoding="utf-8") as f:
        open_issues = json.load(f)
    now = args.now or datetime.now(timezone.utc)

    action, issue, day = decide(runs, open_issues, now)
    with open(args.message_file, "w", encoding="utf-8") as f:
        f.write(message(action, day, args.owner, args.run_url, args.readme_url))
    print(f"action={action}")
    print(f"issue={issue or ''}")
    print(f"day={day.isoformat()}")
    print(f"Trigger day {day}: {action}", file=sys.stderr)


if __name__ == "__main__":
    main()
