"""CLI wrapper for `docs-build:check-staleness`: flag Trial Onboarding Guide screenshots that
have drifted from the code they depict.

Invoked as `./scripts/dev.ps1 docs-build:check-staleness` / `bash scripts/dev.sh
docs-build:check-staleness`. Compares the git SHA `docs-build:capture` tagged its screenshots
with (`docs/teach-hosting/images/capture-manifest.json`, written by
`scripts/docs_build/capture/capture.mjs`) against the current git SHA of the most recent commit
touching `custom_addons/hosting` or `custom_addons/hosting_admin` — the same ADR-0024-style
versioning vocabulary reused, per docs/adr/0025, to detect when *documentation* has drifted from
*code* rather than to audit what a specific Trial Org ran.

Runs on the host (needs `git`), same as `docs-build:video`/`docs-build:capture`. Doesn't run in
CI — like the capture step itself, staleness only means anything relative to a capture that was
itself taken against the live local dev stack; this is a manual/local check, not a build gate.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

MANIFEST_PATH = Path("docs/teach-hosting/images/capture-manifest.json")
# Excludes static/docs/ (this pipeline's own build output) from both addon paths: without
# that exclusion, every docs-build:doc/docs-build:video run that touches its own output
# would itself count as the "most recent" addon change, making a just-recaptured screenshot
# report stale immediately - see issue #122 code review.
_TRACKED_ADDONS = ("custom_addons/hosting", "custom_addons/hosting_admin")
_TRACKED_PATHS = (
    "custom_addons/hosting",
    ":(exclude)custom_addons/hosting/static/docs",
    "custom_addons/hosting_admin",
    ":(exclude)custom_addons/hosting_admin/static/docs",
)

CommandRunner = Callable[[list[str]], "subprocess.CompletedProcess[str]"]


class DocsBuildError(Exception):
    """Raised for any docs-build:check-staleness failure that should stop the CLI with a clear message."""


def current_addons_git_sha(*, runner: CommandRunner | None = None) -> str:
    """Return the git SHA of the most recent commit touching either tracked addon path."""
    run = runner or _default_runner
    result = run(["git", "log", "-1", "--format=%H", "--", *_TRACKED_PATHS])
    if result.returncode != 0:
        raise DocsBuildError(f"git log failed (exit {result.returncode}):\n{result.stderr}")
    sha = result.stdout.strip()
    if not sha:
        raise DocsBuildError(f"git log found no commits touching {' or '.join(_TRACKED_ADDONS)}")
    return sha


def check_staleness(
    manifest_path: Path = MANIFEST_PATH, *, runner: CommandRunner | None = None,
) -> bool:
    """Return True when the captured screenshots are stale relative to the addons' current SHA.

    Raises DocsBuildError if `manifest_path` doesn't exist or is unreadable — recapture is the
    fix, not a stale-until-proven-fresh assumption.
    """
    if not manifest_path.is_file():
        raise DocsBuildError(
            f"{manifest_path}: not found — run docs-build:capture at least once first",
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DocsBuildError(f"{manifest_path}: could not read capture manifest ({exc})") from exc

    captured_sha = manifest.get("addonsGitSha")
    if not captured_sha:
        raise DocsBuildError(f"{manifest_path}: missing 'addonsGitSha' field")

    return captured_sha != current_addons_git_sha(runner=runner)


def _default_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def main(argv: list[str]) -> int:
    if argv:
        sys.stderr.write("Usage: docs-build:check-staleness\n")
        return 2

    try:
        is_stale = check_staleness()
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:check-staleness failed: {exc}\n")
        return 1

    if is_stale:
        sys.stdout.write(
            f"{MANIFEST_PATH}: screenshots are stale — custom_addons/hosting or "
            "custom_addons/hosting_admin changed since the last docs-build:capture. "
            "Recapture before shipping this doc.\n",
        )
        return 1

    sys.stdout.write(f"{MANIFEST_PATH}: screenshots are current.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
