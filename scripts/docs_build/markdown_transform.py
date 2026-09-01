"""Pure Markdown -> self-contained HTML transform for the docs-build:doc pipeline.

Deliberately dependency-free (stdlib only) and side-effect-free: it never touches the
filesystem or network, so it runs anywhere Python does and is unit-testable without
Docker, PostgreSQL, or the Odoo registry. See docs/adr/0007 and
docs/teach/DESIGN-TOKENS.md for the visual system this reproduces, issue #35 for the
single-document rendering this started as, issue #38 for the local-`.md`-link
resolution `render_markdown_document`'s `link_resolver` hook exists to support, and
issue #37 for the local-image embedding its `image_resolver` hook exists to support
(the filesystem crawl and data-URI encoding both live in `scripts.docs_build.cli`,
not here — this module still never touches the filesystem). A local image reference
without an `image_resolver` cannot be embedded and is a `MarkdownSyntaxError`; an
external (http(s)) image reference always passes through unchanged.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from dataclasses import dataclass


class MarkdownSyntaxError(ValueError):
    """Raised when the input Markdown cannot be parsed unambiguously."""


_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)|(?<![\w_])_([^_]+)_(?![\w_])")
_IMAGE_RE = re.compile(r"!\[(.*?)\]\(([^)\s]+)\)")
_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")
_ORDERED_ITEM_RE = re.compile(r"^\d+\.\s+(.*)$")
_UNORDERED_ITEM_RE = re.compile(r"^[-*]\s+(.*)$")
_HORIZONTAL_RULE_RE = re.compile(r"^(-{3,}|\*{3,}|_{3,})$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_TABLE_SEPARATOR_RE = re.compile(r"^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$")
_EXTERNAL_LINK_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:|^//")

LinkResolver = Callable[[str], str]
ImageResolver = Callable[[str], str]


def is_local_markdown_link(href: str) -> bool:
    """True if `href` is a link to a local ``.md`` file (not an external URL)."""
    if _EXTERNAL_LINK_RE.match(href):
        return False
    return href.split("#", 1)[0].endswith(".md")


def is_local_image_reference(href: str) -> bool:
    """True if `href` is a local image reference (not an external URL)."""
    return not _EXTERNAL_LINK_RE.match(href)


def extract_local_links(markdown_text: str) -> list[str]:
    """Return every local ``.md`` href referenced by this document's rendered content.

    Skips fenced code blocks (not real links) and image syntax (extracted, and
    resolved, separately by ``extract_local_image_refs``). Raises
    ``MarkdownSyntaxError`` under the same conditions as
    ``render_markdown_document``.
    """
    blocks = _parse_blocks(markdown_text)
    hrefs: list[str] = []
    for block in blocks:
        for text in _inline_texts(block):
            for match in _LINK_RE.finditer(text):
                href = match.group(2)
                if is_local_markdown_link(href):
                    hrefs.append(href)
    return hrefs


def extract_local_image_refs(markdown_text: str) -> list[str]:
    """Return every local image href referenced by this document's rendered content.

    Skips fenced code blocks and inline code spans (not real image references).
    Raises ``MarkdownSyntaxError`` under the same conditions as
    ``render_markdown_document``.
    """
    blocks = _parse_blocks(markdown_text)
    hrefs: list[str] = []
    for block in blocks:
        for text in _inline_texts(block):
            text = _INLINE_CODE_RE.sub("", text)
            for match in _IMAGE_RE.finditer(text):
                href = match.group(2)
                if is_local_image_reference(href):
                    hrefs.append(href)
    return hrefs


def _inline_texts(block: _Block) -> list[str]:
    if isinstance(block, (_Heading, _Paragraph, _BlockQuote)):
        return [block.text]
    if isinstance(block, _List):
        return list(block.items)
    if isinstance(block, _Table):
        return [*block.header, *(cell for row in block.rows for cell in row)]
    return []


def render_markdown_document(
    markdown_text: str,
    fallback_title: str,
    link_resolver: LinkResolver | None = None,
    image_resolver: ImageResolver | None = None,
) -> str:
    """Render one Markdown document into a self-contained HTML page.

    Returns a full ``<!doctype html>`` document with the shared template inlined
    (no external stylesheets, fonts, or scripts) so the output has zero network
    dependencies at view time. Raises ``MarkdownSyntaxError`` on Markdown this
    parser cannot resolve unambiguously (for example, an unterminated fenced code
    block), or on a local image reference given no `image_resolver`.

    `link_resolver`, when given, rewrites local ``.md`` hrefs (see
    ``is_local_markdown_link``) to their generated-page equivalent; external
    URLs are always passed through unchanged.

    `image_resolver`, when given, rewrites local image hrefs (see
    ``is_local_image_reference``) to an embeddable ``src`` value (a data URI);
    external image URLs are always passed through unchanged.
    """
    blocks = _parse_blocks(markdown_text)
    title = _find_first_heading_text(blocks) or fallback_title
    body_html = "\n".join(_render_block(block, link_resolver, image_resolver) for block in blocks)
    return _TEMPLATE.format(title=html.escape(title, quote=False), body=body_html)


@dataclass
class _Heading:
    level: int
    text: str


@dataclass
class _Paragraph:
    text: str


@dataclass
class _CodeBlock:
    code: str


@dataclass
class _BlockQuote:
    text: str


@dataclass
class _List:
    ordered: bool
    items: list[str]


@dataclass
class _Table:
    header: list[str]
    rows: list[list[str]]


@dataclass
class _HorizontalRule:
    pass


_Block = _Heading | _Paragraph | _CodeBlock | _BlockQuote | _List | _Table | _HorizontalRule


def _parse_blocks(markdown_text: str) -> list[_Block]:
    lines = markdown_text.splitlines()
    blocks: list[_Block] = []
    index = 0
    while index < len(lines):
        line = lines[index]

        if not line.strip():
            index += 1
            continue

        if _is_fence(line):
            fence_start = index + 1
            code_lines = []
            index += 1
            closed = False
            while index < len(lines):
                if _is_fence(lines[index]):
                    closed = True
                    index += 1
                    break
                code_lines.append(lines[index])
                index += 1
            if not closed:
                raise MarkdownSyntaxError(
                    f"unterminated fenced code block starting at line {fence_start}",
                )
            blocks.append(_CodeBlock(code="\n".join(code_lines)))
            continue

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            blocks.append(_Heading(level=len(heading_match.group(1)), text=heading_match.group(2).strip()))
            index += 1
            continue

        if _is_horizontal_rule(line):
            blocks.append(_HorizontalRule())
            index += 1
            continue

        if _is_blockquote(line):
            quote_lines = []
            while index < len(lines) and _is_blockquote(lines[index]):
                quote_lines.append(re.sub(r"^\s*>\s?", "", lines[index]))
                index += 1
            blocks.append(_BlockQuote(text=" ".join(quote_lines).strip()))
            continue

        if _is_list_item(line):
            ordered = bool(_ORDERED_ITEM_RE.match(line))
            items = []
            while index < len(lines):
                item_match = (_ORDERED_ITEM_RE if ordered else _UNORDERED_ITEM_RE).match(lines[index])
                if not item_match:
                    break
                items.append(item_match.group(1).strip())
                index += 1
            blocks.append(_List(ordered=ordered, items=items))
            continue

        if _is_table_start(line, lines[index + 1] if index + 1 < len(lines) else None):
            header = _split_table_row(line)
            index += 2
            rows = []
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(_split_table_row(lines[index]))
                index += 1
            blocks.append(_Table(header=header, rows=rows))
            continue

        paragraph_lines = [line]
        index += 1
        while index < len(lines) and lines[index].strip():
            next_line = lines[index + 1] if index + 1 < len(lines) else None
            if _starts_new_block(lines[index], next_line):
                break
            paragraph_lines.append(lines[index])
            index += 1
        blocks.append(_Paragraph(text=" ".join(paragraph_lines)))

    return blocks


def _is_fence(line: str) -> bool:
    return line.strip().startswith("```")


def _is_horizontal_rule(line: str) -> bool:
    return bool(_HORIZONTAL_RULE_RE.match(line.strip()))


def _is_blockquote(line: str) -> bool:
    return line.lstrip().startswith(">")


def _is_list_item(line: str) -> bool:
    return bool(_UNORDERED_ITEM_RE.match(line) or _ORDERED_ITEM_RE.match(line))


def _starts_new_block(line: str, next_line: str | None) -> bool:
    return bool(
        _is_fence(line)
        or _HEADING_RE.match(line)
        or _is_horizontal_rule(line)
        or _is_blockquote(line)
        or _is_list_item(line)
        or _is_table_start(line, next_line),
    )


def _is_table_start(line: str, next_line: str | None) -> bool:
    return bool("|" in line and next_line is not None and _TABLE_SEPARATOR_RE.match(next_line.strip()))


def _split_table_row(line: str) -> list[str]:
    stripped = line.strip().strip("|")
    return [cell.strip() for cell in stripped.split("|")]


def _find_first_heading_text(blocks: list[_Block]) -> str | None:
    for block in blocks:
        if isinstance(block, _Heading):
            return block.text
    return None


def _render_block(
    block: _Block,
    link_resolver: LinkResolver | None,
    image_resolver: ImageResolver | None = None,
) -> str:
    if isinstance(block, _Heading):
        return f"<h{block.level}>{_render_inline(block.text, link_resolver, image_resolver)}</h{block.level}>"
    if isinstance(block, _Paragraph):
        return f"<p>{_render_inline(block.text, link_resolver, image_resolver)}</p>"
    if isinstance(block, _CodeBlock):
        return f"<pre><code>{html.escape(block.code, quote=False)}</code></pre>"
    if isinstance(block, _BlockQuote):
        rendered = _render_inline(block.text, link_resolver, image_resolver)
        return f'<blockquote class="callout">{rendered}</blockquote>'
    if isinstance(block, _List):
        tag = "ol" if block.ordered else "ul"
        items = "".join(
            f"<li>{_render_inline(item, link_resolver, image_resolver)}</li>" for item in block.items
        )
        return f"<{tag}>{items}</{tag}>"
    if isinstance(block, _Table):
        return _render_table(block, link_resolver, image_resolver)
    if isinstance(block, _HorizontalRule):
        return "<hr>"
    raise TypeError(f"unknown block type: {block!r}")


def _render_table(
    table: _Table,
    link_resolver: LinkResolver | None,
    image_resolver: ImageResolver | None = None,
) -> str:
    header_html = "".join(
        f"<th>{_render_inline(cell, link_resolver, image_resolver)}</th>" for cell in table.header
    )
    rows_html = "".join(
        "<tr>"
        + "".join(f"<td>{_render_inline(cell, link_resolver, image_resolver)}</td>" for cell in row)
        + "</tr>"
        for row in table.rows
    )
    return (
        '<div class="table-wrap"><table>'
        f"<thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody>"
        "</table></div>"
    )


def _render_inline(
    text: str,
    link_resolver: LinkResolver | None = None,
    image_resolver: ImageResolver | None = None,
) -> str:
    escaped = html.escape(text, quote=True)

    code_spans = []

    def _stash_code(match: re.Match) -> str:
        code_spans.append(match.group(1))
        return f"\x00CODE{len(code_spans) - 1}\x00"

    escaped = _INLINE_CODE_RE.sub(_stash_code, escaped)

    def _rewrite_image(match: re.Match) -> str:
        alt, href = match.group(1), match.group(2)
        raw_href = html.unescape(href)
        src = href
        if is_local_image_reference(raw_href):
            if image_resolver is None:
                raise MarkdownSyntaxError(
                    f"image reference {raw_href!r} cannot be embedded without an image_resolver",
                )
            src = html.escape(image_resolver(raw_href), quote=True)
        return f'<img src="{src}" alt="{alt}">'

    escaped = _IMAGE_RE.sub(_rewrite_image, escaped)

    def _rewrite_link(match: re.Match) -> str:
        label, href = match.group(1), match.group(2)
        if link_resolver is not None and is_local_markdown_link(href):
            href = link_resolver(href)
        return f'<a href="{href}" rel="noopener noreferrer">{label}</a>'

    escaped = _LINK_RE.sub(_rewrite_link, escaped)
    escaped = _BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = _ITALIC_RE.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", escaped)

    for index, code in enumerate(code_spans):
        escaped = escaped.replace(f"\x00CODE{index}\x00", f"<code>{code}</code>")

    return escaped


_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root{{
  --ink-900:#1B2430; --ink-700:#3E4A59; --ink-500:#6B7688;
  --paper-0:#F3F4EF; --paper-1:#FFFFFF; --line:#D3D6CC;
  --amber:#B96A22; --amber-soft:#F0DFC7;
  --teal:#2E6B60; --teal-soft:#D9E8E3;
  --violet:#5B5285; --violet-soft:#E5E2F0;
  --block:#A23B3B; --block-soft:#F3DBDB;
  --shadow: 0 1px 2px rgba(27,36,48,.06), 0 8px 24px rgba(27,36,48,.05);
  color-scheme: light;
}}
@media (prefers-color-scheme: dark){{
  :root:not([data-theme="light"]){{
    --ink-900:#ECEAE2; --ink-700:#C7CCC0; --ink-500:#93998C;
    --paper-0:#181B17; --paper-1:#20241F; --line:#3A3F35;
    --amber:#E0954C; --amber-soft:#3B2C18;
    --teal:#6FBBAC; --teal-soft:#1D332E;
    --violet:#B0A6E0; --violet-soft:#2A2540;
    --block:#E28080; --block-soft:#3A2222;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
    color-scheme: dark;
  }}
}}
:root[data-theme="dark"]{{
  --ink-900:#ECEAE2; --ink-700:#C7CCC0; --ink-500:#93998C;
  --paper-0:#181B17; --paper-1:#20241F; --line:#3A3F35;
  --amber:#E0954C; --amber-soft:#3B2C18;
  --teal:#6FBBAC; --teal-soft:#1D332E;
  --violet:#B0A6E0; --violet-soft:#2A2540;
  --block:#E28080; --block-soft:#3A2222;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
  color-scheme: dark;
}}
*{{ box-sizing: border-box; }}
body{{
  margin: 0;
  background: var(--paper-0);
  color: var(--ink-900);
  font-family: Karla, system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.6;
}}
.shell{{
  max-width: 840px;
  margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 2rem) 6rem;
}}
h1, h2, h3, h4, h5, h6{{
  font-family: "Source Serif 4", Georgia, serif;
  font-weight: 600;
  color: var(--ink-900);
}}
code, pre{{
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}}
pre{{
  background: var(--paper-1);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 1rem;
  overflow-x: auto;
}}
a{{ color: var(--teal); }}
a:focus-visible, button:focus-visible{{
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}}
blockquote.callout{{
  border-left: 3px solid var(--amber);
  background: var(--amber-soft);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  margin: 1rem 0;
}}
hr{{
  border: none;
  border-top: 1px solid var(--line);
  margin: 2rem 0;
}}
.table-wrap{{
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  box-shadow: var(--shadow);
  margin: 1rem 0;
}}
table{{
  border-collapse: collapse;
  width: 100%;
}}
th, td{{
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--line);
}}
th{{
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-transform: uppercase;
  font-size: 0.75rem;
  background: var(--paper-0);
}}
td{{
  background: var(--paper-1);
}}
@media (prefers-reduced-motion: reduce){{
  *{{ transition: none !important; }}
}}
</style>
</head>
<body>
<main class="shell">
{body}
</main>
</body>
</html>
"""
