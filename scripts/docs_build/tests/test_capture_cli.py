import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.docs_build.capture_cli import DocsBuildError, run_capture


def _fake_runner(returncode=0, stdout="Wrote images\n", stderr=""):
    def runner(command, cwd):
        return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr=stderr)

    return runner


class RunCaptureTests(unittest.TestCase):
    def test_missing_node_modules_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture_dir = Path(tmp) / "capture"
            capture_dir.mkdir()

            with self.assertRaises(DocsBuildError) as ctx:
                run_capture(capture_dir=capture_dir, runner=_fake_runner())

            self.assertIn("npm install", str(ctx.exception))

    def test_missing_node_on_path_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture_dir = Path(tmp) / "capture"
            (capture_dir / "node_modules").mkdir(parents=True)

            with mock.patch("shutil.which", return_value=None):
                with self.assertRaises(DocsBuildError) as ctx:
                    run_capture(capture_dir=capture_dir, runner=_fake_runner())

            self.assertIn("node", str(ctx.exception))

    def test_runs_capture_script_when_prerequisites_are_met(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture_dir = Path(tmp) / "capture"
            (capture_dir / "node_modules").mkdir(parents=True)
            captured = []

            def runner(command, cwd):
                captured.append((command, cwd))
                return _fake_runner()(command, cwd)

            run_capture(capture_dir=capture_dir, runner=runner)

            [(command, cwd)] = captured
            self.assertIn("capture.mjs", command)
            self.assertEqual(cwd, capture_dir)

    def test_nonzero_exit_fails_with_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture_dir = Path(tmp) / "capture"
            (capture_dir / "node_modules").mkdir(parents=True)

            with self.assertRaises(DocsBuildError) as ctx:
                run_capture(
                    capture_dir=capture_dir,
                    runner=_fake_runner(returncode=1, stderr="login failed"),
                )

            self.assertIn("login failed", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
