"""Thin CLI wrapper around the pure Markdown transform for `docs-build:doc`.

Invoked as `./scripts/dev.ps1 docs-build:doc <file>` / `bash scripts/dev.sh
docs-build:doc <file>`. Reads one docs/teach/*.md file, renders it through
scripts.docs_build.markdown_transform, and writes the self-contained HTML
output under custom_addons/crm_methodology/static/docs/ (see docs/adr/0007 for
why that directory is the publishing path).
"""

from __future__ import annotations

import sys
from pathlib import Path

from scripts.docs_build.markdown_transform import (
    MarkdownSyntaxError,
    render_markdown_document,
)

DEFAULT_OUTPUT_DIR = Path("custom_addons/crm_methodology/static/docs")


class DocsBuildError(Exception):
    """Raised for any docs-build:doc failure that should stop the CLI with a clear message."""


def build_doc(source: Path, output_dir: Path) -> Path:
    """Render `source` and write it under `output_dir`. Returns the written path."""
    if source.suffix != ".md":
        raise DocsBuildError(f"{source}: only .md source files are supported")
    if not source.is_file():
        raise DocsBuildError(f"{source}: source file not found")

    fallback_title = _title_from_filename(source.stem)
    try:
        markdown_text = source.read_text(encoding="utf-8")
    except OSError as exc:
        raise DocsBuildError(f"{source}: could not read source file ({exc})") from exc

    try:
        rendered_html = render_markdown_document(markdown_text, fallback_title=fallback_title)
    except MarkdownSyntaxError as exc:
        raise DocsBuildError(f"{source}: {exc}") from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{source.stem}.html"
    output_path.write_text(rendered_html, encoding="utf-8")
    return output_path


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
