# SDLC / DX: branching, review, versioning, and CI

This repo is a private, single-deployment fork with one active development
line and no external contributors. This playbook deliberately does not
import Odoo core's stable/master branch split or OCA's module maturity
tiers (Beta/Stable/Mature) — both exist to manage trust across many
simultaneous versions or many third-party authors, neither of which applies
here. See [`docs/research/odoo-sdlc.md`](../research/odoo-sdlc.md) for the
upstream practices this was designed against, and
[`docs/adr/0004-oca-style-module-versioning.md`](../adr/0004-oca-style-module-versioning.md)
for the one decision here recorded as an ADR.

## Trunk

`dev/19.0` is the integration trunk: all feature/fix/chore work merges here
first, same as before. There is no separate `master`/stable split for
parallel Odoo versions — that's not what `main/19.0` is for.

`main/19.0` is the protected deploy branch Render watches for auto-deploy of
the client-demo instance (see
[ADR 0006](../adr/0006-render-hobby-cd-deployment.md)). It only moves via a
reviewed release PR from `dev/19.0`; no direct pushes. Promoting a change to
the demo instance means opening a `dev/19.0` → `main/19.0` PR — the PR
review *is* the deploy gate, since Render's own git integration handles the
rest with no separate approval step.

## Branch naming

Short-lived work branches: `<type>/<issue-number>-<slug>`, e.g.
`feat/142-service-dispatch`, `fix/150-stock-move-race`,
`migration/160-service-dispatch-v2`.

`<type>` is one of:

- `feat` — new behavior
- `fix` — bug fix
- `chore` — tooling, docs, non-behavioral cleanup
- `migration` — carries a module migration script or a major version bump (see [Module versioning](#module-versioning))

The issue number lets `docs/agents/issue-tracker.md`'s existing convention
("reference the issue in your branch name or commit messages") stay
satisfied automatically.

## Merge strategy

Squash-merge only into `dev/19.0`. One commit per PR keeps history linear
and bisectable, and removes the burden of hand-crafting clean intermediate
commits during iterative, agent-driven work.

## Module versioning

`custom_addons/` modules version `__manifest__.py` as
`{series}.{major}.{minor}.{patch}` (e.g. `19.0.1.0.0`):

- **major** — needs a migration script before `update <module>` is safe
- **minor** — needs a module upgrade (`update <module>`), no migration
- **patch** — hot-fixable, no upgrade required

See [ADR 0004](../adr/0004-oca-style-module-versioning.md) for why this
was adopted despite the module never being published to OCA.

## Review escalation

`docs/agents/odoo-19-development.md` already defines which changes require
designated-human review (ACLs, record rules, groups, privileges, public RPC
methods, `sudo()`; migrations, data deletion, accounting effects,
irreversible external calls; new external dependencies, install hooks,
scheduled actions; direct changes under `odoo/` or `addons/`). That list is
otherwise just prose — these two labels make it visible on the PR itself:

| Label | Applied when | Meaning |
|---|---|---|
| `needs-escalated-review` | PR touches any category above | Requires the designated human reviewer, not just a green CI check |
| `has-migration` | PR includes a migration script, or bumps a module's major version | Reviewer verifies the upgrade path before merge |

Whoever opens the PR (human or agent) applies these; the reviewer checks
for them before approving. They're independent of
[`docs/agents/triage-labels.md`](triage-labels.md)'s issue-intake labels,
which cover issue triage, not PR review.

## Continuous integration

Two GitHub Actions jobs, both scoped to PRs touching `custom_addons/**`,
`docker/**`, `requirements.txt`, or the workflow file itself — a docs-only
or research-only PR doesn't need to rebuild the Odoo image. The workflow
triggers on PRs targeting either `dev/19.0` (regular feature work) or
`main/19.0` (release PRs promoting `dev/19.0` to the demo instance), so
`main/19.0`'s branch protection has a real `lint` check to require. There is
no separate deploy workflow — Render's native branch auto-deploy handles
promotion once a release PR merges.

| Job | Trigger scope | Gate |
|---|---|---|
| `lint` | as above | **Required** status check — must pass, no override |
| `test` | as above | Visible, **non-blocking** for now — the full `custom_addons/` suite via the `compose.yaml` stack; revisit once the suite has proven itself over time |

Lint blocks because it's cheap and deterministic (`ruff`, no services
needed). Tests don't block yet because they're the newer, less-proven gate
here — running Postgres + a built Odoo image in CI for the first time
shouldn't also gate every merge on day one. Both run the same way a human
would locally (`scripts/dev.sh lint` / `scripts/dev.sh test`), so a
passing CI run and a passing local run mean the same thing.

## Pull requests

The PR template no longer references upstream `odoo/odoo`'s CLA/submit-pr
process (this fork doesn't go through it). It asks instead whether either
escalation label applies, so the reviewer sees that flag before opening the
diff.
