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


class BuildDocLinkClosureTests(unittest.TestCase):
    def test_link_between_two_teach_docs_resolves_to_generated_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [the other doc](other.md).", encoding="utf-8",
            )
            (teach_dir / "other.md").write_text("# Other\n\nBody.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(teach_dir / "main.md", output_dir)

            main_html = output_path.read_text(encoding="utf-8")
            self.assertIn('<a href="other.html"', main_html)
            self.assertTrue((output_dir / "other.html").is_file())

    def test_link_to_adr_causes_it_to_be_rendered_with_the_same_template(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            adr_dir = root / "docs" / "adr"
            teach_dir.mkdir(parents=True)
            adr_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [ADR 5](../adr/0005-thing.md).", encoding="utf-8",
            )
            (adr_dir / "0005-thing.md").write_text("# ADR 5\n\nDecision text.", encoding="utf-8")
            output_dir = root / "out"

            output_path = build_doc(teach_dir / "main.md", output_dir)

            main_html = output_path.read_text(encoding="utf-8")
            self.assertIn('<a href="0005-thing.html"', main_html)
            adr_html = (output_dir / "0005-thing.html").read_text(encoding="utf-8")
            self.assertIn("<h1>ADR 5</h1>", adr_html)
            # Same shared template as the entry doc.
            self.assertIn("prefers-color-scheme: dark", adr_html)

    def test_document_not_linked_from_any_teach_doc_is_never_rendered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            adr_dir = root / "docs" / "adr"
            teach_dir.mkdir(parents=True)
            adr_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text("# Main\n\nNo links here.", encoding="utf-8")
            (adr_dir / "0005-unlinked.md").write_text("# Unlinked ADR\n\nBody.", encoding="utf-8")
            output_dir = root / "out"

            build_doc(teach_dir / "main.md", output_dir)

            self.assertFalse((output_dir / "0005-unlinked.html").exists())

    def test_external_url_passes_through_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [Odoo](https://www.odoo.com).", encoding="utf-8",
            )
            output_dir = Path(tmp) / "out"

            output_path = build_doc(teach_dir / "main.md", output_dir)

            html = output_path.read_text(encoding="utf-8")
            self.assertIn('<a href="https://www.odoo.com"', html)

    def test_unresolvable_internal_link_fails_naming_source_and_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            source = teach_dir / "main.md"
            source.write_text("# Main\n\nSee [missing](missing.md).", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_doc(source, output_dir)

            self.assertIn(str(source), str(ctx.exception))
            self.assertIn("missing.md", str(ctx.exception))

    def test_two_docs_with_the_same_stem_fail_instead_of_overwriting(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            context_a = root / "docs" / "contexts" / "crm"
            context_b = root / "docs" / "contexts" / "other"
            teach_dir.mkdir(parents=True)
            context_a.mkdir(parents=True)
            context_b.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [crm](../contexts/crm/CONTEXT.md) "
                "and [other](../contexts/other/CONTEXT.md).",
                encoding="utf-8",
            )
            (context_a / "CONTEXT.md").write_text("# CRM Context\n\nBody.", encoding="utf-8")
            (context_b / "CONTEXT.md").write_text("# Other Context\n\nBody.", encoding="utf-8")
            output_dir = root / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_doc(teach_dir / "main.md", output_dir)

            self.assertIn("CONTEXT.html", str(ctx.exception))

    def test_transitive_link_is_also_rendered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            contexts_dir = root / "docs" / "contexts" / "crm"
            teach_dir.mkdir(parents=True)
            contexts_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [context](../contexts/crm/CONTEXT.md).", encoding="utf-8",
            )
            (contexts_dir / "CONTEXT.md").write_text(
                "# Context\n\nSee [research](../../research/thing.md).", encoding="utf-8",
            )
            (root / "docs" / "research").mkdir(parents=True)
            (root / "docs" / "research" / "thing.md").write_text(
                "# Research\n\nBody.", encoding="utf-8",
            )
            output_dir = root / "out"

            build_doc(teach_dir / "main.md", output_dir)

            self.assertTrue((output_dir / "CONTEXT.html").is_file())
            self.assertTrue((output_dir / "thing.html").is_file())
            context_html = (output_dir / "CONTEXT.html").read_text(encoding="utf-8")
            self.assertIn('<a href="thing.html"', context_html)


if __name__ == "__main__":
    unittest.main()
