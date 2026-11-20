#!/usr/bin/env python3
"""Decide what the 12:37 fallback run of update.yml does.

The 10:15 cron-job.org run commits today's site/data/ in its build job and
publishes it in a separate deploy job. The scheduled fallback has three
outcomes:

- `fetch`: the repo has no edition for today (Istanbul time). Fetch from
  TEFAS, commit and deploy, as a 10:15 run does.
- `skip`: the repo has today's edition and the live site serves the same one.
- `recover`: the repo has today's edition but the live site serves another
  (older) one, or couldn't be read. The deploy after the commit must have
  failed, so republish the committed edition without fetching or committing.
  Republishing the same bundle is harmless, so an unreadable live file means
  recover too.

Usage: python3 scripts/fallback_action.py COMMITTED_JSON [--live LIVE_JSON]
           [--now ISO_TIME]

COMMITTED_JSON is site/data/funds.json from the tip of the branch. LIVE_JSON
is data/funds.json as the Pages site served it; leave it out, or point it at a
missing or empty file, when fetching it failed. The script prints
`action=fetch|skip|recover`, `committed=<fetchedAt>`, `live=<fetchedAt>`
(empty when unreadable) and `reason=<one line>` for $GITHUB_OUTPUT. It only
decides; the workflow fetches, commits and deploys.

"Today" is the Istanbul calendar date of the current time, as the fallback
has always used: a run that GitHub starts after midnight Istanbul fetches
when the committed edition is the previous day's.

Uses only the Python standard library so the workflow needs no install step.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ISTANBUL = ZoneInfo("Europe/Istanbul")


def parse_time(value):
    """Parse a timestamp such as 2026-11-20T07:15:31Z; it needs a time zone."""
    if not isinstance(value, str):
        raise ValueError(f"not a timestamp: {value!r}")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp without a time zone: {value!r}")
    return parsed


def read_fetched_at(text):
    """The fetchedAt of a funds.json text, or None if it can't be read."""
    try:
        data = json.loads(text)
        return parse_time(data["fetchedAt"])
    except (ValueError, TypeError, KeyError):
        return None


def decide(committed, live, now):
    """Return (action, reason).

    committed, live: the fetchedAt datetimes of the committed and the live
    funds.json, or None when unreadable. now: the current time.
    """
    today = now.astimezone(ISTANBUL).date()
    if committed is None:
        return "fetch", "the committed funds.json has no readable fetchedAt"
    committed_day = committed.astimezone(ISTANBUL).date()
    if committed_day != today:
        return "fetch", f"the committed edition is from {committed_day}, not today ({today})"
    if live is None:
        return "recover", (
            "today's edition is committed, but the live data/funds.json "
            "couldn't be read"
        )
    if live != committed:
        return "recover", (
            "today's edition is committed, but the site serves the edition "
            f"fetched at {iso(live)}"
        )
    return "skip", "today's edition is committed and live"


def iso(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_text(path):
    """A file's text, or "" when there's no path or it can't be read."""
    if not path:
        return ""
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return ""


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("committed", help="the committed site/data/funds.json")
    parser.add_argument("--live", help="the live data/funds.json, if it was fetched")
    parser.add_argument("--now", type=parse_time, help="default: the current time")
    args = parser.parse_args(argv)

    committed = read_fetched_at(read_text(args.committed))
    live = read_fetched_at(read_text(args.live))
    now = args.now or datetime.now(timezone.utc)

    action, reason = decide(committed, live, now)
    print(f"action={action}")
    print(f"committed={iso(committed) if committed else ''}")
    print(f"live={iso(live) if live else ''}")
    print(f"reason={reason}")
    print(f"Fallback: {action} ({reason})", file=sys.stderr)


if __name__ == "__main__":
    main()
