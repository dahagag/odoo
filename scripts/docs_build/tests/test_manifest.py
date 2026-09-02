import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.docs_build.cli import build_all
from scripts.docs_build.manifest import load_managed_output_manifest

_BASELINE_COMMIT = "35222a314d3b0e4fd94ae8249c2abd995d796e59"
_APPROVED_OUTPUTS = {
    "custom_addons/crm_methodology/static/docs/0005-methodology-requirements-reference-properties-by-key.html": (
        "docs/adr/0005-methodology-requirements-reference-properties-by-key.md",
        "9a2eceaa5f9541754f7aca2dea1c9d0af2fc46b62ac406599355bd3a13779ec2",
    ),
    "custom_addons/crm_methodology/static/docs/CONTEXT.html": (
        "docs/contexts/crm/CONTEXT.md",
        "93a2ef7131a785e93b741fa0dc18ac270c5cd4bed9dc8739e8543c72909dc5a7",
    ),
    "custom_addons/crm_methodology/static/docs/b2b-sales-methodologies-odoo.html": (
        "docs/research/b2b-sales-methodologies-odoo.md",
        "64abde08dd501c6b180a3ac7cf609f19bf10b1db3aa50cff56a474f55a1dda93",
    ),
    "custom_addons/crm_methodology/static/docs/methodologies.html": (
        "docs/teach/methodologies.md",
        "e1bd206aee844faf3a68a1837e891f841744cda3cf78ed1f41784b961ea21742",
    ),
    "custom_addons/crm_methodology/static/docs/sales-methodology-vs-odoo-crm.html": (
        "docs/teach/sales-methodology-vs-odoo-crm.md",
        "7605911bdb36e238da6e830d93cd048fdb4e194cd0a248da51371b45dabd87db",
    ),
}
_STALE_OUTPUTS = {
    "custom_addons/crm_methodology/static/docs/0007-self-contained-teach-docs-served-from-static.html": "5a4846000c9187c2f317c076044ac4d806abc0d21a5985e69baba410606d1c40",
    "custom_addons/crm_methodology/static/docs/0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.html": "7c79841d1a7d8c6ae321f0adb4d29deccf746a97e9ddbcc41dbdfd77e17588ab",
    "custom_addons/crm_methodology/static/docs/DESIGN-TOKENS.html": "b0f5618901f7ab89a773c2d36956acc47905de806b42cd53f775eaedd0d98b82",
}


class ManagedOutputManifestTests(unittest.TestCase):
    def test_manifest_freezes_the_approved_source_output_contract(self):
        manifest = load_managed_output_manifest()

        self.assertEqual(manifest.baseline_commit, _BASELINE_COMMIT)
        self.assertEqual(
            {
                entry.output.as_posix(): (
                    entry.source.as_posix(),
                    entry.baseline_sha256,
                )
                for entry in manifest.outputs
            },
            _APPROVED_OUTPUTS,
        )

    def test_frozen_hashes_match_the_approved_committed_files(self):
        manifest = load_managed_output_manifest()

        for entry in manifest.outputs:
            with self.subTest(output=entry.output):
                actual_hash = hashlib.sha256(entry.output.read_bytes()).hexdigest()
                self.assertEqual(actual_hash, entry.baseline_sha256)

    def test_manifest_inventories_the_known_stale_baseline_files(self):
        manifest = load_managed_output_manifest()

        self.assertEqual(
            {
                entry.output.as_posix(): entry.baseline_sha256
                for entry in manifest.stale_outputs
            },
            _STALE_OUTPUTS,
        )

    def test_manifest_accounts_for_every_committed_html_file(self):
        manifest = load_managed_output_manifest()
        output_dir = Path("custom_addons/crm_methodology/static/docs")

        committed_names = {path.name for path in output_dir.glob("*.html")}
        managed_names = {entry.output.name for entry in manifest.outputs}
        inventoried_names = managed_names | {
            entry.output.name for entry in manifest.stale_outputs
        }
        self.assertTrue(managed_names.issubset(committed_names))
        self.assertTrue(committed_names.issubset(inventoried_names))

        for entry in manifest.stale_outputs:
            with self.subTest(output=entry.output):
                if not entry.output.exists():
                    continue
                actual_hash = hashlib.sha256(entry.output.read_bytes()).hexdigest()
                self.assertEqual(actual_hash, entry.baseline_sha256)

    def test_every_managed_output_has_an_existing_markdown_source(self):
        manifest = load_managed_output_manifest()

        for entry in manifest.outputs:
            with self.subTest(source=entry.source):
                self.assertEqual(entry.source.suffix, ".md")
                self.assertTrue(entry.source.is_file())

    def test_manifest_exactly_matches_the_declared_teach_document_closure(self):
        manifest = load_managed_output_manifest()

        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            build_all(Path("docs/teach"), output_dir)
            discovered_names = {path.name for path in output_dir.glob("*.html")}

        self.assertEqual(
            discovered_names,
            {entry.output.name for entry in manifest.outputs},
        )

    def test_real_declared_set_converges_from_clean_and_dirty_output_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            build_all(Path("docs/teach"), output_dir)
            first_html = {
                path.name: path.read_bytes() for path in output_dir.glob("*.html")
            }
            sales_html = first_html["sales-methodology-vs-odoo-crm.html"]
            self.assertIn(b'<video src="sales-methodology-vs-odoo-crm.mp4"', sales_html)

            (output_dir / "stale.html").write_text("stale", encoding="utf-8")
            video_path = output_dir / "sales-methodology-vs-odoo-crm.mp4"
            video_path.write_bytes(b"fake-video")
            build_all(Path("docs/teach"), output_dir)

            second_html = {
                path.name: path.read_bytes() for path in output_dir.glob("*.html")
            }
            self.assertEqual(first_html, second_html)
            self.assertFalse((output_dir / "stale.html").exists())
            self.assertEqual(video_path.read_bytes(), b"fake-video")

    def test_generated_html_matches_the_frozen_approved_bytes(self):
        manifest = load_managed_output_manifest()

        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            build_all(Path("docs/teach"), output_dir)

            mismatches = {}
            for entry in manifest.outputs:
                generated_path = output_dir / entry.output.name
                generated_hash = hashlib.sha256(generated_path.read_bytes()).hexdigest()
                if generated_hash != entry.baseline_sha256:
                    mismatches[entry.output.name] = {
                        "expected": entry.baseline_sha256,
                        "actual": generated_hash,
                    }

        self.assertEqual(mismatches, {})

    def test_historical_unreachable_pages_are_not_managed_outputs(self):
        manifest = load_managed_output_manifest()
        managed_names = {entry.output.name for entry in manifest.outputs}

        self.assertTrue(
            {
                "DESIGN-TOKENS.html",
                "0007-self-contained-teach-docs-served-from-static.html",
                "0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.html",
            }.isdisjoint(managed_names),
        )


if __name__ == "__main__":
    unittest.main()
