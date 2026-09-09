import contextlib
import io
import unittest

from scripts.release_version.cli import main


class MainTests(unittest.TestCase):
    def test_well_formed_tag_prints_derived_version_and_exits_zero(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            exit_code = main(["v1.2.3"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(stdout.getvalue(), "19.0.1.2.3\n")

    def test_malformed_tag_prints_to_stderr_and_exits_one(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main(["not-a-tag"])

        self.assertEqual(exit_code, 1)
        self.assertIn("release-version failed", stderr.getvalue())

    def test_prerelease_tag_prints_to_stderr_and_exits_one(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main(["v1.2.3-rc.1"])

        self.assertEqual(exit_code, 1)
        self.assertIn("release-version failed", stderr.getvalue())

    def test_wrong_argument_count_exits_two(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main([])

        self.assertEqual(exit_code, 2)
        self.assertIn("Usage", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
