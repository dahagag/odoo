import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts.docs_build.cli import build_all
from scripts.docs_build.parity_cli import main


class ParityCommandTests(unittest.TestCase):
    def _make_repo_fixture(
        self,
        root: Path,
        *,
        include_missing_output: bool = False,
    ) -> tuple[Path, Path, Path]:
        teach_dir = root / "docs" / "teach"
        teach_dir.mkdir(parents=True)
        source = teach_dir / "guide.md"
        source.write_text("# Guide\n\nApproved content.\n", encoding="utf-8", newline="\n")

        output_dir = root / "custom_addons" / "crm_methodology" / "static" / "docs"
        build_all(teach_dir, output_dir)
        approved = (output_dir / "guide.html").read_bytes()

        manifest_path = root / "scripts" / "docs_build" / "managed_outputs.json"
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_text(
            json.dumps(
                {
                    "baseline_commit": "test-baseline",
                    "outputs": [
                        {
                            "source": "docs/teach/guide.md",
                            "output": "custom_addons/crm_methodology/static/docs/guide.html",
                            "baseline_sha256": hashlib.sha256(approved).hexdigest(),
                        },
                    ]
                    + (
                        [
                            {
                                "source": "docs/teach/missing.md",
                                "output": "custom_addons/crm_methodology/static/docs/missing.html",
                                "baseline_sha256": "0" * 64,
                            },
                        ]
                        if include_missing_output
                        else []
                    ),
                    "stale_outputs": [],
                },
                indent=2,
            ) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return source, output_dir, manifest_path

    def test_passes_when_production_build_matches_committed_managed_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _source, _output_dir, manifest_path = self._make_repo_fixture(root)

            result = main([], repo_root=root, manifest_path=manifest_path)

        self.assertEqual(result, 0)

    def test_reports_missing_extra_and_changed_outputs_in_one_run(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, output_dir, manifest_path = self._make_repo_fixture(
                root,
                include_missing_output=True,
            )
            source.write_text("# Guide\n\nChanged content.\n", encoding="utf-8", newline="\n")
            (output_dir / "stale.html").write_text("stale", encoding="utf-8", newline="\n")
            stderr = io.StringIO()

            with contextlib.redirect_stderr(stderr):
                result = main([], repo_root=root, manifest_path=manifest_path)

        self.assertEqual(result, 1)
        report = stderr.getvalue()
        self.assertIn("Missing managed HTML outputs:", report)
        self.assertIn("missing.html", report)
        self.assertIn("Unexpected committed HTML outputs:", report)
        self.assertIn("stale.html", report)
        self.assertIn("Changed HTML outputs:", report)
        self.assertIn("guide.html", report)


if __name__ == "__main__":
    unittest.main()
