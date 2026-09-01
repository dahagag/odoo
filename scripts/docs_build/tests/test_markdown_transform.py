import unittest

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
    extract_local_links,
    is_local_markdown_link,
    render_markdown_document,
)


class RenderMarkdownDocumentTests(unittest.TestCase):
    def test_is_self_contained_with_no_network_dependencies(self):
        html = render_markdown_document("Body text.", fallback_title="Doc")

        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
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

    def test_image_syntax_is_malformed(self):
        markdown_text = "See this: ![alt text](picture.png)"

        with self.assertRaises(MarkdownSyntaxError):
            render_markdown_document(markdown_text, fallback_title="Doc")

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


if __name__ == "__main__":
    unittest.main()
