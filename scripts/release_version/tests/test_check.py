import contextlib
import io
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.release_version.check import (
    ManifestVersionMismatch,
    check_manifest_versions,
    find_owned_manifests,
    main,
    read_manifest_version,
)


def write_manifest(addons_root: Path, module: str, version: str) -> Path:
    module_dir = addons_root / module
    module_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = module_dir / "__manifest__.py"
    manifest_path.write_text(
        textwrap.dedent(
            f"""\
            {{
                'name': "{module}",
                'version': '{version}',
                'depends': ['base'],
            }}
            """,
        ),
        encoding="utf-8",
    )
    return manifest_path


class FindOwnedManifestsTests(unittest.TestCase):
    def test_finds_every_module_manifest_sorted_by_module_name(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            write_manifest(addons_root, "zebra", "19.0.1.0.0")
            write_manifest(addons_root, "alpha", "19.0.1.0.0")

            manifests = find_owned_manifests(addons_root)

            self.assertEqual([m.parent.name for m in manifests], ["alpha", "zebra"])

    def test_ignores_directories_without_a_manifest(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            write_manifest(addons_root, "alpha", "19.0.1.0.0")
            (addons_root / "not_a_module").mkdir()

            manifests = find_owned_manifests(addons_root)

            self.assertEqual([m.parent.name for m in manifests], ["alpha"])


class ReadManifestVersionTests(unittest.TestCase):
    def test_reads_version_from_a_realistic_manifest(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            manifest_path = write_manifest(addons_root, "alpha", "19.0.1.0.0")

            self.assertEqual(read_manifest_version(manifest_path), "19.0.1.0.0")

    def test_reads_version_alongside_nested_fields(self):
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "__manifest__.py"
            manifest_path.write_text(
                textwrap.dedent(
                    """\
                    {
                        'name': "Nested",
                        'version': '19.0.2.0.0',
                        'assets': {
                            'web.assets_backend': [
                                'nested/static/src/js/patch.js',
                            ],
                        },
                    }
                    """,
                ),
                encoding="utf-8",
            )

            self.assertEqual(read_manifest_version(manifest_path), "19.0.2.0.0")


class CheckManifestVersionsTests(unittest.TestCase):
    def test_no_mismatches_when_every_manifest_agrees(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            manifests = [
                write_manifest(addons_root, "alpha", "19.0.1.0.0"),
                write_manifest(addons_root, "beta", "19.0.1.0.0"),
            ]

            mismatches = check_manifest_versions("19.0.1.0.0", manifests)

            self.assertEqual(mismatches, [])

    def test_reports_each_disagreeing_manifest(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            manifests = [
                write_manifest(addons_root, "alpha", "19.0.1.0.0"),
                write_manifest(addons_root, "stale", "19.0.0.9.0"),
                write_manifest(addons_root, "bare", "1.0.0"),
            ]

            mismatches = check_manifest_versions("19.0.1.0.0", manifests)

            self.assertEqual(
                mismatches,
                [
                    ManifestVersionMismatch(
                        module="stale", actual_version="19.0.0.9.0", expected_version="19.0.1.0.0",
                    ),
                    ManifestVersionMismatch(
                        module="bare", actual_version="1.0.0", expected_version="19.0.1.0.0",
                    ),
                ],
            )


class MainTests(unittest.TestCase):
    def test_agreeing_manifests_print_summary_and_exit_zero(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            write_manifest(addons_root, "alpha", "19.0.1.0.0")
            write_manifest(addons_root, "beta", "19.0.1.0.0")

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main(["v1.0.0"], addons_root=addons_root)

            self.assertEqual(exit_code, 0)
            self.assertIn("2 owned addon manifest(s) match", stdout.getvalue())

    def test_disagreeing_manifest_prints_details_and_exits_one(self):
        with TemporaryDirectory() as tmp:
            addons_root = Path(tmp)
            write_manifest(addons_root, "alpha", "19.0.1.0.0")
            write_manifest(addons_root, "stale", "19.0.0.9.0")

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                exit_code = main(["v1.0.0"], addons_root=addons_root)

            self.assertEqual(exit_code, 1)
            self.assertIn("stale", stderr.getvalue())
            self.assertIn("19.0.0.9.0", stderr.getvalue())
            self.assertIn("19.0.1.0.0", stderr.getvalue())

    def test_malformed_tag_prints_to_stderr_and_exits_one(self):
        with TemporaryDirectory() as tmp:
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                exit_code = main(["not-a-tag"], addons_root=Path(tmp))

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
