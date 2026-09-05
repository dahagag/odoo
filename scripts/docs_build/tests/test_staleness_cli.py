import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.docs_build.staleness_cli import DocsBuildError, check_staleness


def _fake_runner(sha="abc123"):
    def runner(command):
        return subprocess.CompletedProcess(command, 0, stdout=f"{sha}\n", stderr="")

    return runner


class CheckStalenessTests(unittest.TestCase):
    def _write_manifest(self, tmp: str, sha: str) -> Path:
        manifest_path = Path(tmp) / "capture-manifest.json"
        manifest_path.write_text(
            json.dumps({"capturedAt": "2026-01-01T00:00:00Z", "addonsGitSha": sha}),
            encoding="utf-8",
        )
        return manifest_path

    def test_missing_manifest_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "capture-manifest.json"

            with self.assertRaises(DocsBuildError) as ctx:
                check_staleness(manifest_path, runner=_fake_runner())

            self.assertIn("docs-build:capture", str(ctx.exception))

    def test_matching_sha_is_not_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = self._write_manifest(tmp, "abc123")

            is_stale = check_staleness(manifest_path, runner=_fake_runner(sha="abc123"))

            self.assertFalse(is_stale)

    def test_mismatched_sha_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = self._write_manifest(tmp, "abc123")

            is_stale = check_staleness(manifest_path, runner=_fake_runner(sha="def456"))

            self.assertTrue(is_stale)

    def test_manifest_missing_sha_field_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "capture-manifest.json"
            manifest_path.write_text(json.dumps({"capturedAt": "2026-01-01T00:00:00Z"}), encoding="utf-8")

            with self.assertRaises(DocsBuildError) as ctx:
                check_staleness(manifest_path, runner=_fake_runner())

            self.assertIn("addonsGitSha", str(ctx.exception))

    def test_git_failure_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = self._write_manifest(tmp, "abc123")

            def failing_runner(command):
                return subprocess.CompletedProcess(command, 1, stdout="", stderr="not a git repo")

            with self.assertRaises(DocsBuildError) as ctx:
                check_staleness(manifest_path, runner=failing_runner)

            self.assertIn("not a git repo", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
