# OCA-style module versioning

Owned modules under `custom_addons/` version `__manifest__.py` as
`{series}.{major}.{minor}.{patch}` (e.g. `19.0.1.0.0`), following the OCA
convention rather than plain semver: **major** bumps mark a change that
needs a migration script, **minor** bumps mark a change that needs a module
upgrade but no migration, and **patch** bumps are hot-fixable without either.
This repo is a private, single-deployment fork with no OCA publication
intent (see [`docs/agents/sdlc.md`](../agents/sdlc.md)), so the scheme is
adopted only for its migration-risk signal to whoever runs
`scripts/dev.ps1 update <module>` — not for OCA's original purpose of
signaling cross-deployment compatibility.
