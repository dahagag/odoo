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
- IAM actions against this account's GitHub Actions OIDC provider (shared — both roles' applies
  must be able to refresh it), each deploy role's own literal role ARN (write), and the *other*
  deploy role's literal ARN (read-only, needed only because a `tofu apply` of this shared module
  refreshes both roles' state even when only one is being written to).
- ECR actions against the four ADR-0038 repository ARNs `infra/registry` manages.

`staging_deploy`/`production_deploy`'s app-deploy permissions (#216/#217's concern) remain the
placeholder `sts:GetCallerIdentity`-only statement #212 left them with — this ticket only adds the
infra-management statements above alongside it.

### Deliberately not self-managing: no cross-role IAM mutation

An earlier version of this design granted `staging_deploy`/`production_deploy`
`iam:PutRolePolicy`/`iam:UpdateAssumeRolePolicy` against a `github-actions-*` *wildcard* pattern,
so each role could modify its own **and each other's** trust policy and inline policy via a
`tofu apply` from its own branch, and could create some other, arbitrarily-named role matching that
same pattern. Both were real escalation paths beyond "branch-merge access already implies whatever
CI's identity can do" — a compromised `dev/19.0` merge could rewrite `production_deploy`'s trust
policy (not just staging's own), or mint a brand-new role with an arbitrary trust/permissions
combination the ADR's threat model never accounted for.

Fixed by scoping each role's IAM-role write actions
(`Create`/`Update`/`Delete`/`PutRolePolicy`/etc.) to its own literal role ARN only
(`manage_own_role_staging_deploy`/`manage_own_role_production_deploy` in `oidc.tf`), not a wildcard
pattern and not the other role's ARN. Each role keeps read-only access (`Get`/`List` only) to the
*other* deploy role's ARN, since `tofu apply` still needs to refresh that role's state as part of
applying the shared `infra/cicd` module — but it can no longer write to it. This costs nothing
functionally (both roles' names are static Terraform literals, known before either is created) and
closes both the cross-role-mutation and arbitrary-new-role paths in one change. A dedicated policy
test (`infra/cicd/tests/deploy_role_infra_management_scoping.tftest.hcl`) asserts the isolation
directly: neither role's policy grants any write action against the other's ARN.

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
