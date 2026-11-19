#!/usr/bin/env python3
"""Choose which commit's code a data run of update.yml deploys.

Data runs (the 10:15 cron-job.org dispatch, the 12:37 fallback and manual
runs) don't run the tests, so that a test failure never holds back the daily
data. They must still not deploy code whose tests failed. This script finds
the last green commit: the newest commit on the first-parent history of the
branch whose push run of test.yml (or of update.yml, which runs the same tests
before deploying) succeeded. Then:

- If no file outside site/data/ changed between that commit and the tip, the
  tip is tested code plus data commits: deploy site/ from the tip
  (`source=tip`). That is the normal day.
- Otherwise newer code has a failed, cancelled, unfinished or missing test
  run: deploy site/ from the green commit with site/data/ from the tip
  (`source=green`), and warn.
- If no green commit is found, deploy the tip as before and warn
  (`source=tip`). The data must still go out.

Usage: python3 scripts/deploy_source.py RUNS_JSON [RUNS_JSON ...]
           --commits COMMITS_FILE [--repo DIR]

Each RUNS_JSON is the output of `gh run list --workflow <file> --branch main
--event push --json headSha,conclusion,status`. COMMITS_FILE is the output of
`git rev-list --first-parent HEAD`, newest first; its first line is the tip.
The script prints `source=tip|green`, `tip=<sha>`, `green=<sha>` (empty when
none was found) and `warning=<one line>` (empty when nothing is wrong) for
$GITHUB_OUTPUT. It only decides and reads the repository with `git diff`; the
workflow assembles the site.

Uses only the Python standard library so the workflow needs no install step.
"""

import argparse
import json
import re
import subprocess
import sys

SHA = re.compile(r"[0-9a-f]{40}([0-9a-f]{24})?")

# Files under this directory are the data a data run commits; a change to
# anything else is a code change that needs passing tests.
DATA_DIR = "site/data"


class InputError(ValueError):
    """The run list or the commit list isn't what gh or git would print."""


def parse_runs(text, name="runs"):
    """Parse one `gh run list --json headSha,conclusion,status` output."""
    try:
        runs = json.loads(text)
    except json.JSONDecodeError as error:
        raise InputError(f"{name}: not JSON ({error})") from None
    if not isinstance(runs, list):
        raise InputError(f"{name}: expected a JSON list of runs")
    for index, run in enumerate(runs):
        if not isinstance(run, dict):
            raise InputError(f"{name}: run {index} is not an object")
        sha = run.get("headSha")
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise InputError(f"{name}: run {index} has no valid headSha")
        if not isinstance(run.get("status"), str) or not run["status"]:
            raise InputError(f"{name}: run {index} has no status")
        # gh prints an empty conclusion while a run hasn't finished.
        if not isinstance(run.get("conclusion", ""), (str, type(None))):
            raise InputError(f"{name}: run {index} has an invalid conclusion")
    return runs


def parse_commits(text):
    """Parse `git rev-list --first-parent HEAD` output, newest first."""
    commits = text.split()
    if not commits:
        raise InputError("commits: the commit list is empty")
    for sha in commits:
        if not SHA.fullmatch(sha):
            raise InputError(f"commits: {sha!r} is not a full commit sha")
    return commits


def passed(run):
    return run["status"] == "completed" and run.get("conclusion") == "success"


def run_state(runs):
    """Describe a commit's push runs in a few words, for the warning."""
    if any(run["status"] != "completed" for run in runs):
        return "are still running or queued"
    conclusions = sorted({run.get("conclusion") or "unknown" for run in runs})
    return "ended as " + " / ".join(conclusions)


def code_changed(old, new, repo="."):
    """Whether any file outside site/data/ differs between two commits."""
    result = subprocess.run(
        ["git", "-C", repo, "diff", "--quiet", old, new, "--",
         ".", f":(exclude){DATA_DIR}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(
            f"git diff {old} {new} failed: {result.stderr.strip() or result.returncode}"
        )
    return result.returncode == 1


def short(sha):
    return sha[:7]


def decide(runs, commits, changed=code_changed):
    """Return (source, green sha or None, warning or "").

    runs: push runs of the test workflows, in any order; runs for commits
    that aren't on `commits` are ignored. commits: the first-parent history,
    newest first. changed(old, new): whether code changed between two shas.
    """
    tip = commits[0]
    by_sha = {}
    for run in runs:
        by_sha.setdefault(run["headSha"], []).append(run)

    green = next(
        (sha for sha in commits if any(passed(run) for run in by_sha.get(sha, []))),
        None,
    )
    if green is None:
        return "tip", None, (
            f"Deployed the tip {short(tip)} without knowing whether its code "
            f"passed the tests: none of the last {len(commits)} commits on the "
            "branch has a push run of the tests that passed."
        )
    if green == tip or not changed(green, tip):
        return "tip", green, ""

    newer = commits[: commits.index(green)]
    tested = next((sha for sha in newer if sha in by_sha), None)
    if tested is None:
        why = "no newer commit has a push run of the tests yet"
    else:
        why = f"the test runs for {short(tested)} {run_state(by_sha[tested])}"
    return "green", green, (
        f"Deployed the code of {short(green)}, the last commit whose tests "
        f"passed, with the data of the tip {short(tip)}: {why}. The newer "
        "code goes live once its tests pass."
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("runs", nargs="+", help="gh run list JSON")
    parser.add_argument("--commits", required=True,
                        help="git rev-list --first-parent HEAD output")
    parser.add_argument("--repo", default=".", help="the git checkout")
    args = parser.parse_args(argv)

    try:
        runs = []
        for path in args.runs:
            with open(path, encoding="utf-8") as f:
                runs.extend(parse_runs(f.read(), name=path))
        with open(args.commits, encoding="utf-8") as f:
            commits = parse_commits(f.read())
    except (OSError, InputError) as error:
        parser.error(str(error))

    source, green, warning = decide(
        runs, commits, changed=lambda old, new: code_changed(old, new, args.repo)
    )
    print(f"source={source}")
    print(f"tip={commits[0]}")
    print(f"green={green or ''}")
    print(f"warning={warning}")
    print(f"Deploy source: {source} (tip {commits[0]}, last green {green})",
          file=sys.stderr)


if __name__ == "__main__":
    main()
