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
external (http(s)) image reference always passes through unchanged. Per docs/adr/0009,
"side-effect-free" is about this transform's own execution, not the pages it emits:
generated HTML loads the Google Fonts stylesheet over the network at view time.
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
_INLINE_HTML_RE = re.compile(r"</?(?:span|mark|sup|sub|kbd|br)(?:\s+[^<>]*)?/?>")
_DIRECTIVE_RE = re.compile(r"^<!--\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*-->$")
_SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")

LinkResolver = Callable[[str], str]
ImageResolver = Callable[[str], str]

_TAG_LABELS = {"s": "Sales", "r": "R&D", "c": "Consultants"}


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
    video_src: str | None = None,
) -> str:
    """Render one Markdown document into a self-contained HTML page.

    Returns a full ``<!doctype html>`` document with the shared template inlined.
    Per ADR 0009, "self-contained" means no unresolved *local* images or links —
    not zero network access: the page still loads the Google Fonts stylesheet
    at view time, exactly as the hand-authored source Artifacts do. Raises
    ``MarkdownSyntaxError`` on Markdown this parser cannot resolve unambiguously
    (for example, an unterminated fenced code block), or on a local image
    reference given no `image_resolver`.

    `link_resolver`, when given, rewrites local ``.md`` hrefs (see
    ``is_local_markdown_link``) to their generated-page equivalent; external
    URLs are always passed through unchanged.

    `image_resolver`, when given, rewrites local image hrefs (see
    ``is_local_image_reference``) to an embeddable ``src`` value (a data URI);
    external image URLs are always passed through unchanged.

    `video_src`, when given, embeds a `<video>` tag at the top of the page
    pointing at that (relative) src — the sibling MP4 `docs-build:video`
    renders next to this document's generated HTML (see issue #40). Omitted
    cleanly when `video_src` is `None`.

    A `<!-- layout: main -->` comment directive, placed anywhere before the
    document's first heading (see ADR 0009), selects the multi-section
    layout: each top-level (H2) heading and the blocks under it become a
    `<section>`, preceded by an anchor-link table of contents. Per ADR 0009
    this layout also embeds the audience-filter legend and a small inline
    `<script>` (scroll-spy `IntersectionObserver` highlighting the current
    TOC entry, plus the `.chip` audience filter that dims non-matching
    sections and TOC entries) — reproduced verbatim from the reviewed
    Artifact this module tracks. Its absence renders today's single-column
    deep-dive layout, with no TOC, legend, or script.

    A `<!-- tags: s c -->` comment directive placed immediately above an
    `<h2>` sets that section's audience (space-separated values from
    `{s, r, c}` — Sales, R&D, Consultants). It renders as `.tag` badges next
    to the heading and a `data-tags="s c"` attribute on the generated
    `<section>`, for the audience-filter script to read. An `<h2>` with no
    directive above it gets neither. Raises `MarkdownSyntaxError` on an
    unrecognized tag value.
    """
    directives, markdown_text = _extract_document_directives(markdown_text)
    blocks = _parse_blocks(markdown_text)
    title = _find_first_heading_text(blocks) or fallback_title
    video_html = ""
    if video_src is not None:
        escaped_src = html.escape(video_src, quote=True)
        video_html = (
            '<div class="video-embed">'
            f'<video src="{escaped_src}" controls preload="metadata"></video>'
            "</div>"
        )
    escaped_title = html.escape(title, quote=False)

    if directives.get("layout") == "main":
        return _render_main_layout(blocks, escaped_title, video_html, link_resolver, image_resolver)

    body_html = _render_blocks(blocks, link_resolver, image_resolver)
    return _TEMPLATE.format(title=escaped_title, body=body_html, video=video_html)


def _extract_document_directives(markdown_text: str) -> tuple[dict[str, str], str]:
    """Parse `<!-- key: value -->` lines before the first heading; strip them out.

    Per ADR 0009, this is a single flat parser shared by every document- and
    section-level directive (`layout`, and the section-level `tags`) — no
    YAML dependency, matching this module's stdlib-only design.
    """
    lines = markdown_text.splitlines()
    directives: dict[str, str] = {}
    remaining_lines: list[str] = []
    seen_heading = False
    for index, line in enumerate(lines):
        if not seen_heading and _HEADING_RE.match(line):
            seen_heading = True
        if not seen_heading:
            match = _DIRECTIVE_RE.match(line.strip())
            if match and not _is_section_tags_directive(match, lines, index):
                directives[match.group(1)] = match.group(2)
                continue
        remaining_lines.append(line)
    return directives, "\n".join(remaining_lines)


def _is_section_tags_directive(match: re.Match, lines: list[str], index: int) -> bool:
    """True if `match` is a `tags` directive immediately above an `<h2>`.

    Such a directive is section-scoped (see `_parse_blocks`), not document-level,
    even when it appears before the document's first heading (e.g. a doc whose
    first heading is the H2 it tags, with no preceding H1).
    """
    if match.group(1) != "tags" or index + 1 >= len(lines):
        return False
    next_heading_match = _HEADING_RE.match(lines[index + 1])
    return bool(next_heading_match and len(next_heading_match.group(1)) == 2)


def _parse_tags_directive(value: str) -> list[str]:
    tags = value.split()
    for tag in tags:
        if tag not in _TAG_LABELS:
            raise MarkdownSyntaxError(
                f"unrecognized tags directive value {tag!r}, expected one of {sorted(_TAG_LABELS)}",
            )
    return tags


def _slugify(text: str, seen_slugs: dict[str, int]) -> str:
    base = _SLUG_INVALID_RE.sub("-", text.lower()).strip("-") or "section"
    count = seen_slugs.get(base, 0)
    seen_slugs[base] = count + 1
    return base if count == 0 else f"{base}-{count}"


def _split_into_sections(
    blocks: list[_Block],
) -> tuple[list[_Block], list[tuple[str, str, list[str] | None, list[_Block]]]]:
    """Split blocks into leading (pre-first-H2) blocks and H2-headed sections.

    Each section's blocks include its own heading, so `_render_block` needs
    no special-casing to render it.
    """
    intro_blocks: list[_Block] = []
    sections: list[tuple[str, str, list[str] | None, list[_Block]]] = []
    current_section: list[_Block] | None = None
    seen_slugs: dict[str, int] = {}
    for block in blocks:
        if isinstance(block, _Heading) and block.level == 2:
            slug = _slugify(block.text, seen_slugs)
            current_section = [block]
            sections.append((block.text, slug, block.tags, current_section))
            continue
        if current_section is None:
            intro_blocks.append(block)
        else:
            current_section.append(block)
    return intro_blocks, sections


def _render_tags_badges(tags: list[str]) -> str:
    spans = "".join(
        f'<span class="tag {tag}" title="{html.escape(_TAG_LABELS[tag], quote=True)}">{tag.upper()}</span>'
        for tag in tags
    )
    return f'<span class="tags">{spans}</span>'


def _render_main_layout(
    blocks: list[_Block],
    escaped_title: str,
    video_html: str,
    link_resolver: LinkResolver | None,
    image_resolver: ImageResolver | None,
) -> str:
    intro_blocks, sections = _split_into_sections(blocks)
    intro_html = _render_blocks(intro_blocks, link_resolver, image_resolver)
    toc_items = "".join(
        f'<li><a href="#{html.escape(slug, quote=True)}" data-target="{html.escape(slug, quote=True)}">'
        f"{html.escape(heading_text, quote=False)}</a></li>"
        for heading_text, slug, _tags, _ in sections
    )
    sections_html = "".join(
        f'<section id="{html.escape(slug, quote=True)}"'
        + (f' data-tags="{html.escape(" ".join(tags), quote=True)}"' if tags else "")
        + ">"
        + '<div class="sec-head">'
        + _render_block(section_blocks[0], link_resolver, image_resolver)
        + (_render_tags_badges(tags) if tags else "")
        + "</div>"
        + _render_blocks(section_blocks[1:], link_resolver, image_resolver)
        + "</section>"
        for _heading_text, slug, tags, section_blocks in sections
    )
    return _MAIN_TEMPLATE.format(
        title=escaped_title,
        video=video_html,
        intro=intro_html,
        toc_items=toc_items,
        sections=sections_html,
        legend=_LEGEND_HTML,
        script=_MAIN_LAYOUT_SCRIPT,
    )


@dataclass
class _Heading:
    level: int
    text: str
    tags: list[str] | None = None


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

        tags_directive_match = _DIRECTIVE_RE.match(line.strip())
        if tags_directive_match and _is_section_tags_directive(tags_directive_match, lines, index):
            next_heading_match = _HEADING_RE.match(lines[index + 1])
            tags = _parse_tags_directive(tags_directive_match.group(2))
            blocks.append(_Heading(level=2, text=next_heading_match.group(2).strip(), tags=tags))
            index += 2
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


def _render_blocks(
    blocks: list[_Block],
    link_resolver: LinkResolver | None,
    image_resolver: ImageResolver | None,
) -> str:
    return "\n".join(_render_block(block, link_resolver, image_resolver) for block in blocks)


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
    code_spans: list[str] = []

    def _stash_code(match: re.Match) -> str:
        code_spans.append(match.group(1))
        return f"\x00CODE{len(code_spans) - 1}\x00"

    # Code spans are pulled out of the raw text first so an allowlisted tag written
    # literally inside backticks (e.g. `` `<span>` ``) is shown as text, not rendered.
    text_without_code = _INLINE_CODE_RE.sub(_stash_code, text)

    html_tags: list[str] = []

    def _stash_html_tag(match: re.Match) -> str:
        html_tags.append(match.group(0))
        return f"\x00HTML{len(html_tags) - 1}\x00"

    text_with_placeholders = _INLINE_HTML_RE.sub(_stash_html_tag, text_without_code)
    escaped = html.escape(text_with_placeholders, quote=True)

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

    for index, tag in enumerate(html_tags):
        escaped = escaped.replace(f"\x00HTML{index}\x00", tag)

    for index, code in enumerate(code_spans):
        escaped = escaped.replace(f"\x00CODE{index}\x00", f"<code>{html.escape(code, quote=True)}</code>")

    return escaped


_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
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
.video-embed{{
  margin: 0 0 2rem;
}}
.video-embed video{{
  display: block;
  width: 100%;
  border-radius: 0.5rem;
  box-shadow: var(--shadow);
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
.pill, .demo-badge{{
  display: inline-block;
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
}}
.pill.new{{ background: var(--teal-soft); color: var(--teal); }}
.pill.ext{{ background: var(--violet-soft); color: var(--violet); }}
.pill.same{{ background: var(--block-soft); color: var(--block); }}
.demo-badge{{ background: var(--teal-soft); color: var(--teal); }}
@media (prefers-reduced-motion: reduce){{
  *{{ transition: none !important; }}
}}
</style>
</head>
<body>
<main class="shell">
{video}
{body}
</main>
</body>
</html>
"""


_MAIN_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
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
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 3rem) 6rem;
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
.video-embed{{
  margin: 0 0 2rem;
}}
.video-embed video{{
  display: block;
  width: 100%;
  border-radius: 0.5rem;
  box-shadow: var(--shadow);
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
.pill, .demo-badge{{
  display: inline-block;
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
}}
.pill.new{{ background: var(--teal-soft); color: var(--teal); }}
.pill.ext{{ background: var(--violet-soft); color: var(--violet); }}
.pill.same{{ background: var(--block-soft); color: var(--block); }}
.demo-badge{{ background: var(--teal-soft); color: var(--teal); }}
.layout{{
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 2.5rem;
  align-items: start;
}}
@media (max-width: 860px){{
  .layout{{ grid-template-columns: 1fr; }}
}}
nav.toc{{
  position: sticky;
  top: 1.5rem;
}}
nav.toc ol{{
  list-style: none;
  margin: 0;
  padding: 0;
}}
nav.toc li{{
  margin-bottom: 0.5rem;
}}
nav.toc a{{
  color: var(--ink-700);
  text-decoration: none;
}}
nav.toc a:hover{{
  color: var(--teal);
}}
section + section{{
  margin-top: 3rem;
}}
.sec-head{{
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}}
.sec-head h2{{
  margin: 0;
}}
.tags{{
  display: inline-flex;
  gap: 0.3rem;
}}
.tag{{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  color: #fff;
}}
.tag.s{{ background: var(--teal); }}
.tag.r{{ background: var(--violet); }}
.tag.c{{ background: var(--amber); }}
.legend{{
  display: flex;
  flex-wrap: wrap;
  gap: .6rem;
  align-items: center;
  margin: 0 0 2rem;
}}
.legend-label{{
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .72rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-500);
  margin-right: .25rem;
}}
.chip{{
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .78rem;
  font-weight: 500;
  border-radius: 999px;
  padding: .36rem .85rem;
  border: 1px solid var(--line);
  background: var(--paper-1);
  color: var(--ink-700);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}}
.chip:hover{{ box-shadow: var(--shadow); transform: translateY(-1px); }}
.chip[data-active="true"]{{
  border-color: transparent;
  color: var(--paper-1);
}}
.chip.s[data-active="true"]{{ background: var(--teal); }}
.chip.r[data-active="true"]{{ background: var(--violet); }}
.chip.c[data-active="true"]{{ background: var(--amber); }}
.chip .dot{{ width: .5rem; height: .5rem; border-radius: 50%; }}
.chip.s .dot{{ background: var(--teal); }}
.chip.r .dot{{ background: var(--violet); }}
.chip.c .dot{{ background: var(--amber); }}
.chip[data-active="true"] .dot{{ background: var(--paper-1); }}
#reset-filter{{
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .75rem;
  color: var(--ink-500);
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
  padding: .36rem .3rem;
}}
#reset-filter[hidden]{{ display: none; }}
nav.toc a.current{{
  color: var(--amber);
  border-left-color: var(--amber);
  font-weight: 500;
}}
nav.toc a[data-dim="true"]{{ opacity: .35; }}
section[data-dim="true"]{{ opacity: .3; }}
@media (prefers-reduced-motion: reduce){{
  *{{ transition: none !important; }}
}}
</style>
</head>
<body>
<main class="shell">
{video}
{intro}
{legend}
<div class="layout">
<nav class="toc" aria-label="Table of contents"><ol id="toc-list">
{toc_items}
</ol></nav>
<div class="content">
{sections}
</div>
</div>
</main>
{script}
</body>
</html>
"""

_LEGEND_HTML = (
    '<div class="legend">'
    '<span class="legend-label">Filter by audience</span>'
    '<button class="chip s" data-filter="s" data-active="false"><span class="dot"></span>Sales</button>'
    '<button class="chip r" data-filter="r" data-active="false"><span class="dot"></span>R&amp;D</button>'
    '<button class="chip c" data-filter="c" data-active="false"><span class="dot"></span>Consultants</button>'
    '<button id="reset-filter" hidden>Clear filter</button>'
    "</div>"
)

_MAIN_LAYOUT_SCRIPT = """<script>
  (function(){
    var sections = Array.prototype.slice.call(document.querySelectorAll('main > section'));
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('#toc-list a'));
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    var resetBtn = document.getElementById('reset-filter');
    var active = null;

    function applyFilter(tag){
      active = tag;
      chips.forEach(function(c){ c.dataset.active = (c.dataset.filter === tag) ? 'true' : 'false'; });
      resetBtn.hidden = !tag;
      function isDimmed(sec){
        var tags = (sec.dataset.tags || '').split(' ');
        return tag && tags.indexOf(tag) === -1;
      }
      sections.forEach(function(sec){
        sec.dataset.dim = isDimmed(sec) ? 'true' : 'false';
      });
      tocLinks.forEach(function(a){
        var sec = document.getElementById(a.dataset.target);
        a.dataset.dim = isDimmed(sec) ? 'true' : 'false';
      });
    }

    chips.forEach(function(chip){
      chip.addEventListener('click', function(){
        var tag = chip.dataset.filter;
        applyFilter(active === tag ? null : tag);
      });
    });
    resetBtn.addEventListener('click', function(){ applyFilter(null); });

    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var link = document.querySelector('#toc-list a[data-target="' + entry.target.id + '"]');
        if(!link) return;
        if(entry.isIntersecting){
          tocLinks.forEach(function(a){ a.classList.remove('current'); });
          link.classList.add('current');
        }
      });
    }, { rootMargin: '-10% 0px -70% 0px' });
    sections.forEach(function(sec){ observer.observe(sec); });
  })();
</script>"""
