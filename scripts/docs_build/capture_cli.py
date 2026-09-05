"""CLI wrapper for `docs-build:capture`: Puppeteer-screenshot the `hosting`/`hosting_admin` UI.

Invoked as `./scripts/dev.ps1 docs-build:capture` / `bash scripts/dev.sh docs-build:capture`.
Like `docs-build:video` (see `scripts.docs_build.video_cli`), this runs directly on the host,
not inside the Odoo container — it needs a real Chrome (Puppeteer's own bundled build), which
isn't part of the Odoo dev image, and it needs to reach the dev stack's HTTP port directly.

The actual capture logic lives in `scripts/docs_build/capture/capture.mjs` (a small Node
project with its own `package.json`, mirroring how each authored HyperFrames video project
carries its own `package.json` rather than adding a repo-root Node dependency). This wrapper
only checks the prerequisites (`node` on PATH, `npm install` already run in `capture/`) and
shells out to it, the same shape as `video_cli.render_video`'s relationship to `hyperframes
render`. See docs/adr/0025 and issue #122.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

CAPTURE_DIR = Path("scripts/docs_build/capture")

CommandRunner = Callable[[list[str], Path], "subprocess.CompletedProcess[str]"]


class DocsBuildError(Exception):
    """Raised for any docs-build:capture failure that should stop the CLI with a clear message."""


def run_capture(*, capture_dir: Path = CAPTURE_DIR, runner: CommandRunner | None = None) -> None:
    """Run the Puppeteer capture script at `capture_dir`.

    Never installs dependencies itself — `npm install` in `capture_dir` is a one-time,
    explicit prerequisite (see docs/agents/local-development.md), same convention as
    `docs-build:video` never installing the HyperFrames toolchain for you.
    """
    node_path = shutil.which("node")
    if node_path is None:
        message = "node not found on PATH: install Node.js before running docs-build:capture"
        raise DocsBuildError(message)

    if not (capture_dir / "node_modules").is_dir():
        message = (
            f"{capture_dir}/node_modules not found: run `npm install` in {capture_dir} once "
            "before docs-build:capture"
        )
        raise DocsBuildError(message)

    command = [node_path, "capture.mjs"]
    run = runner or _default_runner
    result = run(command, capture_dir)
    if result.returncode != 0:
        raise DocsBuildError(f"capture.mjs failed (exit {result.returncode}):\n{result.stderr}")
    sys.stdout.write(result.stdout)


def _default_runner(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)


def main(argv: list[str]) -> int:
    if argv:
        sys.stderr.write("Usage: docs-build:capture\n")
        return 2

    try:
        run_capture()
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:capture failed: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
