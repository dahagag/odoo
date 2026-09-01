import unittest

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
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

    def test_is_deterministic_pure_function(self):
        markdown_text = "# Title\n\nSome **body** text with a [link](https://example.com)."

        first = render_markdown_document(markdown_text, fallback_title="Doc")
        second = render_markdown_document(markdown_text, fallback_title="Doc")

        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
