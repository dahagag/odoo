"""CLI wrapper for `docs-build:video`: mechanically re-render an already-authored
HyperFrames project to a fresh MP4.

Invoked as `./scripts/dev.ps1 docs-build:video <project-dir>` / `bash
scripts/dev.sh docs-build:video <project-dir>`. Unlike `docs-build:doc` (see
`scripts.docs_build.cli`), this runs directly on the host, not inside the Odoo
container: re-rendering shells out to the HyperFrames CLI (`npx hyperframes
render`), which needs the local `ffmpeg`/`ffprobe`/Chrome-Headless-Shell
toolchain installed and validated in issue #36 — none of that is part of the
Odoo dev image. See docs/adr/0008 for the authoring/re-rendering split this
subcommand is one half of: `<project-dir>` must already be an authored
HyperFrames project (storyboard, script, narration, composition all already
committed) — this never runs authoring, only `hyperframes render`.

The rendered MP4 is written directly to `<output-dir>/<project-dir name>.mp4`
— the project directory's own basename becomes the output stem, and that stem
is expected to match the teach doc's filename stem so `docs-build:doc`'s
sibling-video lookup (see `scripts.docs_build.cli`) finds it. For example, a
project authored at `docs/teach/videos/methodologies/` renders to
`custom_addons/crm_methodology/static/docs/methodologies.mp4`, sitting next to
`methodologies.html`.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

DEFAULT_OUTPUT_DIR = Path("custom_addons/crm_methodology/static/docs")

CommandRunner = Callable[[list[str]], "subprocess.CompletedProcess[str]"]


class DocsBuildError(Exception):
    """Raised for any docs-build:video failure that should stop the CLI with a clear message."""


def render_video(project_dir: Path, output_dir: Path, *, runner: CommandRunner | None = None) -> Path:
    """Re-render the already-authored HyperFrames project at `project_dir`.

    Returns the path written under `output_dir`, named `<project_dir.name>.mp4`.
    Never authors or edits the project — only runs `hyperframes render` against
    what's already there.
    """
    if not project_dir.is_dir():
        raise DocsBuildError(f"{project_dir}: project directory not found")
    if not (project_dir / "hyperframes.json").is_file():
        raise DocsBuildError(
            f"{project_dir}: not an authored HyperFrames project (no hyperframes.json)",
        )

    npx_path = shutil.which("npx")
    if npx_path is None:
        message = (
            "npx not found on PATH: install Node.js and the local HyperFrames "
            "toolchain (ffmpeg, ffprobe, Chrome Headless Shell — see issue #36) "
            "before running docs-build:video"
        )
        raise DocsBuildError(message)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{project_dir.name}.mp4"

    command = [
        npx_path,
        "hyperframes",
        "render",
        str(project_dir),
        "--output",
        str(output_path),
        "--quality",
        "high",
    ]

    run = runner or _default_runner
    result = run(command)
    if result.returncode != 0:
        raise DocsBuildError(
            f"{project_dir}: hyperframes render failed (exit {result.returncode}):\n{result.stderr}",
        )

    if not output_path.is_file():
        raise DocsBuildError(
            f"{project_dir}: hyperframes render reported success but {output_path} was not written",
        )

    return output_path


def _default_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("Usage: docs-build:video <hyperframes-project-dir>\n")
        return 2

    project_dir = Path(argv[0])
    try:
        output_path = render_video(project_dir, DEFAULT_OUTPUT_DIR)
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:video failed: {exc}\n")
        return 1

    sys.stdout.write(f"Wrote {output_path}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
