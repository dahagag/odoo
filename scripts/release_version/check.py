"""Assert every owned addon's `__manifest__.py` version agrees with what
`derive.derive_manifest_version` computes from the repo's current release tag.

Per docs/adr/0004 (amended by issue #193, this check added in #214), a hand-edited manifest
version must fail review rather than silently drift from the release tag. Invoked as
`python3 -m scripts.release_version.check <tag>`, this scans every owned addon —
`custom_addons/*/__manifest__.py` — derives the expected version from `<tag>`, and reports every
addon whose manifest disagrees.

Resolving "the current release tag" is the caller's job (CI fetches the `v*` tag refs and
picks the latest by version sort before invoking this — not `git describe`, which would need
this repo's full commit history just to walk the ancestry graph); this module only compares a
tag already in hand against the manifests on disk.
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.release_version.derive import ReleaseVersionError, derive_manifest_version

DEFAULT_ADDONS_ROOT = Path(__file__).resolve().parents[2] / "custom_addons"


@dataclass(frozen=True)
class ManifestVersionMismatch:
    """One owned addon whose manifest version disagrees with the derived version."""

    module: str
    actual_version: str
    expected_version: str


def find_owned_manifests(addons_root: Path) -> list[Path]:
    """Return every owned addon's `__manifest__.py` under `addons_root`, sorted by module name."""
    return sorted(addons_root.glob("*/__manifest__.py"))


def read_manifest_version(manifest_path: Path) -> str:
    """Return the `version` field of an addon manifest.

    Parses with `ast.literal_eval` rather than executing the file — a manifest is data, and a
    malicious PR's manifest must not be able to run code during this check.
    """
    manifest = ast.literal_eval(manifest_path.read_text(encoding="utf-8"))
    return manifest["version"]


def check_manifest_versions(
    expected_version: str,
    manifest_paths: list[Path],
) -> list[ManifestVersionMismatch]:
    """Return one `ManifestVersionMismatch` per manifest whose version isn't `expected_version`."""
    mismatches = []
    for manifest_path in manifest_paths:
        actual_version = read_manifest_version(manifest_path)
        if actual_version != expected_version:
            mismatches.append(
                ManifestVersionMismatch(
                    module=manifest_path.parent.name,
                    actual_version=actual_version,
                    expected_version=expected_version,
                ),
            )
    return mismatches


def main(argv: list[str], addons_root: Path = DEFAULT_ADDONS_ROOT) -> int:
    if len(argv) != 1:
        sys.stderr.write("Usage: python3 -m scripts.release_version.check <release-tag>\n")
        return 2

    tag = argv[0]
    try:
        expected_version = derive_manifest_version(tag)
    except ReleaseVersionError as exc:
        sys.stderr.write(f"release-version failed: {exc}\n")
        return 1

    manifest_paths = find_owned_manifests(addons_root)
    mismatches = check_manifest_versions(expected_version, manifest_paths)

    if mismatches:
        sys.stderr.write(
            f"{len(mismatches)} owned addon manifest(s) disagree with {expected_version} "
            f"(derived from {tag!r}):\n",
        )
        for mismatch in mismatches:
            sys.stderr.write(
                f"  - {mismatch.module}: manifest has {mismatch.actual_version!r}, "
                f"expected {mismatch.expected_version!r}\n",
            )
        return 1

    sys.stdout.write(
        f"{len(manifest_paths)} owned addon manifest(s) match {expected_version} "
        f"(derived from {tag!r})\n",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
