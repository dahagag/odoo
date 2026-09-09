"""CLI wrapper around `scripts.release_version.derive`: print the manifest version derived
from a release tag.

Invoked as `python3 -m scripts.release_version.cli <tag>`. Prints the derived
`19.0.<major>.<minor>.<patch>` version alone on stdout with a trailing newline and nothing
else — a later CI check (issue #202) diffs this output against an addon's `__manifest__.py`
version and must not have to reparse surrounding text.
"""

from __future__ import annotations

import sys

from scripts.release_version.derive import ReleaseVersionError, derive_manifest_version


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("Usage: python3 -m scripts.release_version.cli <release-tag>\n")
        return 2

    try:
        manifest_version = derive_manifest_version(argv[0])
    except ReleaseVersionError as exc:
        sys.stderr.write(f"release-version failed: {exc}\n")
        return 1

    sys.stdout.write(f"{manifest_version}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
