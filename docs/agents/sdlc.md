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

`main/19.0` is the protected production deploy branch. It only moves via a
release PR from `dev/19.0` with passing CI; no direct pushes. This repo has
no external contributors (see the top of this doc), so there's no separate
reviewer to require — the protection matches `dev/19.0`'s own (required
`CI required checks (required)` check, no reviewer count,
`enforce_admins: false` so the solo maintainer can merge once CI passes).
Promoting a release means opening and merging a `dev/19.0` → `main/19.0`
PR — that merge *is* the deploy gate: `ci.yml`'s
`deploy-administration-stack-production` job (see
[`docs/release-process.md`](../release-process.md)) runs automatically on
the resulting push, no separate approval step. This replaced Render's
git-integration auto-deploy (former [ADR 0006](../adr/0006-render-hobby-cd-deployment.md),
now superseded by [ADR 0015](../adr/0015-production-migrates-to-aws-platform-account.md))
once production moved onto the AWS Platform Account.

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
the demo instance) — no path filter at the trigger level. Since issue #215
it also triggers on a **push** to either branch (i.e. a PR merge), so that
`infra-apply` (below) can gate on the same commit's `infra-checks` result
via a same-workflow `needs:`, rather than reconstructing that gate in a
second workflow file — the pre-existing PR-only jobs guard on
`github.event.pull_request...`, which is simply absent on a push event, so
they resolve to `skipped` rather than erroring. A preliminary `changes` job
diffs the run against its base (the PR's base branch, or the pre-push SHA
on a push) for `custom_addons/**`, `docker/**`, `scripts/dev.sh`,
`scripts/dev.ps1`, `scripts/docs_build/**`, `requirements.txt`,
`compose.yaml`, `infra/**`, `ruff.toml`, `odoo-bin`, `odoo/**`,
`addons/**`, or the workflow file itself, and the other jobs read its
`image_relevant`, `prod_image_relevant`, `docs_build`, `infra_relevant`,
and `lint_relevant` outputs to decide whether to actually do anything.
`infra/cicd` and `infra/registry` are planned on PR and applied on merge
(issue #215) — see `infra/README.md`'s "`tofu apply` is a deliberate
human/ops action" section and
[ADR-0039](../adr/0039-infra-plan-on-pr-apply-on-merge.md) for what that
does and does not cover. The administration-stack API (issue #216/#217)
follows the same plan-on-PR/apply-on-merge shape one level further: a merge
to `dev/19.0` deploys it to staging, a merge to `main/19.0` deploys the
same instance to production, both gated by a release-order guard (issue
#218) that skips a delayed, out-of-order run rather than let it overwrite a
release tag a faster run already published. See
[`docs/release-process.md`](../release-process.md) for cutting a release,
staging proof, production promotion, rollback, and that guard's full
mechanics — this doc only tracks which CI jobs exist and what gates them.

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
| `changes` | every PR | Not a check anyone gates on — feeds `image_relevant`, `prod_image_relevant`, `docs_build`, `infra_relevant`, and `lint_relevant` to the other jobs |
| `lint` | every PR; steps run only when `lint_relevant` (`custom_addons/**`, `ruff.toml`, `scripts/dev.sh`/`dev.ps1`, or the workflow file) | Feeds `ci-required`; not itself required by branch protection — `ruff` against `custom_addons/**`, Docker-free (`actions/setup-python`, no Odoo dev image; see [ADR 0028](../adr/0028-lint-job-decouples-from-odoo-dev-image.md)) |
| `build-prod-image` | every PR; whole job skipped when not `prod_image_relevant` (`.env.example`, `odoo-bin`, `odoo/**`, `addons/**`, `custom_addons/**`, `docker/odoo-prod.Dockerfile`, `docker/odoo-prod.conf`, `docker/pip-install-requirements.sh`, `requirements.txt`, the workflow file, or `.github/actions/**`) | Not itself required by branch protection — builds `docker/odoo-prod.Dockerfile` (separate from the dev and retired Render Dockerfiles per [ADR 0003](../adr/0003-standardize-local-development-on-containers.md)) and publishes it to GHCR tagged by a hash of its content inputs, skipping the push if that tag is already published (mirrors `build-image`'s own dedup); one of two jobs here holding `packages: write` (alongside `build-image`), and it holds nothing else beyond `contents: read` |
| `docs-build-tests` | every PR; steps run only when `docs_build` | Feeds `ci-required`; not itself required by branch protection |
| `infra-checks` | every PR; steps run only when `infra_relevant` (`infra/**` or the workflow file) | Feeds `ci-required`; not itself required by branch protection — `tofu fmt`/`tofu validate`/`tofu test` on every OpenTofu root/reusable module, `ruff`, and `interrogate` docstring coverage, all Docker-free (`actions/setup-python`, no Odoo dev image) |
| `stack-checks` | every PR; steps run only when `stack_relevant` (`stack/**` or the workflow file) | Feeds `ci-required`; not itself required by branch protection — typecheck/test/OpenAPI-drift/OpenAPI-breaking-change for the administration-stack API |
| `release-version-tests`, `manifest-version-check` | every PR; steps run only when their own `*_relevant` filter | Feed `ci-required`; not themselves required by branch protection — the release-tag derivation's own unit tests, and that every owned addon's manifest version agrees with the current release tag (issue #214, see [`docs/release-process.md`](../release-process.md)) |
| `ci-required` | every PR; `if: always()` | **Required** status check — fails unless `lint`, `docs-build-tests`, `infra-checks`, `stack-checks`, `release-version-tests`, and `manifest-version-check` all succeeded, even if one was `skipped` (e.g. because the upstream `changes` job errored) |
| `test` | every PR; whole job skipped when not `image_relevant` | Visible, **non-blocking** for now — the full `custom_addons/` suite via the `compose.yaml` stack; revisit once the suite has proven itself over time |
| `infra-plan-platform` | every PR; whole job skipped when not `infra_platform_relevant` (`infra/platform/**` or the workflow file) | Not itself required — previews the `tofu plan` a merge would apply to the shared administration-stack instance |
| `deploy-administration-stack-staging` | push to `dev/19.0` only, gated on `infra-checks` succeeding | Resolves the current release tag, retags the PR-built image with it, applies `infra/platform`, records the deployed commit — skipped (not failed) if the release-order guard (issue #218) finds this run stale. See [`docs/release-process.md`](../release-process.md) |
| `deploy-administration-stack-production` | push to `main/19.0` only, gated on `infra-checks` succeeding | Same shape as staging above, against the same `infra/platform` instance, using the `production_deploy` OIDC role |

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
