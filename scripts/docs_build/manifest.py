"""Declared source/output contract for committed teach-document HTML."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

MANAGED_OUTPUT_MANIFEST_PATH = Path(__file__).with_name("managed_outputs.json")


@dataclass(frozen=True)
class ManagedOutput:
    source: Path
    output: Path
    baseline_sha256: str


@dataclass(frozen=True)
class StaleOutput:
    output: Path
    baseline_sha256: str


@dataclass(frozen=True)
class ManagedOutputManifest:
    baseline_commit: str
    outputs: tuple[ManagedOutput, ...]
    stale_outputs: tuple[StaleOutput, ...]


def load_managed_output_manifest(
    manifest_path: Path = MANAGED_OUTPUT_MANIFEST_PATH,
) -> ManagedOutputManifest:
    """Load the frozen source/output contract used by docs-build parity checks."""
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return ManagedOutputManifest(
        baseline_commit=data["baseline_commit"],
        outputs=tuple(
            ManagedOutput(
                source=Path(entry["source"]),
                output=Path(entry["output"]),
                baseline_sha256=entry["baseline_sha256"],
            )
            for entry in data["outputs"]
        ),
        stale_outputs=tuple(
            StaleOutput(
                output=Path(entry["output"]),
                baseline_sha256=entry["baseline_sha256"],
            )
            for entry in data["stale_outputs"]
        ),
    )
