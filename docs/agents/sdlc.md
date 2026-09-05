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
release PR from `dev/19.0` with passing CI; no direct pushes. This repo has
no external contributors (see the top of this doc), so there's no separate
reviewer to require — the protection matches `dev/19.0`'s own (required
`CI required checks (required)` check, no reviewer count,
`enforce_admins: false` so the solo maintainer can merge once CI passes).
Promoting a change to the demo
instance means opening and merging a `dev/19.0` → `main/19.0` PR — that
merge *is* the deploy gate, since Render's own git integration handles the
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

The workflow itself triggers on every PR targeting either `dev/19.0`
(regular feature work) or `main/19.0` (release PRs promoting `dev/19.0` to
the demo instance) — no path filter at the trigger level. A preliminary
`changes` job diffs the PR against its base for `custom_addons/**`,
`docker/**`, `scripts/dev.sh`, `scripts/dev.ps1`, `scripts/docs_build/**`,
`requirements.txt`, `compose.yaml`, `infra/**`, `ruff.toml`, or the workflow
file itself, and the other jobs read its
`image_relevant`, `docs_build`, `infra_relevant`, and `lint_relevant`
outputs to decide whether to actually do anything. There is no separate
deploy workflow — Render's native branch auto-deploy handles promotion
once a release PR merges.

This replaced an earlier design where the whole workflow was gated by a
`paths:` filter on the trigger itself: docs-only PRs (regular feature PRs
into `dev/19.0`, not just rare release PRs) never got a `lint` run at all,
so they could never satisfy `dev/19.0`'s required status check and stayed
permanently `BLOCKED` short of an admin bypass (`enforce_admins` is off for
this repo, so the repo owner can merge past it, but that shouldn't be the
routine path for an ordinary docs PR). The `lint` job now always completes
— its steps are individually skipped when `changes.outputs.lint_relevant`
is `false`, so a docs-only PR gets a fast, real "success" for the required
check instead of no check at all.

| Job | Trigger scope | Gate |
|---|---|---|
| `changes` | every PR | Not a check anyone gates on — feeds `image_relevant`, `docs_build`, `infra_relevant`, and `lint_relevant` to the other jobs |
| `lint` | every PR; steps run only when `lint_relevant` (`custom_addons/**`, `ruff.toml`, `scripts/dev.sh`/`dev.ps1`, or the workflow file) | Feeds `ci-required`; not itself required by branch protection — `ruff` against `custom_addons/**`, Docker-free (`actions/setup-python`, no Odoo dev image; see [ADR 0028](../adr/0028-lint-job-decouples-from-odoo-dev-image.md)) |
| `docs-build-tests` | every PR; steps run only when `docs_build` | Feeds `ci-required`; not itself required by branch protection |
| `infra-checks` | every PR; steps run only when `infra_relevant` (`infra/**` or the workflow file) | Feeds `ci-required`; not itself required by branch protection — `tofu fmt`/`tofu validate` on all three OpenTofu modules, `ruff`, and `interrogate` docstring coverage, all Docker-free (`actions/setup-python`, no Odoo dev image) |
| `ci-required` | every PR; `if: always()` | **Required** status check — fails unless `lint`, `docs-build-tests`, and `infra-checks` all succeeded, even if one was `skipped` (e.g. because the upstream `changes` job errored) |
| `test` | every PR; whole job skipped when not `image_relevant` | Visible, **non-blocking** for now — the full `custom_addons/` suite via the `compose.yaml` stack; revisit once the suite has proven itself over time |

`lint` and `infra-checks` each gate on their own dedicated `*_relevant` filter rather than
`image_relevant`: neither `ruff` nor `tofu`/`interrogate` needs the Odoo dev image or a running
Compose stack (verified in [ADR 0027](../adr/0027-infra-ci-checks-ruff-and-interrogate.md) and
[ADR 0028](../adr/0028-lint-job-decouples-from-odoo-dev-image.md)), so neither job depends on
`build-image` — a `docker/**`-only or `requirements.txt`-only change reruns `test` without
rerunning either linter, and vice versa. Adding a further per-language/toolchain linter later
(e.g. `tsc` for TypeScript) follows the same shape: a new `<name>_relevant` filter scoped to that
toolchain's own paths plus the workflow file, a new Docker-free job (`actions/setup-python` or
whatever setup action the toolchain needs) whose steps are individually gated on that output, and
the job added to `ci-required`'s `needs` — never recoupled to `build-image` or to another
linter's job.

`ci-required` exists because GitHub branch protection treats a `skipped` required check the
same as a passing one for merge purposes. Without a trailing gate, a `changes` job failure would
let `lint`, `docs-build-tests`, and `infra-checks` turn `skipped` and still allow the PR to merge
with none of them having actually run.

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
