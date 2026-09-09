"""Derive an owned addon's `19.0.<major>.<minor>.<patch>` manifest version from the repo's
one repo-wide release tag.

Per docs/adr/0004 (amended by issue #193, implemented in #202), an owned addon's manifest
version is no longer hand-maintained: its last three components are the release tag's
`major.minor.patch`, and the series stays pinned to `19.0` — the Odoo version this fork
tracks — because Odoo reads the manifest version to decide whether to run a module's
migration scripts, and a free-floating number would break that detection.

A release tag is exactly `v<major>.<minor>.<patch>` (e.g. `v1.2.3`): no pre-release suffix
(`-rc.1`, `-beta`) and no build metadata (`+build.5`), since neither identifies a cut release
this repo can derive a manifest version from, and a leading `v` is required so a tag reads
unambiguously as a release rather than an arbitrary branch or commit label. This is
deliberately narrower than full SemVer 2.0.0 — the repo mints its own tags, so there is no
outside producer to accommodate.

This module raises for a malformed or pre-release tag rather than guessing, per the parent
ticket's design intent: a plausible-looking wrong version is worse than a loud failure.
"""

from __future__ import annotations

import re

MANIFEST_SERIES = "19.0"

# Anchored, exactly three dot-separated non-negative integer components with no leading
# zeros (`01` is ambiguous between octal-looking and decimal intent, and SemVer itself
# forbids it) — optionally followed by a `-` pre-release or `+` build-metadata suffix, which
# `derive_manifest_version` rejects explicitly below rather than silently discarding.
_TAG_PATTERN = re.compile(
    r"""
    ^v
    (?P<major>0|[1-9]\d*)\.
    (?P<minor>0|[1-9]\d*)\.
    (?P<patch>0|[1-9]\d*)
    (?P<suffix>[-+].*)?
    $
    """,
    re.VERBOSE,
)


class ReleaseVersionError(Exception):
    """Raised for a release tag that cannot be mechanically derived into a manifest version."""


def derive_manifest_version(tag: str) -> str:
    """Return the `19.0.<major>.<minor>.<patch>` manifest version derived from `tag`.

    Raises `ReleaseVersionError` for a tag that isn't exactly `v<major>.<minor>.<patch>` —
    including a pre-release or build-metadata suffix, which gets its own error message since
    it's a recognizable-but-unsupported shape rather than outright garbage.
    """
    match = _TAG_PATTERN.match(tag)
    if match is None:
        raise ReleaseVersionError(
            f"{tag!r} is not a well-formed release tag; expected "
            "v<major>.<minor>.<patch> (e.g. v1.2.3)",
        )

    if match.group("suffix"):
        raise ReleaseVersionError(
            f"{tag!r} is a pre-release or build-metadata tag ({match.group('suffix')!r}); "
            "only a cut release (v<major>.<minor>.<patch>, no suffix) has a manifest version",
        )

    major, minor, patch = match.group("major"), match.group("minor"), match.group("patch")
    return f"{MANIFEST_SERIES}.{major}.{minor}.{patch}"
