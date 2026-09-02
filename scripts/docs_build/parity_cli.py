"""Verify that the production docs renderer reproduces committed managed HTML.

This is the single parity command used by local development wrappers and CI.
It deliberately renders into a fresh temporary directory: the comparison never
depends on files left by an earlier local build, and it never writes to the
committed publishing directory.
"""

from __future__ import annotations

import hashlib
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from scripts.docs_build.cli import DocsBuildError, build_all
from scripts.docs_build.manifest import (
    MANAGED_OUTPUT_MANIFEST_PATH,
    ManagedOutputManifest,
    load_managed_output_manifest,
)

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ParityDiagnostics:
    """All discrepancies found during one managed-output parity evaluation."""

    missing: tuple[str, ...]
    unexpected_committed: tuple[str, ...]
    unexpected_generated: tuple[str, ...]
    changed: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not (
            self.missing
            or self.unexpected_committed
            or self.unexpected_generated
            or self.changed
        )


def evaluate_managed_output_parity(
    repo_root: Path,
    manifest_path: Path,
) -> ParityDiagnostics:
    """Build docs into a temporary directory and compare all managed HTML bytes."""
    manifest = load_managed_output_manifest(manifest_path)
    output_dir = _managed_output_directory(repo_root, manifest)
    expected_names = {entry.output.name for entry in manifest.outputs}
    committed_paths = {path.name: path for path in output_dir.glob("*.html")}
    missing = [
        f"committed: {entry.output.name}"
        for entry in manifest.outputs
        if entry.output.name not in committed_paths
    ]
    unexpected_committed = sorted(set(committed_paths) - expected_names)
    changed = _committed_hash_drift(manifest, committed_paths)

    with tempfile.TemporaryDirectory(prefix="docs-build-parity-") as temp_name:
        generated_dir = Path(temp_name)
        build_all(repo_root / "docs" / "teach", generated_dir)
        generated_paths = {path.name: path for path in generated_dir.glob("*.html")}
        missing.extend(
            f"generated: {entry.output.name}"
            for entry in manifest.outputs
            if entry.output.name not in generated_paths
        )
        unexpected_generated = sorted(set(generated_paths) - expected_names)
        changed.extend(
            _generated_byte_drift(manifest, committed_paths, generated_paths),
        )

    return ParityDiagnostics(
        missing=tuple(sorted(missing)),
        unexpected_committed=tuple(unexpected_committed),
        unexpected_generated=tuple(unexpected_generated),
        changed=tuple(sorted(changed)),
    )


def _managed_output_directory(repo_root: Path, manifest: ManagedOutputManifest) -> Path:
    """Return the one committed directory declared by the managed-output contract."""
    output_directories = {entry.output.parent for entry in manifest.outputs}
    if len(output_directories) != 1:
        message = "managed output manifest must declare exactly one output directory"
        raise DocsBuildError(message)
    return repo_root / output_directories.pop()


def _committed_hash_drift(
    manifest: ManagedOutputManifest,
    committed_paths: dict[str, Path],
) -> list[str]:
    changes = []
    for entry in manifest.outputs:
        committed_path = committed_paths.get(entry.output.name)
        if committed_path is None:
            continue
        committed_hash = _sha256(committed_path)
        if committed_hash != entry.baseline_sha256:
            changes.append(
                f"{entry.output.name}: committed sha256 {committed_hash} "
                f"does not match manifest {entry.baseline_sha256}",
            )
    return changes


def _generated_byte_drift(
    manifest: ManagedOutputManifest,
    committed_paths: dict[str, Path],
    generated_paths: dict[str, Path],
) -> list[str]:
    changes = []
    for entry in manifest.outputs:
        committed_path = committed_paths.get(entry.output.name)
        generated_path = generated_paths.get(entry.output.name)
        if committed_path is None or generated_path is None:
            continue
        committed_hash = _sha256(committed_path)
        generated_hash = _sha256(generated_path)
        if generated_hash != committed_hash:
            changes.append(
                f"{entry.output.name}: generated sha256 {generated_hash} "
                f"does not match committed {committed_hash}",
            )
    return changes


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_diagnostics(diagnostics: ParityDiagnostics) -> None:
    if diagnostics.missing:
        sys.stderr.write("Missing managed HTML outputs:\n")
        for item in diagnostics.missing:
            sys.stderr.write(f"  - {item}\n")
    if diagnostics.unexpected_committed:
        sys.stderr.write("Unexpected committed HTML outputs:\n")
        for name in diagnostics.unexpected_committed:
            sys.stderr.write(f"  - {name}\n")
    if diagnostics.unexpected_generated:
        sys.stderr.write("Unexpected generated HTML outputs:\n")
        for name in diagnostics.unexpected_generated:
            sys.stderr.write(f"  - {name}\n")
    if diagnostics.changed:
        sys.stderr.write("Changed HTML outputs:\n")
        for item in diagnostics.changed:
            sys.stderr.write(f"  - {item}\n")


def main(
    argv: list[str],
    *,
    repo_root: Path = _REPOSITORY_ROOT,
    manifest_path: Path = MANAGED_OUTPUT_MANIFEST_PATH,
) -> int:
    """Run the repository-level managed HTML parity command."""
    if argv:
        sys.stderr.write("Usage: docs-build:parity\n")
        return 2
    try:
        diagnostics = evaluate_managed_output_parity(repo_root, manifest_path)
    except DocsBuildError as exc:
        sys.stderr.write(f"docs-build:parity failed: {exc}\n")
        return 1
    if not diagnostics.passed:
        _write_diagnostics(diagnostics)
        return 1

    manifest = load_managed_output_manifest(manifest_path)
    sys.stdout.write(f"docs-build parity passed for {len(manifest.outputs)} managed HTML outputs\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
