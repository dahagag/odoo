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
│                       stale-lock cleanup rule, and the one shared log-forwarding Lambda.
│                       Applied once (and on foundation changes), not per Trial Org.
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

## `tofu apply` is a deliberate human/ops action

**Nothing in this repository runs `tofu apply` or `tofu destroy` against real AWS, automatically
or otherwise.** No CI workflow and no agent working in this repo is authorized to apply this code.
Applying the `bootstrap` and `foundation` root modules against the real Hosting Account is a
manual, credentialed step performed by a human operator, tracked as its own follow-up ticket under
#106 (this ticket, #113, is code-only). Per-Trial-Org applies of `modules/trial_org` happen later,
automatically, but only via the state machine's ECS task running inside AWS itself — never from a
developer machine or CI runner.

## Tagging / ABAC convention

Every resource this code creates that participates in an `aws:ResourceTag` ABAC condition (see
ADR-0019, ADR-0021, ADR-0023) carries a `TrialOrgId` tag (per-trial resources) or is otherwise
scoped so the IAM conditions in `foundation/iam.tf` hold. Common tags (`Project`, `ManagedBy`,
`Environment`) are applied via each root module's default provider `tags` block plus a per-module
`local.tags` merge; see `locals.tf` in each root module.
