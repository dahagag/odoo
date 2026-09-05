import base64
import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path

from scripts.docs_build.cli import DocsBuildError, build_all, build_doc, main

_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII=",
)


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


class BuildDocImageEmbeddingTests(unittest.TestCase):
    def test_local_image_is_embedded_as_data_uri_with_no_separate_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text("# Doc\n\n![alt text](picture.png)", encoding="utf-8")
            (Path(tmp) / "picture.png").write_bytes(_ONE_PIXEL_PNG)
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            expected_src = f"data:image/png;base64,{base64.b64encode(_ONE_PIXEL_PNG).decode('ascii')}"
            self.assertIn(f'<img src="{expected_src}"', html)
            self.assertEqual(list(output_dir.iterdir()), [output_path])

    def test_missing_image_fails_naming_source_and_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text("# Doc\n\n![alt text](missing.png)", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_doc(source, output_dir)

            self.assertIn(str(source), str(ctx.exception))
            self.assertIn("missing.png", str(ctx.exception))

    def test_large_image_still_embeds_but_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text("# Doc\n\n![alt text](big.png)", encoding="utf-8")
            (Path(tmp) / "big.png").write_bytes(_ONE_PIXEL_PNG + b"\x00" * (400 * 1024))
            output_dir = Path(tmp) / "out"

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                output_path = build_doc(source, output_dir)

            self.assertTrue(output_path.is_file())
            self.assertIn("big.png", stderr.getvalue())
            self.assertIn("warning", stderr.getvalue().lower())

    def test_image_with_unrecognized_extension_still_embeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            # .xyz is a real, long-standing entry in Python's stdlib mimetypes
            # table (chemical/x-xyz), so it doesn't exercise the "unrecognized"
            # fallback this test is meant to cover - use an extension no MIME
            # database registers.
            source.write_text("# Doc\n\n![alt text](data.notarealext)", encoding="utf-8")
            (Path(tmp) / "data.notarealext").write_bytes(b"some-bytes")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            expected_src = f"data:application/octet-stream;base64,{base64.b64encode(b'some-bytes').decode('ascii')}"
            self.assertIn(f'<img src="{expected_src}"', html)

    def test_external_image_url_is_left_unembedded(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text(
                "# Doc\n\n![alt text](https://example.com/picture.png)", encoding="utf-8",
            )
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            self.assertIn('<img src="https://example.com/picture.png"', html)


class BuildDocVideoEmbedTests(unittest.TestCase):
    def test_authored_video_project_is_explicit_and_independent_of_output_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            source = teach_dir / "doc.md"
            source.write_text("# Doc\n\nBody.", encoding="utf-8")
            project_dir = teach_dir / "videos" / "doc"
            project_dir.mkdir(parents=True)
            (project_dir / "hyperframes.json").write_text("{}", encoding="utf-8")
            clean_output = Path(tmp) / "clean"
            populated_output = Path(tmp) / "populated"
            populated_output.mkdir()
            (populated_output / "doc.mp4").write_bytes(b"fake-mp4-bytes")

            clean_html = build_doc(source, clean_output).read_bytes()
            populated_html = build_doc(source, populated_output).read_bytes()

            self.assertEqual(clean_html, populated_html)
            self.assertIn(b'<video src="doc.mp4" controls', clean_html)

    def test_ignores_undeclared_video_left_in_the_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text("# Doc\n\nBody.", encoding="utf-8")
            output_dir = Path(tmp) / "out"
            output_dir.mkdir()
            (output_dir / "doc.mp4").write_bytes(b"fake-mp4-bytes")

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            self.assertNotIn("<video", html)

    def test_omits_video_tag_when_no_sibling_video_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "doc.md"
            source.write_text("# Doc\n\nBody.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(source, output_dir)

            html = output_path.read_text(encoding="utf-8")
            self.assertNotIn("<video", html)

    def test_each_closure_member_gets_its_own_authored_video_declaration(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "main.md").write_text(
                "# Main\n\nSee [the other doc](other.md).", encoding="utf-8",
            )
            (teach_dir / "other.md").write_text("# Other\n\nBody.", encoding="utf-8")
            other_project = teach_dir / "videos" / "other"
            other_project.mkdir(parents=True)
            (other_project / "hyperframes.json").write_text("{}", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_path = build_doc(teach_dir / "main.md", output_dir)

            main_html = output_path.read_text(encoding="utf-8")
            other_html = (output_dir / "other.html").read_text(encoding="utf-8")
            self.assertNotIn("<video", main_html)
            self.assertIn('<video src="other.mp4" controls', other_html)


class BuildAllTests(unittest.TestCase):
    def test_renders_every_teach_doc(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "alpha.md").write_text("# Alpha\n\nBody.", encoding="utf-8")
            (teach_dir / "beta.md").write_text("# Beta\n\nBody.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            output_paths = build_all(teach_dir, output_dir)

            self.assertEqual(
                output_paths,
                [output_dir / "alpha.html", output_dir / "beta.html"],
            )
            self.assertTrue((output_dir / "alpha.html").is_file())
            self.assertTrue((output_dir / "beta.html").is_file())

    def test_excludes_reference_only_design_tokens_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "alpha.md").write_text("# Alpha\n\nBody.", encoding="utf-8")
            (teach_dir / "DESIGN-TOKENS.md").write_text(
                "# Not a teach doc\n\nReference only.", encoding="utf-8",
            )
            output_dir = Path(tmp) / "out"

            output_paths = build_all(teach_dir, output_dir)

            self.assertEqual(output_paths, [output_dir / "alpha.html"])
            self.assertFalse((output_dir / "DESIGN-TOKENS.html").exists())

    def test_shared_link_target_is_rendered_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            adr_dir = root / "docs" / "adr"
            teach_dir.mkdir(parents=True)
            adr_dir.mkdir(parents=True)
            (teach_dir / "alpha.md").write_text(
                "# Alpha\n\nSee [ADR 5](../adr/0005-thing.md).", encoding="utf-8",
            )
            (teach_dir / "beta.md").write_text(
                "# Beta\n\nAlso see [ADR 5](../adr/0005-thing.md).", encoding="utf-8",
            )
            (adr_dir / "0005-thing.md").write_text("# ADR 5\n\nDecision text.", encoding="utf-8")
            output_dir = root / "out"

            build_all(teach_dir, output_dir)

            self.assertEqual(
                sorted(p.name for p in output_dir.iterdir()),
                ["0005-thing.html", "alpha.html", "beta.html"],
            )

    def test_removes_stale_html_and_preserves_sibling_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "alpha.md").write_text("# Alpha\n\nBody.", encoding="utf-8")
            output_dir = root / "out"
            output_dir.mkdir()
            (output_dir / "stale.html").write_text("stale", encoding="utf-8")
            (output_dir / "alpha.mp4").write_bytes(b"fake-video")
            project_dir = teach_dir / "videos" / "alpha"
            project_dir.mkdir(parents=True)
            (project_dir / "hyperframes.json").write_text("{}", encoding="utf-8")

            build_all(teach_dir, output_dir)

            self.assertFalse((output_dir / "stale.html").exists())
            self.assertEqual((output_dir / "alpha.mp4").read_bytes(), b"fake-video")
            self.assertIn(
                '<video src="alpha.mp4" controls',
                (output_dir / "alpha.html").read_text(encoding="utf-8"),
            )

    def test_failure_in_one_entry_names_the_offending_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "good.md").write_text("# Good\n\nBody.", encoding="utf-8")
            bad = teach_dir / "bad.md"
            bad.write_text("```\nunterminated\n", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_all(teach_dir, output_dir)

            self.assertIn(str(bad), str(ctx.exception))

    def test_no_renderable_files_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            teach_dir = Path(tmp) / "docs" / "teach"
            teach_dir.mkdir(parents=True)
            (teach_dir / "DESIGN-TOKENS.md").write_text("Reference only.", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                build_all(teach_dir, output_dir)

            self.assertIn(str(teach_dir), str(ctx.exception))

    def test_two_runs_against_unchanged_input_produce_byte_identical_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teach_dir = root / "docs" / "teach"
            adr_dir = root / "docs" / "adr"
            teach_dir.mkdir(parents=True)
            adr_dir.mkdir(parents=True)
            (teach_dir / "alpha.md").write_text(
                "# Alpha\n\nSee [beta](beta.md) and [ADR 5](../adr/0005-thing.md).",
                encoding="utf-8",
            )
            (teach_dir / "beta.md").write_text(
                "# Beta\n\nSee [ADR 5](../adr/0005-thing.md).", encoding="utf-8",
            )
            (adr_dir / "0005-thing.md").write_text("# ADR 5\n\nDecision text.", encoding="utf-8")

            first_dir = root / "out1"
            second_dir = root / "out2"
            build_all(teach_dir, first_dir)
            build_all(teach_dir, second_dir)

            first_files = sorted(first_dir.iterdir())
            second_files = sorted(second_dir.iterdir())
            self.assertEqual([p.name for p in first_files], [p.name for p in second_files])
            for first_file, second_file in zip(first_files, second_files):
                self.assertEqual(first_file.read_bytes(), second_file.read_bytes())


class MainWholeDirectoryTests(unittest.TestCase):
    def test_main_with_no_args_builds_whole_teach_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "teach").mkdir(parents=True)
            (root / "docs" / "teach" / "alpha.md").write_text("# Alpha\n\nBody.", encoding="utf-8")
            (root / "custom_addons" / "crm_methodology" / "static" / "docs").mkdir(parents=True)

            cwd = os.getcwd()
            os.chdir(root)
            try:
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    exit_code = main([])
            finally:
                os.chdir(cwd)

            self.assertEqual(exit_code, 0)
            output_html = root / "custom_addons" / "crm_methodology" / "static" / "docs" / "alpha.html"
            self.assertTrue(output_html.is_file())
            self.assertIn("alpha.html", stdout.getvalue())

    def test_main_rejects_more_than_one_argument(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main(["a.md", "b.md"])

        self.assertEqual(exit_code, 2)
        self.assertIn("Usage", stderr.getvalue())


class MainAddonInferenceTests(unittest.TestCase):
    def test_bare_addon_name_builds_that_addons_whole_teach_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "teach-hosting").mkdir(parents=True)
            (root / "docs" / "teach-hosting" / "index.md").write_text(
                "# Trial Onboarding Guide\n\nBody.", encoding="utf-8",
            )
            (root / "custom_addons" / "hosting" / "static" / "docs").mkdir(parents=True)

            cwd = os.getcwd()
            os.chdir(root)
            try:
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    exit_code = main(["hosting"])
            finally:
                os.chdir(cwd)

            self.assertEqual(exit_code, 0)
            output_html = root / "custom_addons" / "hosting" / "static" / "docs" / "index.html"
            self.assertTrue(output_html.is_file())

    def test_a_single_file_argument_infers_its_addon_from_its_teach_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "teach-hosting").mkdir(parents=True)
            source = root / "docs" / "teach-hosting" / "index.md"
            source.write_text("# Trial Onboarding Guide\n\nBody.", encoding="utf-8")
            (root / "custom_addons" / "hosting" / "static" / "docs").mkdir(parents=True)

            cwd = os.getcwd()
            os.chdir(root)
            try:
                exit_code = main([str(Path("docs") / "teach-hosting" / "index.md")])
            finally:
                os.chdir(cwd)

            self.assertEqual(exit_code, 0)
            output_html = root / "custom_addons" / "hosting" / "static" / "docs" / "index.html"
            self.assertTrue(output_html.is_file())

    def test_crm_methodology_source_files_still_build_to_the_original_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "teach").mkdir(parents=True)
            source = root / "docs" / "teach" / "alpha.md"
            source.write_text("# Alpha\n\nBody.", encoding="utf-8")
            (root / "custom_addons" / "crm_methodology" / "static" / "docs").mkdir(parents=True)

            cwd = os.getcwd()
            os.chdir(root)
            try:
                exit_code = main([str(Path("docs") / "teach" / "alpha.md")])
            finally:
                os.chdir(cwd)

            self.assertEqual(exit_code, 0)
            output_html = root / "custom_addons" / "crm_methodology" / "static" / "docs" / "alpha.html"
            self.assertTrue(output_html.is_file())

    def test_a_path_outside_any_teach_dir_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "adr").mkdir(parents=True)
            source = root / "docs" / "adr" / "0001-thing.md"
            source.write_text("# ADR\n\nBody.", encoding="utf-8")

            cwd = os.getcwd()
            os.chdir(root)
            try:
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr):
                    exit_code = main([str(Path("docs") / "adr" / "0001-thing.md")])
            finally:
                os.chdir(cwd)

            self.assertEqual(exit_code, 1)
            self.assertIn(str(Path("docs") / "adr" / "0001-thing.md"), stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
