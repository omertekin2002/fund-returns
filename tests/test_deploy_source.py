# Run with: npm test (or only these: python3 -m unittest discover -s tests -v)
"""Tests for scripts/deploy_source.py. They make no network calls; the git
tests build a throwaway repository in a temporary directory."""

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "deploy_source.py"
spec = importlib.util.spec_from_file_location("deploy_source", SCRIPT)
deploy_source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy_source)


def sha(n):
    """A fake full commit sha, distinct for each n."""
    return f"{n:040x}"


def run(head, conclusion="success", status="completed"):
    """A `gh run list --json headSha,conclusion,status` entry."""
    return {"headSha": head, "conclusion": conclusion, "status": status}


# First-parent history, newest first: two data commits (no test runs: the
# bot's pushes don't start workflows) on top of a code commit, and so on.
DATA2, DATA1, CODE3, CODE2, CODE1 = sha(5), sha(4), sha(3), sha(2), sha(1)
HISTORY = [DATA2, DATA1, CODE3, CODE2, CODE1]


def no_code_changed(old, new):
    return False


def code_changed_after(*code_shas):
    """A changed(old, new) for HISTORY: true if a code commit is in (old, new]."""

    def changed(old, new):
        span = HISTORY[HISTORY.index(new) : HISTORY.index(old)]
        return any(c in span for c in code_shas)

    return changed


class DecideTest(unittest.TestCase):
    def decide(self, runs, commits=HISTORY, changed=code_changed_after(CODE3, CODE2)):
        return deploy_source.decide(runs, list(commits), changed)

    def test_tip_already_green_deploys_the_tip(self):
        source, green, warning = self.decide([run(CODE3)], commits=HISTORY[2:])
        self.assertEqual((source, green, warning), ("tip", CODE3, ""))

    def test_tip_green_needs_no_diff(self):
        def changed(old, new):
            raise AssertionError("diff not needed")

        self.assertEqual(
            self.decide([run(CODE3)], commits=HISTORY[2:], changed=changed)[0], "tip"
        )

    def test_data_commits_on_top_of_green_code_deploy_the_tip(self):
        source, green, warning = self.decide([run(CODE3), run(CODE2)])
        self.assertEqual((source, green, warning), ("tip", CODE3, ""))

    def test_failed_run_on_newer_code_deploys_the_green_code(self):
        source, green, warning = self.decide([run(CODE3, "failure"), run(CODE2)])
        self.assertEqual((source, green), ("green", CODE2))
        self.assertIn(CODE2[:7], warning)
        self.assertIn(DATA2[:7], warning)
        self.assertIn(f"test runs for {CODE3[:7]} ended as failure", warning)

    def test_cancelled_run_on_newer_code_deploys_the_green_code(self):
        source, green, warning = self.decide([run(CODE3, "cancelled"), run(CODE2)])
        self.assertEqual((source, green), ("green", CODE2))
        self.assertIn("ended as cancelled", warning)

    def test_in_progress_run_on_newer_code_deploys_the_green_code(self):
        runs = [run(CODE3, "", "in_progress"), run(CODE2)]
        source, green, warning = self.decide(runs)
        self.assertEqual((source, green), ("green", CODE2))
        self.assertIn("still running or queued", warning)

    def test_queued_run_on_newer_code_deploys_the_green_code(self):
        source, green, warning = self.decide([run(CODE3, None, "queued"), run(CODE2)])
        self.assertEqual((source, green), ("green", CODE2))
        self.assertIn("still running or queued", warning)

    def test_newer_code_without_a_run_deploys_the_green_code(self):
        source, green, warning = self.decide([run(CODE2)])
        self.assertEqual((source, green), ("green", CODE2))
        self.assertIn("no newer commit has a push run", warning)

    def test_newer_success_after_an_older_failure_is_green(self):
        runs = [run(CODE3), run(CODE2, "failure"), run(CODE1)]
        self.assertEqual(self.decide(runs)[:2], ("tip", CODE3))

    def test_a_success_and_a_failure_for_one_commit_count_as_passed(self):
        # The tests also run in update.yml's push run; either one passing is
        # enough, so a flaky failure in the other doesn't hold back the code.
        runs = [run(CODE3, "failure"), run(CODE3), run(CODE2)]
        self.assertEqual(self.decide(runs)[:2], ("tip", CODE3))

    def test_reverted_code_counts_as_unchanged(self):
        # The diff, not the commit list, decides whether code changed.
        source, green, warning = self.decide(
            [run(CODE3, "failure"), run(CODE2)], changed=no_code_changed
        )
        self.assertEqual((source, green, warning), ("tip", CODE2, ""))

    def test_no_runs_deploys_the_tip_and_warns(self):
        source, green, warning = self.decide([])
        self.assertEqual((source, green), ("tip", None))
        self.assertIn(f"Deployed the tip {DATA2[:7]}", warning)
        self.assertIn("none of the last 5 commits", warning)

    def test_only_failed_runs_deploys_the_tip_and_warns(self):
        source, green, warning = self.decide([run(CODE3, "failure")])
        self.assertEqual((source, green), ("tip", None))
        self.assertTrue(warning)

    def test_runs_for_commits_off_the_first_parent_history_are_ignored(self):
        # A green commit on a merged branch, or one beyond the fetched history.
        runs = [run(sha(99)), run(CODE3, "failure"), run(CODE2)]
        self.assertEqual(self.decide(runs)[:2], ("green", CODE2))
        self.assertEqual(self.decide([run(sha(99))])[:2], ("tip", None))

    def test_run_order_does_not_matter(self):
        runs = [run(CODE1), run(CODE2), run(CODE3, "failure")]
        self.assertEqual(self.decide(runs)[:2], ("green", CODE2))


class ParseTest(unittest.TestCase):
    def test_parses_gh_output(self):
        text = json.dumps([run(CODE3), run(CODE2, "", "in_progress")])
        self.assertEqual(len(deploy_source.parse_runs(text)), 2)

    def test_empty_run_list_is_valid(self):
        self.assertEqual(deploy_source.parse_runs("[]"), [])

    def test_rejects_malformed_runs(self):
        cases = {
            "": "not JSON",
            "{": "not JSON",
            '{"headSha": "x"}': "expected a JSON list",
            "[1]": "run 0 is not an object",
            json.dumps([{"status": "completed"}]): "no valid headSha",
            json.dumps([run("abc123")]): "no valid headSha",
            json.dumps([{"headSha": CODE1, "conclusion": "success"}]): "no status",
            json.dumps([run(CODE1, 1)]): "invalid conclusion",
        }
        for text, message in cases.items():
            with self.subTest(text=text):
                with self.assertRaisesRegex(deploy_source.InputError, message):
                    deploy_source.parse_runs(text)

    def test_parses_rev_list_output(self):
        text = "".join(f"{c}\n" for c in HISTORY)
        self.assertEqual(deploy_source.parse_commits(text), HISTORY)

    def test_rejects_malformed_commits(self):
        for text, message in {
            "": "empty",
            "\n": "empty",
            "abc123\n": "not a full commit sha",
            f"{CODE1}\nfatal: bad revision\n": "not a full commit sha",
        }.items():
            with self.subTest(text=text):
                with self.assertRaisesRegex(deploy_source.InputError, message):
                    deploy_source.parse_commits(text)


def git(repo, *args):
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
    }
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True, capture_output=True, text=True, env=env,
    ).stdout.strip()


def commit(repo, files, message):
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


class GitTest(unittest.TestCase):
    """code_changed and main() against a real repository."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")
        self.green = commit(
            self.repo,
            {"site/app.js": "v1", "site/data/funds.json": "{}", "README.md": "r"},
            "code",
        )

    def test_data_commit_is_not_a_code_change(self):
        tip = commit(self.repo, {"site/data/funds.json": '{"a": 1}'}, "data")
        self.assertFalse(deploy_source.code_changed(self.green, tip, self.repo))

    def test_site_and_other_files_are_code_changes(self):
        for name in ("site/app.js", "README.md", "scripts/new.py"):
            with self.subTest(name=name):
                tip = commit(self.repo, {name: f"changed {name}"}, name)
                self.assertTrue(deploy_source.code_changed(self.green, tip, self.repo))

    def test_unknown_commit_raises(self):
        with self.assertRaisesRegex(RuntimeError, "git diff .* failed: fatal"):
            deploy_source.code_changed(sha(1), self.green, self.repo)

    def main(self, runs):
        rev_list = git(self.repo, "rev-list", "--first-parent", "HEAD")
        with tempfile.TemporaryDirectory() as tmp:
            runs_path = Path(tmp) / "runs.json"
            runs_path.write_text(json.dumps(runs), encoding="utf-8")
            commits_path = Path(tmp) / "commits.txt"
            commits_path.write_text(rev_list + "\n", encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                deploy_source.main(
                    [str(runs_path), "--commits", str(commits_path), "--repo", str(self.repo)]
                )
        return dict(line.split("=", 1) for line in out.getvalue().splitlines())

    def test_prints_github_output_lines_for_a_data_day(self):
        tip = commit(self.repo, {"site/data/funds.json": '{"a": 1}'}, "data")
        output = self.main([run(self.green)])
        self.assertEqual(
            output, {"source": "tip", "tip": tip, "green": self.green, "warning": ""}
        )

    def test_prints_github_output_lines_for_failed_code(self):
        bad = commit(self.repo, {"site/app.js": "v2"}, "broken code")
        tip = commit(self.repo, {"site/data/funds.json": '{"a": 1}'}, "data")
        output = self.main([run(bad, "failure"), run(self.green)])
        self.assertEqual(output["source"], "green")
        self.assertEqual(output["tip"], tip)
        self.assertEqual(output["green"], self.green)
        self.assertIn(bad[:7], output["warning"])
        self.assertNotIn("\n", output["warning"])

    def test_malformed_input_exits_with_a_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs_path = Path(tmp) / "runs.json"
            runs_path.write_text("not json", encoding="utf-8")
            commits_path = Path(tmp) / "commits.txt"
            commits_path.write_text(self.green + "\n", encoding="utf-8")
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
                deploy_source.main([str(runs_path), "--commits", str(commits_path)])
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("runs.json: not JSON", err.getvalue())


if __name__ == "__main__":
    unittest.main()
