---
status: amended by issue #193
---

# OCA-style module versioning

**Amended:** the repo now carries **one repo-wide release tag**, and an owned addon's manifest
version is **derived** from it as `19.0.<major>.<minor>.<patch>` rather than maintained
independently. Decided in the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)) and implemented in
[#202](https://github.com/dahagag/odoo/issues/202), so one number answers "what is deployed"
across addons, the administration stack, and infrastructure.

This amends the scheme rather than discarding it, and the `19.0.` prefix is not cosmetic:
**manifest versions cannot float free of `19.0.*`, because Odoo itself reads the manifest version
to decide whether to run a module's migration scripts.** A manifest version that is not an
Odoo-series-prefixed, monotonically comparable `{series}.{major}.{minor}.{patch}` breaks upgrade
detection outright — so the release tag supplies the last three components, and the series stays
pinned to the Odoo version the fork tracks.

What changes is where the three components come from: the release, not a per-module judgement
call. What stays is everything the scheme was adopted for below — the migration-risk signal that
a **major** bump means a migration script must run before `update <module>` is safe, a **minor**
bump means an upgrade but no migration, and a **patch** bump means neither. That signal now
applies repo-wide: cutting a major release asserts that some module in it needs a migration.
The branching and release mechanics in [`docs/agents/sdlc.md`](../agents/sdlc.md) still describe
the per-module scheme and Render-watched promotion; #202 updates them alongside the pipeline.

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
