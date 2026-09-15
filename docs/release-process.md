# Release process: cutting, staging proof, production promotion, rollback

This repo cuts **one repo-wide release tag** (`v<major>.<minor>.<patch>`) rather than versioning
each owned addon independently — see
[ADR-0004](adr/0004-oca-style-module-versioning.md) for why, and
[`scripts/release_version/derive.py`](../scripts/release_version/derive.py) for the mechanical
derivation of an addon's manifest version from that tag. This document covers the operational
side #202/#216/#217 built on top of that: cutting a release, proving it in staging, promoting it
to production, and rolling one back. It supersedes the old per-module/Render-watched description
that used to live in [`docs/agents/sdlc.md`](agents/sdlc.md#deployment) (see that file's
Deployment section for the current, short pointer back here).

## What "staging" and "production" mean today

`deploy-administration-stack-staging` (triggered by a push to `dev/19.0`) and
`deploy-administration-stack-production` (triggered by a push to `main/19.0`) both deploy the
**same** `infra/platform` ECS service in the Platform Account — there is only one running
instance of the administration-stack API today. This is deliberate: issue #202/#216 frame this
pipeline as its own end-to-end proof that the cut-release → deploy → rollback mechanics work,
not yet a production-shaped two-environment split. A future ticket that actually wants an
isolated production environment needs a second `infra/platform` instance (its own state key, its
own ECS cluster/service) — nothing here assumes one exists.

## Cutting a release

1. Decide the version bump from what changed since the last tag, per ADR-0004's semantics:
   - **major** — some owned addon needs a migration script before `update <module>` is safe
   - **minor** — some owned addon needs a module upgrade, no migration
   - **patch** — hot-fixable, no upgrade required
2. Tag the `dev/19.0` commit you want to release and push the tag:
   ```bash
   git tag v1.3.0 <commit-sha-on-dev/19.0>
   git push origin v1.3.0
   ```
   There is no automated tag-cutting workflow — this is a deliberate human action, matching
   `infra/README.md`'s "`tofu apply` is a deliberate human/ops action" stance on the rest of this
   pipeline's write-side operations.
3. If the release changes any owned addon's manifest version (a major/minor bump), update
   `__manifest__.py` for every owned addon under `custom_addons/` to match
   `scripts.release_version.cli`'s output for the new tag, in the same PR that lands before you
   tag — `manifest-version-check` (CI, every PR and push) fails a mismatch, and it reads whatever
   `v*` tag already exists, so the manifest change must land *before* or *in the same commit as*
   the tag it's meant to match.

## What's checked before anything deploys

Every PR into `dev/19.0` or `main/19.0`, and every push that follows a merge, runs the same
`ci-required` gate (`lint`, `docs-build-tests`, `infra-checks`, `stack-checks`,
`release-version-tests`, `manifest-version-check` — see
[`docs/agents/sdlc.md`](agents/sdlc.md#continuous-integration) for the full table). Two of these
are specific to a release:

- **`manifest-version-check`** resolves the latest `v*` tag and fails if any owned addon's
  manifest version disagrees with what `derive_manifest_version` computes from it.
- **`infra-checks`** runs `tofu fmt`/`validate`/`test` against `infra/platform` (among the other
  root modules) — including the release-order guard's own IAM scoping test (see below).

A merge whose own `infra-checks` run failed never reaches a real deploy: both
`deploy-administration-stack-staging` and `-production` depend on `infra-checks` succeeding
first, same as `infra-apply` does for `infra/cicd`/`infra/registry` (issue #215/#216/#217's
acceptance criteria — a failed step stops the workflow rather than leaving a partial deploy).

## How staging proves a release

A push to `dev/19.0` (i.e. a PR merge) runs `deploy-administration-stack-staging`:

1. `resolve-release-tag` resolves the latest `v*` tag by version sort.
2. `retag-administration-stack-image` adds that release tag onto the administration-stack-api
   image `build-stack-image` already pushed under its content-hash tag at PR time — no rebuild,
   so the image a deploy ships is always something a PR already tested.
3. `infra-tofu` applies `infra/platform` with that release tag as `administration_stack_image_tag`
   — the running task definition references the image by that tag.
4. A job summary line records the release now running, and points at the discoverability command:
   ```bash
   aws ecs describe-services --cluster platform --services platform-administration-stack-api --include TAGS
   ```

## How production is promoted

Merging `dev/19.0` → `main/19.0` (or any other PR that lands on `main/19.0`) runs
`deploy-administration-stack-production`, which mirrors the staging job step-for-step against the
same `infra/platform` instance (see "What staging and production mean today" above) — the only
difference is which branch-scoped OIDC role (`production_deploy` vs `staging_deploy`) the job
assumes. A release tag reaching production has therefore always already been proven once in
staging, since `dev/19.0` merges first.

## Rollback

Rolling back means redeploying an **older** release tag's already-published image over the
running ECS service. This is *not* something the ordinary push-triggered pipeline does on its
own — `resolve-release-tag` always resolves the **latest** `v*` tag by version sort, so pushing
an older tag, or re-running a workflow for an old commit, does not make an older release "current"
again from CI's point of view.

**There is no human-executable path to this, by design, and that's deliberate.** An early draft
of this document described "assume the AWS role chain yourself" — confirmed live to be wrong:
`platform-administration-stack-deploy`'s trust policy only trusts the `staging_deploy`/
`production_deploy` GitHub OIDC identities, not any human or org-admin credential:
```
$ aws sts assume-role --role-arn arn:aws:iam::<platform-account-id>:role/platform-administration-stack-deploy ...
AccessDenied: ... is not authorized to perform: sts:AssumeRole on resource: .../platform-administration-stack-deploy
```
Rollback therefore goes through CI, the same as an ordinary deploy — `ci.yml`'s
`workflow_dispatch` trigger (issue #218), which reuses the same branch-scoped OIDC roles rather
than widening any trust policy or bypassing Terraform:

1. Confirm the target release's image is still present under its release tag in ECR (it always
   is — `retag-administration-stack-image` never deletes a tag, it only adds new ones):
   ```bash
   aws ecr describe-images --registry-id <platform-account-id> \
     --repository-name agentic-erp/administration-stack-api --image-ids imageTag=v1.2.0
   ```
2. Dispatch the workflow against the target environment with that tag:
   ```bash
   gh workflow run ci.yml --ref dev/19.0 -f environment=staging -f release_tag=v1.2.0
   # or: -f environment=production (ref main/19.0) for a production rollback
   ```
   This runs `deploy-administration-stack-staging`/`-production` exactly as an ordinary push
   would, except it skips `resolve-release-tag` (uses the given tag directly),
   `check-release-order` (a deliberate rollback is expected to be "behind" by commit ancestry —
   the check would otherwise always flag it stale), and `retag-administration-stack-image` (the
   tag already exists and already points at the right manifest) — going straight to `tofu apply`
   with that tag, then `record-deployed-commit`.
3. **The rollback is a temporary mitigation, not a new steady state.** `record-deployed-commit`
   records the *dispatched ref's* commit (e.g. `dev/19.0`'s current tip), not the old release's
   original commit — so the very next ordinary push to that branch still resolves whatever the
   latest `v*` tag is and deploys it, regardless of the rollback. If the newer release is broken,
   fix forward (cut a new patch release) or keep the rollback in place by not merging anything
   further until that's done — the pipeline does not "stick" to a rolled-back release on its own.

**Caveat — migrations are not reversible by this pipeline.** If the release being rolled back
*past* included an Odoo migration script (a major manifest-version bump, per ADR-0004), rolling
back the application code does not undo whatever that migration already did to the database
schema or data. The older code is not guaranteed to run correctly against a database a newer
migration has already touched. A rollback across a migration boundary needs its own
data-compatible plan (a down-migration, a restore from snapshot, or a verified no-op) decided
case by case — this pipeline only ever rolls back *code*, never schema or data.

## Guarding against an out-of-order deploy (issue #218)

`deploy-administration-stack-staging` and `-production` both retag and apply the same
`infra/platform` instance from two different branches. Without a guard, a `dev/19.0` run for an
older commit — delayed behind slow prerequisite jobs — could reach its retag/apply step *after* a
`main/19.0` run for a newer commit already deployed, silently pointing the release tag back at
older image bytes (found during #217's review; see issue #218 for the full analysis).

Both jobs now call `.github/actions/check-release-order` before retagging/applying, and
`.github/actions/record-deployed-commit` right after a successful apply:

- **Where "currently deployed" lives**: one SSM parameter in the Platform Account,
  `/platform-administration-stack-api/deployed-commit` (created by
  `infra/platform`'s `aws_ssm_parameter.administration_stack_deployed_commit`, value managed by
  CI rather than Terraform). One parameter, not one per branch/environment, because staging and
  production deploy the same instance today (see above). Considered and rejected: an **ECS
  service tag** (this pipeline already tags the service/task definition with the release
  version, but not the commit — reusing that mechanism would conflate "which release" with "which
  commit", two different questions this guard needs answered separately) and a **DynamoDB item**
  (this repo already has a DynamoDB table for Tofu state locking and another for Trial Org
  lifecycle leases — a single scalar value has no need for a table's read/write-capacity and
  query surface, and SSM Parameter Store is already a dependency-free, IAM-scoped key/value store
  with no extra infrastructure to provision). A single SSM parameter answers exactly the one
  question this guard asks ("what commit is currently deployed") with the least new surface area.
  Its name is duplicated as a literal default across `infra/platform/variables.tf`,
  `infra/registry/variables.tf`, and both `.github/actions/check-release-order` and
  `.github/actions/record-deployed-commit`'s `ssm_parameter_name` input — kept in sync by
  convention, the same pattern this repo already uses for the ECS cluster/task-family/service
  names (see `infra/registry/locals.tf`'s
  `administration_stack_deployed_commit_parameter_arn` comment). A mismatch isn't silent: it fails
  loud as `ParameterNotFound` (or an `AccessDenied` from a name outside the IAM grant's scoped
  ARN) the moment `check-release-order` calls `aws ssm get-parameter`.
- **What counts as stale**: commit ancestry, not image digest. The guard compares this run's
  commit against the recorded one via the GitHub compare API (`.../compare/<recorded>...<this>`).
  `ahead` proceeds; `behind`, `identical` (already handled as a fast-path no-op before the API
  call even runs), or `diverged` is treated as stale and skips retag/apply for this run — the
  concurrency group already serializes the two jobs against each other (issue #217), so this
  check runs immediately before mutating anything shared. Ancestry rather than digest comparison
  matches how this repo already reasons about "current" everywhere else (`resolve-release-tag`
  itself is a version-sort, not a digest check), and needs no additional local git history beyond
  what the GitHub API already knows.
- **Same guard on both jobs**: yes — deliberately, since both retag+apply the one shared instance,
  the race issue #218 describes can originate from either branch.
- **A skip is not a failure**: a stale run's later steps (`retag-administration-stack-image`,
  `infra-tofu apply`, the "record deployed commit" step) are conditioned on
  `steps.guard.outputs.stale != 'true'` and simply don't run; the job still finishes green, with a
  step-summary line explaining why it skipped. This matches the "a failed step stops the
  workflow" framing from #216/#217's own acceptance criteria — a stale race outcome is expected,
  not a bug, so it should not read as a red X.
- A manual rollback (above), triggered via `workflow_dispatch`, intentionally skips
  `check-release-order` entirely rather than running it and overriding the result — the guard
  exists to catch an *accidental* race between two automatic pipeline runs, and a deliberate
  rollback is by definition deploying older content, which the ancestry check would otherwise
  always (correctly, for the automatic case) flag as stale.
