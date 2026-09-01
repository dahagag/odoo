import tempfile
import unittest
from pathlib import Path

from scripts.docs_build.cli import DocsBuildError, build_doc


class BuildDocTests(unittest.TestCase):
    def test_writes_self_contained_html_next_to_the_output_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "sample-doc.md"
            source.write_text("# Sample Doc\n\nBody text.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            self.assertEqual(output_path, output_dir / "sample-doc.html")
            html = output_path.read_text(encoding="utf-8")
            self.assertIn("<title>Sample Doc</title>", html)

    def test_derives_title_from_filename_when_no_heading(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "sales-methodology-vs-odoo-crm.md"
            source.write_text("Body text only.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            self.assertIn("<title>Sales Methodology Vs Odoo Crm</title>", html)

    def test_missing_source_file_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "does-not-exist.md"
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_doc(source, output_dir)

            self.assertIn(str(source), str(ctx.exception))

    def test_malformed_markdown_fails_naming_the_source_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "broken.md"
            source.write_text("```\nunterminated\n", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_doc(source, output_dir)

            self.assertIn(str(source), str(ctx.exception))

    def test_rejects_non_markdown_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "not-markdown.txt"
            source.write_text("Body.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError):
                build_doc(source, output_dir)


if __name__ == "__main__":
    unittest.main()
