"""Thin CLI wrapper around the pure Markdown transform for `docs-build:doc`.

Invoked as `./scripts/dev.ps1 docs-build:doc <file>` / `bash scripts/dev.sh
docs-build:doc <file>`. Reads one docs/teach/*.md entry file, renders it (and
the closure of every local `.md` file it links to, transitively — an ADR, a
CONTEXT.md, a research doc, another teach doc) through
scripts.docs_build.markdown_transform, and writes each as self-contained HTML
under custom_addons/crm_methodology/static/docs/ (see docs/adr/0007 for why
that directory is the publishing path). Internal links are rewritten to point
at the generated page; external URLs pass through unchanged. See issue #38.

Invoked with no file argument, it instead rebuilds the whole `docs/teach/`
directory: every `docs/teach/*.md` file (except `_REFERENCE_ONLY_FILENAMES`,
docs that document themselves as implementation reference rather than
stakeholder-facing content) becomes an entry point, and the combined link
closure of all of them is rendered together in one pass — a document linked
from two different teach docs is still written once. Entries are discovered
in a fixed sorted order so two runs against unchanged input produce
byte-identical output; a failure on any entry or any document in the closure
exits non-zero naming that specific file, exactly as the single-file mode
does. See issue #41.

Every local image a rendered document references (a product screenshot, a
pre-authored diagram — never a pipeline-rendered Mermaid diagram, see issue
#33) is read from disk and embedded into that document's HTML as a data URI,
so the generated page has no separate file dependency. See issue #37. A local
image that doesn't resolve to a readable file fails the build, naming both the
referencing document and the missing file, the same way a broken internal
`.md` link does. A source image at or above `_LARGE_IMAGE_WARNING_BYTES`
still embeds, but prints a build warning, since a large embedded image bloats
every view of the page it's on.

If a document has an authored HyperFrames project at
`<document-dir>/videos/<stem>/hyperframes.json`, the generated page embeds the
expected sibling `<stem>.mp4` as a `<video>` tag. The project declaration, not
leftover output-directory state, controls the HTML, so clean and repeated
builds agree before `docs-build:video` mechanically re-renders the media (see
docs/adr/0008 and issue #40). Video is never base64-encoded like an image: it
doesn't compress usefully into a data URI and couldn't stream or seek from one.

A whole-directory build removes HTML files outside the discovered document
closure after every successful render. Cleanup is deliberately limited to
`*.html`; sibling media is independently governed and remains untouched.

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
TEACH_DIR = Path("docs/teach")

# docs/teach/DESIGN-TOKENS.md documents itself as implementation reference for this
# pipeline's own template, not stakeholder-facing content — "do not treat it as a
# third teach doc." A whole-directory build must honor that note rather than
# generating a page for it.
_REFERENCE_ONLY_FILENAMES = frozenset({"DESIGN-TOKENS.md"})

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

    closure = _discover_closure([source])
    output_paths = _render_closure(closure, output_dir)
    return output_paths[source]


def discover_teach_entries(teach_dir: Path) -> list[Path]:
    """Return every renderable `teach_dir/*.md` entry, sorted for deterministic ordering.

    Excludes `_REFERENCE_ONLY_FILENAMES` (implementation reference docs that are
    never themselves rendered).
    """
    return sorted(
        path
        for path in teach_dir.glob("*.md")
        if path.name not in _REFERENCE_ONLY_FILENAMES
    )


def build_all(teach_dir: Path, output_dir: Path) -> list[Path]:
    """Render every `teach_dir/*.md` entry and their combined link closure.

    Two runs against unchanged input produce byte-identical output: entries are
    processed in a fixed sorted order and each document's rendered content
    depends only on its own text and the (order-independent) map of resolved
    link/image targets. Returns the output paths written for the entries
    themselves, in the same sorted order.
    """
    entries = discover_teach_entries(teach_dir)
    if not entries:
        raise DocsBuildError(f"{teach_dir}: no renderable *.md files found")

    closure = _discover_closure(entries)
    output_paths = _render_closure(closure, output_dir)
    _remove_stale_html(output_dir, set(output_paths.values()))
    return [output_paths[entry] for entry in entries]


def _remove_stale_html(output_dir: Path, generated_paths: set[Path]) -> None:
    """Remove HTML outside the whole-directory closure without touching media."""
    for candidate in output_dir.glob("*.html"):
        if candidate in generated_paths:
            continue
        try:
            candidate.unlink()
        except OSError as exc:
            raise DocsBuildError(f"could not remove stale output {candidate} ({exc})") from exc


def _render_closure(closure: dict[Path, _Document], output_dir: Path) -> dict[Path, Path]:
    """Write every document in `closure` as self-contained HTML under `output_dir`.

    Returns the map of source path to written output path.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_paths = _assign_output_paths(closure, output_dir)

    for doc_path, document in closure.items():
        fallback_title = _title_from_filename(doc_path.stem)
        video_src = _declared_video_src(doc_path)

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

    return output_paths


def _declared_video_src(doc_path: Path) -> str | None:
    """Return the expected sibling MP4 when an authored project declares it."""
    project_manifest = doc_path.parent / "videos" / doc_path.stem / "hyperframes.json"
    return f"{doc_path.stem}.mp4" if project_manifest.is_file() else None


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


def _discover_closure(entries: list[Path]) -> dict[Path, _Document]:
    """Walk the local-`.md`-link graph reachable from `entries`.

    Returns a map of every reachable document (including every entry) to its
    parsed text and its own `{raw_href: resolved_target_path}` links and image
    references, in the order first discovered. Raises ``DocsBuildError`` for a
    link or image reference that doesn't resolve to a real file, naming both
    the referencing document and the missing reference.
    """
    closure: dict[Path, _Document] = {}
    queue = list(entries)
    queued = set(entries)

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
    if len(argv) > 1:
        sys.stderr.write("Usage: docs-build:doc [file.md]\n")
        return 2

    try:
        if argv:
            output_paths = [build_doc(Path(argv[0]), DEFAULT_OUTPUT_DIR)]
        else:
            output_paths = build_all(TEACH_DIR, DEFAULT_OUTPUT_DIR)
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:doc failed: {exc}\n")
        return 1

    for output_path in output_paths:
        sys.stdout.write(f"Wrote {output_path}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
