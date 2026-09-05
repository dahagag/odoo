"""Addon <-> teach-dir/output-dir mapping shared by `docs-build:doc` and `docs-build:video`.

Per docs/adr/0025, a new addon's teach-doc source lives at `docs/teach-<addon>/` and its
built output at `custom_addons/<addon>/static/docs/`. `crm_methodology` predates that
convention and keeps its original `docs/teach/` source dir unchanged rather than moving to
`docs/teach-crm_methodology/` — the whole point of generalizing was to leave its existing
build path and output alone. See issue #122.
"""

from __future__ import annotations

from pathlib import Path

DEFAULT_ADDON = "crm_methodology"
_DEFAULT_TEACH_DIR = Path("docs/teach")
_TEACH_DIR_PREFIX = "teach-"


def teach_dir_for_addon(addon: str) -> Path:
    """Return the teach-doc source directory for `addon`."""
    if addon == DEFAULT_ADDON:
        return _DEFAULT_TEACH_DIR
    return Path(f"docs/{_TEACH_DIR_PREFIX}{addon}")


def output_dir_for_addon(addon: str) -> Path:
    """Return the built-output directory for `addon`, served per docs/adr/0007."""
    return Path(f"custom_addons/{addon}/static/docs")


def addon_for_teach_path(path: Path) -> str:
    """Infer the owning addon from a source file or HyperFrames project-directory path.

    Looks for a `teach` or `teach-<addon>` path segment (source files and video
    project dirs both nest under one of those) and returns `crm_methodology` for
    the former, `<addon>` for the latter. Raises `ValueError` naming `path` when
    neither shape is found, for the caller to wrap in its own error type.
    """
    for part in path.parts:
        if part == "teach":
            return DEFAULT_ADDON
        if part.startswith(_TEACH_DIR_PREFIX):
            return part[len(_TEACH_DIR_PREFIX):]
    message = f"{path} is not under a docs/teach/ or docs/teach-<addon>/ directory"
    raise ValueError(message)
