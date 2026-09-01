"""Thin CLI wrapper around the pure Markdown transform for `docs-build:doc`.

Invoked as `./scripts/dev.ps1 docs-build:doc <file>` / `bash scripts/dev.sh
docs-build:doc <file>`. Reads one docs/teach/*.md entry file, renders it (and
the closure of every local `.md` file it links to, transitively — an ADR, a
CONTEXT.md, a research doc, another teach doc) through
scripts.docs_build.markdown_transform, and writes each as self-contained HTML
under custom_addons/crm_methodology/static/docs/ (see docs/adr/0007 for why
that directory is the publishing path). Internal links are rewritten to point
at the generated page; external URLs pass through unchanged. See issue #38.

A document is only rendered because something in the closure links to it —
this is not a whole-repo Markdown build.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
    extract_local_links,
    render_markdown_document,
)

DEFAULT_OUTPUT_DIR = Path("custom_addons/crm_methodology/static/docs")


class DocsBuildError(Exception):
    """Raised for any docs-build:doc failure that should stop the CLI with a clear message."""


@dataclass
class _Document:
    markdown_text: str
    local_links: dict[str, Path]  # raw href -> resolved source path, both as found in this doc


def build_doc(source: Path, output_dir: Path) -> Path:
    """Render `source` and its closure of local `.md` links under `output_dir`.

    Returns the path written for `source` itself.
    """
    if source.suffix != ".md":
        raise DocsBuildError(f"{source}: only .md source files are supported")
    if not source.is_file():
        raise DocsBuildError(f"{source}: source file not found")

    closure = _discover_closure(source)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_paths = _assign_output_paths(closure, output_dir)

    for doc_path, document in closure.items():
        fallback_title = _title_from_filename(doc_path.stem)

        def resolve_href(href: str, _local_links: dict[str, Path] = document.local_links) -> str:
            target = _local_links[href]
            fragment = href.split("#", 1)[1] if "#" in href else None
            html_href = output_paths[target].name
            return f"{html_href}#{fragment}" if fragment is not None else html_href

        try:
            rendered_html = render_markdown_document(
                document.markdown_text,
                fallback_title=fallback_title,
                link_resolver=resolve_href,
            )
        except MarkdownSyntaxError as exc:
            raise DocsBuildError(f"{doc_path}: {exc}") from exc

        output_paths[doc_path].write_text(rendered_html, encoding="utf-8")

    return output_paths[source]


def _discover_closure(entry: Path) -> dict[Path, _Document]:
    """Walk the local-`.md`-link graph reachable from `entry`.

    Returns a map of every reachable document (including `entry`) to its parsed
    text and its own `{raw_href: resolved_target_path}` links, in the order
    first discovered. Raises ``DocsBuildError`` for a link that doesn't resolve
    to a real file, naming both the linking document and the broken reference.
    """
    closure: dict[Path, _Document] = {}
    queue = [entry]
    queued = {entry}

    while queue:
        doc_path = queue.pop(0)

        try:
            markdown_text = doc_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise DocsBuildError(f"{doc_path}: could not read source file ({exc})") from exc

        try:
            hrefs = extract_local_links(markdown_text)
        except MarkdownSyntaxError as exc:
            raise DocsBuildError(f"{doc_path}: {exc}") from exc

        local_links: dict[str, Path] = {}
        for href in hrefs:
            path_part = href.split("#", 1)[0]
            target = doc_path.parent / path_part
            if not target.is_file():
                raise DocsBuildError(
                    f"{doc_path}: broken internal link {href!r} does not resolve to an existing file",
                )
            local_links[href] = target
            if target not in queued:
                queued.add(target)
                queue.append(target)

        closure[doc_path] = _Document(markdown_text=markdown_text, local_links=local_links)

    return closure


def _assign_output_paths(closure: dict[Path, _Document], output_dir: Path) -> dict[Path, Path]:
    """Map each closure member to its output file, rejecting basename collisions.

    Output filenames are flat (see docs/adr/0007) — two different source
    documents that happen to share a filename stem (e.g. two `CONTEXT.md`
    files under different `docs/contexts/*/` directories) would otherwise
    silently overwrite each other.
    """
    output_paths: dict[Path, Path] = {}
    by_output_name: dict[str, Path] = {}
    for doc_path in closure:
        output_name = f"{doc_path.stem}.html"
        if output_name in by_output_name and by_output_name[output_name] != doc_path:
            raise DocsBuildError(
                f"output filename collision: {by_output_name[output_name]} and {doc_path} "
                f"both render to {output_name!r}",
            )
        by_output_name[output_name] = doc_path
        output_paths[doc_path] = output_dir / output_name
    return output_paths


def _title_from_filename(stem: str) -> str:
    return " ".join(word.capitalize() for word in stem.replace("_", "-").split("-"))


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("Usage: docs-build:doc <file.md>\n")
        return 2

    source = Path(argv[0])
    try:
        output_path = build_doc(source, DEFAULT_OUTPUT_DIR)
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:doc failed: {exc}\n")
        return 1

    sys.stdout.write(f"Wrote {output_path}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
