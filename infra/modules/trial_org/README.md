# `trial_org` module

Reusable module for one Trial Org's own infrastructure: one EC2 instance, its narrow logs-only
IAM instance profile, its own CloudWatch log group + subscription filter (targeting the shared
log-forwarding Lambda declared once in `../../foundation`), its security group, and its DNS
record. See ADR-0016, ADR-0021, ADR-0023.

This module has no backend or provider block of its own — it is not a root module. Nothing in
this repository invokes it yet; per ticket #113 it is authored so a later ticket (tracked under
#106) can add the thin root-module wrapper the ECS `tofu`-runner task (declared in
`../../foundation/ecs_task.tf`) actually runs, one per Trial Org, against remote-state key
`trial-orgs/<trial_org_id>/terraform.tfstate` in the shared S3 backend (ADR-0016).

## Expected invocation shape

That future root module is expected to look roughly like:

```hcl
terraform {
  backend "s3" {
    # key is set per-invocation via -backend-config="key=trial-orgs/<trial_org_id>/terraform.tfstate"
  }
}

provider "aws" {
  region = "us-east-1" # or var.aws_region
}

module "trial_org" {
  source = "../../modules/trial_org"

  trial_org_id              = var.trial_org_id
  trial_org_subdomain_label = var.trial_org_subdomain_label
  dns_environment           = var.dns_environment # "prod" or "dev" — distinct from the foundation's own `environment` input

  vpc_id    = var.vpc_id    # foundation's vpc_id output
  subnet_id = var.subnet_id # one of foundation's public_subnet_ids outputs

  ami_id = var.ami_id # foundation's base_ami_id output

  route53_zone_id = var.route53_zone_id # foundation's route53_zone_id output
  root_domain     = var.root_domain
  dev_subdomain   = var.dev_subdomain

  log_forwarder_lambda_arn = var.log_forwarder_lambda_arn # foundation's log_forwarder_lambda_arn output
  log_group_prefix         = var.log_group_prefix         # foundation's trial_org_log_group_prefix output

  instance_role_permissions_boundary_arn = var.instance_role_permissions_boundary_arn # foundation's trial_org_instance_permissions_boundary_arn output

  module_git_sha = var.module_git_sha # this module's own git SHA at apply time, known by the CI/ECS task invoking it
}
```

The `var.*` values above (foundation outputs, plus per-trial values like `trial_org_id`) are
passed in as container overrides / environment variables by the state machine's ECS Task state
(`../../foundation/state_machine.asl.json.tftpl`), not hardcoded — see `../../foundation/ecs_task.tf`
for the container definition that runs `tofu` against whatever root module wraps this one.

## Validating this module standalone

This module alone has no provider configuration, so `tofu validate` here uses the AWS provider's
default (empty) configuration, which is valid syntax and makes no AWS calls:

```sh
cd infra/modules/trial_org
tofu init -backend=false
tofu validate
```

`tofu plan` isn't meaningful run directly against this directory (no backend, and most variables
have no default) — plan it via the future wrapper root module described above instead, supplying
concrete `-var` values.

The committed `examples/validate` fixture instead instantiates the module with dummy-but-valid
values for every required variable, so `tofu validate` there also exercises the variable
validation blocks above and the module's own resource wiring, not just its syntax. This is what
the `infra-checks` CI job runs; the same commands work locally:

```sh
cd infra/modules/trial_org/examples/validate
tofu init -backend=false
tofu validate
```
