import unittest

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
    extract_local_image_refs,
    extract_local_links,
    is_local_markdown_link,
    render_markdown_document,
)


class RenderMarkdownDocumentTests(unittest.TestCase):
    def test_loads_the_approved_google_fonts_stylesheet(self):
        # Per ADR 0009, "self-contained" means no unresolved local images/links,
        # not zero network requests: the shared template loads the same Google
        # Fonts the hand-authored source Artifacts use.
        html = render_markdown_document("Body text.", fallback_title="Doc")

        self.assertIn('href="https://fonts.googleapis.com/', html)
        self.assertNotIn("<script", html)

    def test_uses_fallback_title_when_no_heading_present(self):
        html = render_markdown_document("Just a paragraph.", fallback_title="My Doc")

        self.assertIn("<title>My Doc</title>", html)

    def test_first_heading_becomes_page_title(self):
        html = render_markdown_document("# Real Title\n\nBody.", fallback_title="Fallback")

        self.assertIn("<title>Real Title</title>", html)
        self.assertIn("<h1>Real Title</h1>", html)

    def test_supports_light_and_dark_theme_tokens(self):
        html = render_markdown_document("Body.", fallback_title="Doc")

        self.assertIn("prefers-color-scheme: dark", html)
        self.assertIn("color-scheme: light", html)

    def test_renders_headings(self):
        html = render_markdown_document("## Section Two", fallback_title="Doc")

        self.assertIn("<h2>Section Two</h2>", html)

    def test_renders_paragraphs(self):
        html = render_markdown_document("First paragraph.\n\nSecond paragraph.", fallback_title="Doc")

        self.assertIn("<p>First paragraph.</p>", html)
        self.assertIn("<p>Second paragraph.</p>", html)

    def test_renders_bold_and_italic_and_inline_code(self):
        html = render_markdown_document("A **bold** and *italic* and `code` word.", fallback_title="Doc")

        self.assertIn("<strong>bold</strong>", html)
        self.assertIn("<em>italic</em>", html)
        self.assertIn("<code>code</code>", html)

    def test_renders_unordered_list(self):
        html = render_markdown_document("- one\n- two", fallback_title="Doc")

        self.assertIn("<ul>", html)
        self.assertIn("<li>one</li>", html)
        self.assertIn("<li>two</li>", html)

    def test_renders_ordered_list(self):
        html = render_markdown_document("1. one\n2. two", fallback_title="Doc")

        self.assertIn("<ol>", html)
        self.assertIn("<li>one</li>", html)

    def test_renders_blockquote_as_callout(self):
        html = render_markdown_document("> A note.", fallback_title="Doc")

        self.assertIn('<blockquote class="callout">', html)
        self.assertIn("A note.", html)

    def test_renders_fenced_code_block_without_processing_inline_markup(self):
        markdown_text = "```\nvalue = **not bold**\n```"

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<pre><code>value = **not bold**</code></pre>", html)

    def test_renders_allowlisted_status_pill_unescaped_in_prose(self):
        markdown_text = 'A <span class="pill new">New</span> feature.'

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<span class="pill new">New</span>', html)
        self.assertNotIn("&lt;span", html)

    def test_renders_allowlisted_status_pills_in_table_cell(self):
        markdown_text = (
            "| Model | Status |\n"
            "| --- | --- |\n"
            '| crm.methodology | <span class="pill ext">Extended</span> |'
        )

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<span class="pill ext">Extended</span>', html)

    def test_renders_demo_badge_unescaped(self):
        markdown_text = '<span class="demo-badge">Used in our demo</span>'

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<span class="demo-badge">Used in our demo</span>', html)

    def test_renders_other_allowlisted_tags_unescaped(self):
        markdown_text = "H<sub>2</sub>O and E=mc<sup>2</sup>, a <mark>highlight</mark>, a <kbd>Ctrl</kbd> key, line one<br>line two."

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("H<sub>2</sub>O", html)
        self.assertIn("mc<sup>2</sup>", html)
        self.assertIn("<mark>highlight</mark>", html)
        self.assertIn("<kbd>Ctrl</kbd>", html)
        self.assertIn("line one<br>line two", html)

    def test_escapes_non_allowlisted_inline_html(self):
        markdown_text = 'Inline <script>alert(1)</script> and <iframe src="x"></iframe> text.'

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertNotIn("<script>", html)
        self.assertNotIn("<iframe", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;iframe", html)

    def test_escapes_disallowed_tag_even_when_mixed_with_allowlisted_tags(self):
        markdown_text = '<span class="pill new">New</span> then <div>block</div> text.'

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<span class="pill new">New</span>', html)
        self.assertIn("&lt;div&gt;", html)
        self.assertNotIn("<div>", html)

    def test_allowlisted_tag_written_literally_inside_inline_code_stays_escaped(self):
        markdown_text = 'Write `<span class="pill new">New</span>` literally.'

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<code>&lt;span class=&quot;pill new&quot;&gt;New&lt;/span&gt;</code>", html)
        self.assertNotIn('<span class="pill new">', html)

    def test_renders_horizontal_rule(self):
        html = render_markdown_document("Above.\n\n---\n\nBelow.", fallback_title="Doc")

        self.assertIn("<hr>", html)

    def test_renders_gfm_table(self):
        markdown_text = "| A | B |\n| --- | --- |\n| 1 | 2 |"

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<table>", html)
        self.assertIn("<th>A</th>", html)
        self.assertIn("<td>1</td>", html)

    def test_renders_link(self):
        html = render_markdown_document("See [Odoo](https://www.odoo.com).", fallback_title="Doc")

        self.assertIn('<a href="https://www.odoo.com"', html)
        self.assertIn(">Odoo</a>", html)

    def test_escapes_html_special_characters(self):
        html = render_markdown_document("A <script>alert(1)</script> & more.", fallback_title="Doc")

        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_unclosed_fenced_code_block_is_malformed(self):
        markdown_text = "```\nvalue = 1\n"

        with self.assertRaises(MarkdownSyntaxError):
            render_markdown_document(markdown_text, fallback_title="Doc")

    def test_local_image_without_resolver_is_malformed(self):
        markdown_text = "See this: ![alt text](picture.png)"

        with self.assertRaises(MarkdownSyntaxError):
            render_markdown_document(markdown_text, fallback_title="Doc")

    def test_local_image_is_embedded_via_image_resolver(self):
        markdown_text = "![alt text](picture.png)"

        html = render_markdown_document(
            markdown_text,
            fallback_title="Doc",
            image_resolver=lambda href: f"data:image/png;base64,FAKE-{href}",
        )

        self.assertIn(
            '<img src="data:image/png;base64,FAKE-picture.png" alt="alt text">',
            html,
        )

    def test_local_image_with_ampersand_in_filename_is_resolved_with_the_raw_href(self):
        markdown_text = "![alt text](diagram&v2.png)"

        html = render_markdown_document(
            markdown_text,
            fallback_title="Doc",
            image_resolver=lambda href: f"data:image/png;base64,FAKE-{href}",
        )

        self.assertIn(
            '<img src="data:image/png;base64,FAKE-diagram&amp;v2.png" alt="alt text">',
            html,
        )

    def test_external_image_passes_through_without_calling_resolver(self):
        markdown_text = "![alt text](https://example.com/picture.png)"

        def resolver(href):
            raise AssertionError(f"resolver should not be called for external href {href!r}")

        html = render_markdown_document(markdown_text, fallback_title="Doc", image_resolver=resolver)

        self.assertIn(
            '<img src="https://example.com/picture.png" alt="alt text">',
            html,
        )

    def test_image_inside_fenced_code_block_is_not_rejected(self):
        markdown_text = "```\n![alt text](picture.png)\n```"

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("![alt text](picture.png)", html)

    def test_image_syntax_inside_inline_code_span_is_not_rejected(self):
        markdown_text = "Use `![alt](img.png)` syntax."

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<code>![alt](img.png)</code>", html)

    def test_image_with_bracket_in_alt_text_is_still_detected(self):
        markdown_text = "See ![a [b] c](picture.png) here."

        with self.assertRaises(MarkdownSyntaxError):
            render_markdown_document(markdown_text, fallback_title="Doc")

    def test_renders_table_immediately_following_a_paragraph(self):
        markdown_text = "Some intro text.\n| A | B |\n| --- | --- |\n| 1 | 2 |"

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<p>Some intro text.</p>", html)
        self.assertIn("<table>", html)
        self.assertIn("<th>A</th>", html)
        self.assertIn("<td>1</td>", html)

    def test_does_not_apply_emphasis_to_intraword_underscores(self):
        html = render_markdown_document("the snake_case_name here", fallback_title="Doc")

        self.assertNotIn("<em>", html)
        self.assertIn("snake_case_name", html)

    def test_renders_underscore_emphasis_with_word_boundaries(self):
        html = render_markdown_document("an _italic_ word", fallback_title="Doc")

        self.assertIn("<em>italic</em>", html)

    def test_is_deterministic_pure_function(self):
        markdown_text = "# Title\n\nSome **body** text with a [link](https://example.com)."

        first = render_markdown_document(markdown_text, fallback_title="Doc")
        second = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertEqual(first, second)

    def test_local_md_link_is_rewritten_via_resolver(self):
        markdown_text = "See [ADR 5](../adr/0005-thing.md) for details."

        html = render_markdown_document(
            markdown_text,
            fallback_title="Doc",
            link_resolver=lambda href: "0005-thing.html",
        )

        self.assertIn('<a href="0005-thing.html"', html)
        self.assertNotIn("../adr/0005-thing.md", html)

    def test_external_link_is_never_passed_to_resolver(self):
        markdown_text = "See [Odoo](https://www.odoo.com)."

        def resolver(href):
            raise AssertionError(f"resolver should not be called for external href {href!r}")

        html = render_markdown_document(markdown_text, fallback_title="Doc", link_resolver=resolver)

        self.assertIn('<a href="https://www.odoo.com"', html)

    def test_local_md_link_without_resolver_is_left_unchanged(self):
        markdown_text = "See [Sibling](sibling.md)."

        html = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<a href="sibling.md"', html)

    def test_local_md_link_fragment_is_preserved_by_the_caller(self):
        # The resolver receives the raw href (fragment included) and decides how to
        # rewrite it; markdown_transform itself does not special-case fragments.
        markdown_text = "See [Section](sibling.md#section)."

        captured = []

        def resolver(href):
            captured.append(href)
            return "sibling.html#section"

        html = render_markdown_document(markdown_text, fallback_title="Doc", link_resolver=resolver)

        self.assertEqual(captured, ["sibling.md#section"])
        self.assertIn('<a href="sibling.html#section"', html)


class RenderMarkdownDocumentMainLayoutTests(unittest.TestCase):
    def test_document_without_directive_renders_deep_dive_layout_unchanged(self):
        markdown_text = "# Title\n\n## Section One\n\nBody one.\n\n## Section Two\n\nBody two."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('max-width: 840px', html_out)
        self.assertNotIn('class="toc"', html_out)
        self.assertNotIn("<section", html_out)

    def test_layout_main_directive_selects_multi_section_layout(self):
        markdown_text = (
            "<!-- layout: main -->\n"
            "# Title\n\n"
            "## Section One\n\nBody one.\n\n"
            "## Section Two\n\nBody two."
        )

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("max-width: 1180px", html_out)
        self.assertIn('grid-template-columns: 230px minmax(0, 1fr)', html_out)
        self.assertIn("max-width: 860px", html_out)
        self.assertIn('position: sticky', html_out)

    def test_layout_main_toc_lists_every_section_with_working_anchors(self):
        markdown_text = (
            "<!-- layout: main -->\n"
            "# Title\n\n"
            "## First Section\n\nBody one.\n\n"
            "## Second Section\n\nBody two."
        )

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<li><a href="#first-section">First Section</a></li>', html_out)
        self.assertIn('<li><a href="#second-section">Second Section</a></li>', html_out)
        self.assertIn('<section id="first-section">', html_out)
        self.assertIn('<section id="second-section">', html_out)
        self.assertIn("<h1>Title</h1>", html_out)

    def test_layout_main_toc_has_no_javascript(self):
        markdown_text = "<!-- layout: main -->\n## Only Section\n\nBody."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertNotIn("<script", html_out)

    def test_layout_main_duplicate_heading_text_gets_distinct_slugs(self):
        markdown_text = (
            "<!-- layout: main -->\n"
            "## Overview\n\nFirst.\n\n"
            "## Overview\n\nSecond."
        )

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('<section id="overview">', html_out)
        self.assertIn('<section id="overview-1">', html_out)
        self.assertIn('href="#overview"', html_out)
        self.assertIn('href="#overview-1"', html_out)

    def test_layout_directive_only_recognized_before_first_heading(self):
        markdown_text = "# Title\n\n<!-- layout: main -->\n\n## Section\n\nBody."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('max-width: 840px', html_out)
        self.assertNotIn('class="toc"', html_out)

    def test_unrecognized_layout_value_falls_back_to_deep_dive(self):
        markdown_text = "<!-- layout: sidebar -->\n# Title\n\n## Section\n\nBody."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn('max-width: 840px', html_out)

    def test_directive_line_is_not_rendered_as_paragraph_text(self):
        markdown_text = "<!-- layout: main -->\n## Section\n\nBody."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertNotIn("layout: main", html_out)

    def test_layout_main_preserves_intro_content_before_first_section(self):
        markdown_text = "<!-- layout: main -->\n# Title\n\nIntro paragraph.\n\n## Section\n\nBody."

        html_out = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertIn("<p>Intro paragraph.</p>", html_out)
        self.assertLess(html_out.index("<p>Intro paragraph.</p>"), html_out.index('<section id="section">'))


class RenderMarkdownDocumentVideoEmbedTests(unittest.TestCase):
    def test_no_video_tag_when_video_src_omitted(self):
        html = render_markdown_document("# Doc\n\nBody.", fallback_title="Doc")

        self.assertNotIn("<video", html)

    def test_video_tag_embedded_at_top_of_page_when_video_src_given(self):
        html = render_markdown_document("# Doc\n\nBody.", fallback_title="Doc", video_src="doc.mp4")

        self.assertIn('<video src="doc.mp4" controls', html)
        self.assertLess(html.index("<video"), html.index("<h1>Doc</h1>"))

    def test_video_src_is_html_escaped(self):
        html = render_markdown_document("Body.", fallback_title="Doc", video_src='a"b.mp4')

        self.assertIn('<video src="a&quot;b.mp4"', html)


class IsLocalMarkdownLinkTests(unittest.TestCase):
    def test_relative_md_path_is_local(self):
        self.assertTrue(is_local_markdown_link("../adr/0005-thing.md"))

    def test_relative_md_path_with_fragment_is_local(self):
        self.assertTrue(is_local_markdown_link("sibling.md#section"))

    def test_https_url_is_not_local(self):
        self.assertFalse(is_local_markdown_link("https://example.com/doc.md"))

    def test_mailto_is_not_local(self):
        self.assertFalse(is_local_markdown_link("mailto:someone@example.com"))

    def test_protocol_relative_url_is_not_local(self):
        self.assertFalse(is_local_markdown_link("//example.com/doc.md"))

    def test_non_markdown_local_path_is_not_a_local_markdown_link(self):
        self.assertFalse(is_local_markdown_link("picture.png"))


class ExtractLocalLinksTests(unittest.TestCase):
    def test_finds_local_link_in_paragraph(self):
        hrefs = extract_local_links("See [ADR 5](../adr/0005-thing.md) for details.")

        self.assertEqual(hrefs, ["../adr/0005-thing.md"])

    def test_ignores_external_link(self):
        hrefs = extract_local_links("See [Odoo](https://www.odoo.com).")

        self.assertEqual(hrefs, [])

    def test_finds_link_inside_list_item_and_table_cell(self):
        markdown_text = (
            "- [ADR 5](adr-5.md)\n\n"
            "| A | B |\n"
            "| --- | --- |\n"
            "| [ADR 6](adr-6.md) | plain |"
        )

        hrefs = extract_local_links(markdown_text)

        self.assertEqual(hrefs, ["adr-5.md", "adr-6.md"])

    def test_ignores_link_like_text_inside_fenced_code_block(self):
        markdown_text = "```\n[not a link](fake.md)\n```"

        hrefs = extract_local_links(markdown_text)

        self.assertEqual(hrefs, [])

    def test_unterminated_fence_still_raises(self):
        with self.assertRaises(MarkdownSyntaxError):
            extract_local_links("```\nunterminated\n")


class ExtractLocalImageRefsTests(unittest.TestCase):
    def test_finds_local_image_reference(self):
        hrefs = extract_local_image_refs("![alt](picture.png)")

        self.assertEqual(hrefs, ["picture.png"])

    def test_ignores_external_image_reference(self):
        hrefs = extract_local_image_refs("![alt](https://example.com/picture.png)")

        self.assertEqual(hrefs, [])

    def test_finds_image_inside_list_item_and_table_cell(self):
        markdown_text = (
            "- ![alt one](one.png)\n\n"
            "| A | B |\n"
            "| --- | --- |\n"
            "| ![alt two](two.png) | plain |"
        )

        hrefs = extract_local_image_refs(markdown_text)

        self.assertEqual(hrefs, ["one.png", "two.png"])

    def test_ignores_image_syntax_inside_fenced_code_block(self):
        hrefs = extract_local_image_refs("```\n![alt](fake.png)\n```")

        self.assertEqual(hrefs, [])

    def test_ignores_image_syntax_inside_inline_code_span(self):
        hrefs = extract_local_image_refs("Use `![alt](img.png)` syntax.")

        self.assertEqual(hrefs, [])

    def test_unterminated_fence_still_raises(self):
        with self.assertRaises(MarkdownSyntaxError):
            extract_local_image_refs("```\nunterminated\n")


if __name__ == "__main__":
    unittest.main()
