"""Thin CLI wrapper around the pure Markdown transform for `docs-build:doc`.

Invoked as `./scripts/dev.ps1 docs-build:doc <file>` / `bash scripts/dev.sh
docs-build:doc <file>`. Reads one docs/teach/*.md entry file, renders it (and
the closure of every local `.md` file it links to, transitively — an ADR, a
CONTEXT.md, a research doc, another teach doc) through
scripts.docs_build.markdown_transform, and writes each as self-contained HTML
under custom_addons/crm_methodology/static/docs/ (see docs/adr/0007 for why
that directory is the publishing path). Internal links are rewritten to point
at the generated page; external URLs pass through unchanged. See issue #38.

Every local image a rendered document references (a product screenshot, a
pre-authored diagram — never a pipeline-rendered Mermaid diagram, see issue
#33) is read from disk and embedded into that document's HTML as a data URI,
so the generated page has no separate file dependency. See issue #37. A local
image that doesn't resolve to a readable file fails the build, naming both the
referencing document and the missing file, the same way a broken internal
`.md` link does. A source image at or above `_LARGE_IMAGE_WARNING_BYTES`
still embeds, but prints a build warning, since a large embedded image bloats
every view of the page it's on.

If a document's own output directory already holds a sibling MP4 (named
`<stem>.mp4`, matching the generated `<stem>.html`) — written there by a prior
`docs-build:video` run, mechanically re-rendering an already-authored
HyperFrames project (see docs/adr/0008 and issue #40) — the generated page
embeds it as a `<video>` tag at the top of the page. It is never base64-encoded
like an image: video doesn't compress usefully into a data URI and can't
stream or seek from one. A document with no sibling MP4 renders with no video
tag at all.

A document is only rendered because something in the closure links to it —
this is not a whole-repo Markdown build.
"""

from __future__ import annotations

import base64
import mimetypes
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
    extract_local_image_refs,
    extract_local_links,
    render_markdown_document,
)

DEFAULT_OUTPUT_DIR = Path("custom_addons/crm_methodology/static/docs")

# A generated page embeds every local image inline as a base64 data URI (roughly a
# third larger than the source file). This is a per-image guideline, not an
# enforced cap: crossing it still embeds the image, but prints a build warning,
# since a single oversized screenshot would otherwise bloat every view of its page
# silently.
_LARGE_IMAGE_WARNING_BYTES = 300 * 1024


class DocsBuildError(Exception):
    """Raised for any docs-build:doc failure that should stop the CLI with a clear message."""


@dataclass
class _Document:
    markdown_text: str
    local_links: dict[str, Path]  # raw href -> resolved source path, both as found in this doc
    local_images: dict[str, Path]  # raw href -> resolved source path, both as found in this doc


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
        output_path = output_paths[doc_path]
        video_path = output_path.with_suffix(".mp4")
        video_src = video_path.name if video_path.is_file() else None

        def resolve_href(href: str, _local_links: dict[str, Path] = document.local_links) -> str:
            target = _local_links[href]
            fragment = href.split("#", 1)[1] if "#" in href else None
            html_href = output_paths[target].name
            return f"{html_href}#{fragment}" if fragment is not None else html_href

        def resolve_image(href: str, _local_images: dict[str, Path] = document.local_images) -> str:
            return _embed_image_as_data_uri(_local_images[href], referencing_doc=doc_path)

        try:
            rendered_html = render_markdown_document(
                document.markdown_text,
                fallback_title=fallback_title,
                link_resolver=resolve_href,
                image_resolver=resolve_image,
                video_src=video_src,
            )
        except MarkdownSyntaxError as exc:
            raise DocsBuildError(f"{doc_path}: {exc}") from exc

        output_paths[doc_path].write_text(rendered_html, encoding="utf-8")

    return output_paths[source]


def _embed_image_as_data_uri(image_path: Path, *, referencing_doc: Path) -> str:
    """Read `image_path` and return a base64 data URI suitable for an `<img src>`.

    Prints a build warning (not a failure) to stderr for an oversized source
    image; see `_LARGE_IMAGE_WARNING_BYTES`.
    """
    try:
        image_bytes = image_path.read_bytes()
    except OSError as exc:
        raise DocsBuildError(f"{referencing_doc}: could not read image {image_path} ({exc})") from exc

    if len(image_bytes) >= _LARGE_IMAGE_WARNING_BYTES:
        sys.stderr.write(
            f"docs-build:doc warning: {referencing_doc}: image {image_path} is "
            f"{len(image_bytes) / 1024:.0f} KiB, at or above the "
            f"{_LARGE_IMAGE_WARNING_BYTES // 1024} KiB embedding guideline\n",
        )

    mime_type, _ = mimetypes.guess_type(image_path.name)
    mime_type = mime_type or "application/octet-stream"

    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _discover_closure(entry: Path) -> dict[Path, _Document]:
    """Walk the local-`.md`-link graph reachable from `entry`.

    Returns a map of every reachable document (including `entry`) to its parsed
    text and its own `{raw_href: resolved_target_path}` links and image
    references, in the order first discovered. Raises ``DocsBuildError`` for a
    link or image reference that doesn't resolve to a real file, naming both
    the referencing document and the missing reference.
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
            image_hrefs = extract_local_image_refs(markdown_text)
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

        local_images: dict[str, Path] = {}
        for href in image_hrefs:
            target = doc_path.parent / href
            if not target.is_file():
                raise DocsBuildError(
                    f"{doc_path}: missing image {href!r} does not resolve to an existing file",
                )
            local_images[href] = target

        closure[doc_path] = _Document(
            markdown_text=markdown_text,
            local_links=local_links,
            local_images=local_images,
        )

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
