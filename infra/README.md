# Hosting Operations infrastructure (OpenTofu)

This directory holds the OpenTofu code for the Hosting Operations foundation described in
[ADR-0016](../docs/adr/0016-opentofu-for-static-and-per-trial-provisioning.md) and the ADRs it
links to (0013, 0018-0024). It targets the **Hosting Account** from
[ADR-0013](../docs/adr/0013-aws-organizations-for-hosting-foundation.md).

We use [OpenTofu](https://opentofu.org/) (MPL 2.0), not Terraform (BSL) — see ADR-0016 for why.

## Layout

```
infra/
├── bootstrap/          Root module. One-time setup of the S3 bucket + DynamoDB table that
│                       back the *OpenTofu remote state* used by every other root module here.
│                       Uses local state itself (a backend can't bootstrap its own store).
├── foundation/         Root module. The static, shared Hosting Account foundation: VPC, base
│                       AMI reference, ECS cluster, Route53 zone, ACM wildcard cert, IAM roles,
│                       the Trial Org lifecycle Step Functions state machine, its DynamoDB lock
│                       table, the ECS task definition that runs `tofu`, the EventBridge
│                       stale-lock and snapshot-cleanup rules, and the shared log-forwarding,
│                       auto-destroy-snapshot, and snapshot-cleanup Lambdas.
│                       Applied once (and on foundation changes), not per Trial Org.
├── cicd/               Root module. The GitHub Actions OIDC identity provider and four
│                       branch-scoped/repo-scoped roles issue #212 (staging/production deploy),
│                       #252 (ecr_push), and #215 (infra_plan) added, reversing ADR-0017's
│                       self-hosted-runner approach in favor of `sts:AssumeRoleWithWebIdentity` —
│                       no long-lived AWS keys, no runner instance to patch. Each role's trust
│                       policy is scoped to this repository: the deploy roles each trust their own
│                       one branch (staging_deploy → staging_branch, production_deploy →
│                       production_branch), while ecr_push and infra_plan trust any pull_request
│                       run against this repo's ci.yml (image builds and infra plans both happen at
│                       PR time, on either branch). Not merely branch protection.
│                       Independent of `foundation` (own state key, own `tofu init`/`plan`/
│                       `apply`); the deploy roles' app-deploy permissions are still a deliberate
│                       placeholder until #216/#217 define what a deploy touches (see oidc.tf), but
│                       they are scoped for real for a second, narrower purpose (issue #215):
│                       applying `infra/cicd` and `infra/registry` themselves, plan-on-PR (via the
│                       read-only infra_plan role) and apply-on-merge (via themselves) — see
│                       `.github/workflows/ci.yml`'s infra-plan/infra-apply jobs and the "`tofu
│                       apply` is a deliberate human/ops action" section below.
├── registry/           Root module (ADR-0038, Platform-Account-scoped). The four ECR
│                       repositories the fork's images move to (`agentic-erp/odoo-dev`,
│                       `agentic-erp/odoo-prod`, `agentic-erp/tofu-runner`,
│                       `agentic-erp/administration-stack-api`): topology, count-based lifecycle
│                       policies on the two images with an existing build cadence, AES-256
│                       encryption on all four, and `tofu-runner`'s cross-account repository
│                       policy granting pull-only access to the Hosting Account's ECS task
│                       execution role (`infra/foundation`). Independent of `foundation` and
│                       `cicd` (own state key); no cross-module remote-state lookup — repository
│                       names are fixed by ADR-0038, and the Hosting Account role ARN is supplied
│                       as a plain variable at apply time. Plans and applies from CI the same way
│                       `cicd` does (issue #215).
├── platform/           Root module (Platform Account). The administration-stack API's own
│                       compute: a dedicated VPC (private subnets + one NAT, no public ingress —
│                       epic #193 story 18), an ECS cluster/service/task definition running
│                       `stack/apps/api`'s image, its two IAM roles, and its log group. No load
│                       balancer yet — issue #216's "first end-to-end proof" of the deploy
│                       pipeline, not a production-shaped deployment. Independent of `cicd` and
│                       `registry` (own state key); the ECR repository URL and the image tag to
│                       deploy are supplied as plain variables at apply time (same no-remote-
│                       state convention as `registry`). Plans on PRs touching it via the shared,
│                       read-only `infra_plan` role; applies only on a push to `dev/19.0`, via
│                       `staging_deploy`'s narrow `administration_stack_deploy` permissions
│                       (`infra/cicd/oidc.tf`) — `production_deploy` has none of this yet (#217).
└── modules/
    └── trial_org/       Reusable module (not a root module — nothing here runs `tofu` against it
                          directly). Declares one Trial Org's own infrastructure: one EC2
                          instance, its narrow logs-only instance profile, its own CloudWatch log
                          group + subscription filter, its security group, and its DNS record.
                          Instantiated once per Trial Org by the ECS task the foundation's state
                          machine runs (`arn:aws:states:::ecs:runTask.sync`), against remote-state
                          key `trial-orgs/<trial_org_id>/terraform.tfstate`, per ADR-0016's
                          state-key isolation. A later ticket (tracked under #106) supplies the
                          thin root-module wrapper + CI/task image that invokes this module per
                          Trial Org; this module is written to be instantiated that way but is not
                          itself invoked anywhere in this repo yet.
```

`foundation` and `bootstrap` are independent root modules (each gets its own `tofu init` /
`tofu plan` / `tofu apply`). `modules/trial_org` is a reusable module with no backend of its own —
whatever invokes it supplies the backend config and the state key.

## Running locally

All commands below are **read-only against AWS** (`validate` makes no AWS calls at all; `plan`
with `-backend=false` makes only the read calls needed to compute a plan, and will fail without
credentials — that's expected in this repo, since no AWS credentials are available to CI or to an
agent working in this repo).

```sh
cd infra/foundation   # or infra/bootstrap, or infra/modules/trial_org
tofu fmt -recursive ..
tofu init -backend=false   # skips remote state; fine for validate, needed for plan's provider install
tofu validate
tofu plan   # will fail past the provider-auth step without real AWS credentials — expected here
```

`infra/modules/trial_org` has no root-level backend or provider block of its own (it's a reusable
module), so `tofu validate` there needs a thin example root to instantiate it against. See
`infra/modules/trial_org/README.md` for how later tickets are expected to invoke it.

## `tofu apply` is a deliberate human/ops action — for `bootstrap` and `foundation`

**Nothing in this repository runs `tofu apply` or `tofu destroy` against `bootstrap` or
`foundation`, automatically or otherwise.** No CI workflow and no agent working in this repo is
authorized to apply either. Applying these two root modules against the real Hosting Account is a
manual, credentialed step performed by a human operator, tracked as its own follow-up ticket under
#106 (this ticket, #113, is code-only). Per-Trial-Org applies of `modules/trial_org` happen later,
automatically, but only via the state machine's ECS task running inside AWS itself — never from a
developer machine or CI runner.

**`cicd` and `registry` are the exception** (issue #215, under #202): CI plans them on every pull
request that touches either (posted to the job summary for review) and applies on a merge to
`dev/19.0`/`main/19.0`, using the branch-scoped `staging_deploy`/`production_deploy` roles
`infra/cicd/oidc.tf` defines, gated by the existing `infra-checks` job. `bootstrap` and
`foundation` were deliberately left out of that automation: `foundation` is the shared AWS
backbone every Trial Org and the hosting product depend on (VPC, ECS cluster, DNS, the Trial Org
state machine), and `bootstrap` has no remote backend of its own (it creates the backend), so
applying it from CI is a chicken-and-egg problem regardless. Revisit including `foundation` once
the deploy roles' permissions cover more than infra/cicd + infra/registry's own resources.

**`platform` also applies from CI (issue #216), but staging-only so far**: `infra-plan-platform`
plans it on any pull request touching it (`infra_plan`, same as `cicd`/`registry`), and
`deploy-administration-stack-staging` applies it on a push to `dev/19.0` only, using
`staging_deploy`'s narrow `administration_stack_deploy` permissions. There is no
`main/19.0`-triggered apply of `platform` yet — `production_deploy` carries none of these
permissions until #217 defines what a production deploy of the administration stack touches.

**Cross-account role chaining (issue #271/#272)**: `staging_deploy`, `production_deploy`, and
`infra_plan` all live in the Hosting Account, but `platform`'s VPC/ECS/IAM/Logs resources and
`registry`'s ECR repositories live in the Platform Account (ADR-0038) — and EC2, ECS, IAM, and
CloudWatch Logs have no cross-account resource-based policy mechanism at all (unlike ECR's
data-plane pull/push actions, which do, via a repository policy). So each of those three Hosting
Account roles' own identity policy carries only a narrow `sts:AssumeRole` grant onto a
corresponding Platform Account role `registry` owns (`platform-registry-deploy`,
`platform-administration-stack-deploy`, `platform-ci-plan` — `registry/cross_account_iam.tf`),
which carries the real EC2/ECS/IAM/Logs/ECR-management permissions instead. `platform`'s and
`registry`'s own AWS providers assume into whichever of these three roles fits the calling CI job
(a plain variable, `platform_assume_role_arn`, supplied at apply/plan time — no cross-module
remote-state lookup).

Because nothing can assume into a role that doesn't exist yet, **`registry`'s first apply is also
now a manual, credentialed step**, alongside `bootstrap`'s and `foundation`'s: a human operator
with real Platform Account credentials runs it directly (no `platform_assume_role_arn` set), which
creates the four ECR repositories and all three cross-account roles at once.

Every apply after that goes through CI as normal for `registry`'s own ECR repositories — but
**not** for the three cross-account roles' own definitions (their trust policy, their permission
statements). Those stay a manual, human-operator apply forever, same as `bootstrap`/`foundation`:
`platform-registry-deploy` (shared by `staging_deploy`/`production_deploy`, since both apply
`registry` via CI) deliberately carries no `iam:PutRolePolicy`/`iam:CreateRole`/etc. on any of the
three roles, only read access for `tofu plan`/`apply`'s refresh phase — a compromised
`staging_deploy`/`production_deploy` session assuming it must not be able to rewrite
`platform-administration-stack-deploy`'s (or its own) authorization into something broader
(CWE-269). This is unlike `cicd`'s own self-managing roles, which is safe there only because each
of `staging_deploy`/`production_deploy` self-manages exactly its own single role, never a role the
other can also reach.

### Repository variables the infra-plan/infra-apply CI jobs need

Bootstrapping `cicd`'s own roles/OIDC provider and `infra/bootstrap`'s state backend is still a
manual, credentialed first apply (chicken-and-egg — nothing can assume a role that doesn't exist
yet, or write to a backend that doesn't exist yet). Once that first apply has happened, a human
operator sets these as plain repository variables (`vars.*`, not `secrets.*` — none of these are
sensitive on their own; ADR-0017's reasoning that a role ARN's confidentiality doesn't matter,
only its trust policy does, applies the same way here) for `.github/workflows/ci.yml`'s
`infra-plan`/`infra-apply` jobs to use:

| Variable | Source |
| --- | --- |
| `STAGING_DEPLOY_ROLE_ARN` | `infra/cicd`'s `staging_deploy_role_arn` output |
| `PRODUCTION_DEPLOY_ROLE_ARN` | `infra/cicd`'s `production_deploy_role_arn` output |
| `INFRA_PLAN_ROLE_ARN` | `infra/cicd`'s `infra_plan_role_arn` output |
| `TOFU_STATE_BUCKET` | `infra/bootstrap`'s `state_bucket_name` output |
| `TOFU_STATE_BUCKET_ARN` | `arn:aws:s3:::<state_bucket_name>` |
| `TOFU_STATE_LOCK_TABLE` | `infra/bootstrap`'s `state_lock_table_name` output |
| `TOFU_STATE_LOCK_TABLE_ARN` | `arn:aws:dynamodb:<region>:<account_id>:table/<state_lock_table_name>` |
| `PLATFORM_ACCOUNT_ID` | `infra/cicd`'s `platform_account_id` input (the Platform Account `infra/registry` lives in) |
| `HOSTING_ACCOUNT_ECS_TASK_EXECUTION_ROLE_ARN` | `infra/registry`'s `hosting_account_ecs_task_execution_role_arn` input |
| `ADMINISTRATION_STACK_API_REPOSITORY_URL` | `infra/registry`'s `administration_stack_api_repository_url` output |
| `PLATFORM_REGISTRY_DEPLOY_ROLE_ARN` | `infra/registry`'s `platform_registry_deploy_role_arn` output (issue #271/#272) |
| `PLATFORM_ADMINISTRATION_STACK_DEPLOY_ROLE_ARN` | `infra/registry`'s `platform_administration_stack_deploy_role_arn` output (issue #271/#272) |
| `PLATFORM_CI_PLAN_ROLE_ARN` | `infra/registry`'s `platform_ci_plan_role_arn` output (issue #271/#272) |

`AWS_REGION` already exists from #212/#252's wiring and is reused as-is for the backend's `region`
too (`infra/bootstrap` and `infra/cicd` live in the same account/region).

After `foundation`'s first apply, the operator must also **delegate `var.root_domain` to the
zone's name servers** (the `route53_name_servers` output) at the domain's registrar or parent
zone. Until that one-time delegation is done, the zone `foundation` creates is not publicly
authoritative: ACM's DNS validation for the wildcard certificate cannot complete, and Trial Org
DNS records written to the zone will not resolve. See `infra/foundation/dns.tf`.

## Tagging / ABAC convention

Every resource this code creates that participates in an `aws:ResourceTag` ABAC condition (see
ADR-0019, ADR-0021, ADR-0023) carries a `TrialOrgId` tag (per-trial resources) or is otherwise
scoped so the IAM conditions in `foundation/iam.tf` hold. Common tags (`Project`, `ManagedBy`,
`Environment`) are applied via each root module's default provider `tags` block plus a per-module
`local.tags` merge; see `locals.tf` in each root module.
