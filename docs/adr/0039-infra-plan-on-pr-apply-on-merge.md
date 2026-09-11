---
status: accepted
---

# Infra plan-on-PR, apply-on-merge for `infra/cicd` and `infra/registry`

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)), under
[#202](https://github.com/dahagag/odoo/issues/202) (AWS deploy pipeline via GitHub OIDC), decided
on [#215](https://github.com/dahagag/odoo/issues/215).

## Problem

`infra/README.md` documented a blanket rule: nothing in this repository runs `tofu apply`
automatically, and no CI workflow is authorized to apply any of it — every root module was a
manual, credentialed human/ops action. That rule predates #202's decision that infrastructure
should apply from CI with a plan gate ("plan on pull request, apply on merge"), and #212 already
introduced the two branch-scoped `staging_deploy`/`production_deploy` OIDC roles this ticket needed
in order to do that, with their real permissions left an explicit placeholder pending a later
ticket. This ticket is that later ticket, but only for two of the module's five root/reusable
modules.

## Decision

**`infra/cicd` and `infra/registry` plan on every pull request touching either and apply on a
merge to `dev/19.0`/`main/19.0`, using `staging_deploy`/`production_deploy`.** `infra/bootstrap`
and `infra/foundation` stay human/ops-applied, unchanged from the original rule.

Reasoning for the split:

- **`infra/foundation` is the shared AWS backbone** every Trial Org and the hosting product
  depend on: VPC, ECS cluster, Route53 zone, the Trial Org lifecycle state machine. An unreviewed
  `tofu apply` there on every merge risks the live infrastructure every Trial Org runs on, for a
  role whose actual permissions are still narrow and untested in practice. Automating it is
  deferred until the deploy roles have exercised real permissions on the lower-stakes modules
  first.
- **`infra/bootstrap` has no remote backend of its own** — it creates the S3 bucket + DynamoDB
  table every other root module's backend depends on. Applying it from CI is a chicken-and-egg
  problem independent of any risk judgment: nothing can assume a role to write to a backend that
  doesn't exist yet.
- **`infra/cicd` and `infra/registry` are comparatively low-stakes and already CI-native**: OIDC
  roles/policies and container repositories, not live compute, networking, or DNS a customer-facing
  Trial Org depends on at request time. They are also the two modules whose own resources this
  wiring itself needs (the deploy roles, the registries CI already pushes to), so extending their
  permissions to include themselves is the natural next step rather than inventing new identities
  for a third concern.

## Plan-time credentials: a new read-only role, not the deploy roles

A meaningful "plan" needs to read real remote state (otherwise it shows "create everything," never
a genuine diff — #215's acceptance criterion is specifically about catching a *destructive* plan
at review time). But `staging_deploy`/`production_deploy`'s trust policies are deliberately scoped
to a `push` event's `ref:refs/heads/<branch>` `sub` claim (#212) — a `pull_request` run's OIDC
token never carries that claim, so neither role can ever be assumed at PR time, by design.

Reusing `ecr_push`'s already-established `job_workflow_ref`-based trust pattern (the one condition
a `pull_request` token exposes that AWS's IAM validation accepts for a GitHub OIDC principal) to
make a *branch-scoped* PR-time variant of each deploy role does not work: `job_workflow_ref` carries
no branch information at all — only the workflow file and the PR-merge ref. A trust condition built
from it cannot distinguish "a PR targeting `dev/19.0`" from "a PR targeting `main/19.0`," so a
"PR-time staging_deploy" and "PR-time production_deploy" split by branch would be a false isolation
guarantee: either would actually be assumable from any PR regardless of its base branch.

**Decision: a fourth role, `infra_plan`, read-only, shared across both branches' PRs.** Sharing it
is the honest scoping given the above (read access carries no isolation risk to share), and it
keeps `apply`'s real branch isolation entirely inside `staging_deploy`/`production_deploy`'s
existing push-time trust conditions, untouched. `infra_plan`'s `tofu plan` runs with `-lock=false`
(no DynamoDB write grant) — a small, accepted race window against a concurrent real apply, for a
plan whose only purpose is a human-reviewable diff, never a state mutation.

## Permission scope granted

Both `staging_deploy`/`production_deploy` (apply, read-write) and the new `infra_plan` (plan,
read-only) are scoped to exactly the resource shapes `infra/cicd` and `infra/registry` create — no
`iam:*`/`ecr:*`/`s3:*` wildcard:

- The OpenTofu S3-backend state objects these two modules own (`cicd/terraform.tfstate`,
  `registry/terraform.tfstate`) and the DynamoDB lock table (apply roles only — plan skips locking
  entirely, see above).
- IAM actions against this account's GitHub Actions OIDC provider and the `github-actions-*` role
  name pattern (the OIDC provider plus these four roles themselves).
- ECR actions against the four ADR-0038 repository ARNs `infra/registry` manages.

`staging_deploy`/`production_deploy`'s app-deploy permissions (#216/#217's concern) remain the
placeholder `sts:GetCallerIdentity`-only statement #212 left them with — this ticket only adds the
infra-management statements above alongside it.

### Accepted tradeoff: self-management

Granting `staging_deploy`/`production_deploy` `iam:PutRolePolicy`/`iam:UpdateAssumeRolePolicy`
against the `github-actions-*` pattern means each role can modify its own (and each other's) trust
policy and inline policy via a `tofu apply` from its own branch. This is not a new escalation path:
anyone who can merge to `staging_branch`/`production_branch` can already edit `oidc.tf` directly and
have this same effect on the next apply — merge access to a protected branch already implies
"whatever CI's identity can do." But it does mean a compromised branch merge's blast radius now
extends to these IAM resources directly at apply time, not just to whatever the role's policy said
at merge time. Accepted for the same reason the two-separate-roles design was accepted in #212: the
alternative (a third, narrower, non-self-managing identity dedicated only to applying `infra/cicd`)
adds a role this repo would then need to bootstrap and maintain for marginal isolation benefit,
given branch-merge access is already the real trust boundary.

## CI wiring

`.github/workflows/ci.yml` gains a `push` trigger on `dev/19.0`/`main/19.0` (previously
`pull_request`-only) so the existing `infra-checks` job — the ticket's required gate — runs on the
same commit as the new `infra-apply` job and can be referenced via a same-workflow `needs:`, rather
than reconstructing that gate in a second workflow file. The pre-existing PR-only jobs
(`build-image`, `test`, ...) already guard on `github.event.pull_request...`, which safely resolves
to skipped (not erroring) on a push event.

Two new jobs: `infra-plan` (pull_request, `infra_plan` role, posts `tofu show` output to the job
summary for review) and `infra-apply` (push, `staging_deploy`/`production_deploy` selected by
`github.ref_name`, `tofu apply -auto-approve` with no `continue-on-error`/`|| true`/`if: always()`
masking — a failure fails the workflow, satisfying the "fail loudly" acceptance criterion).
