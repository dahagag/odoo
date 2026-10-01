# Issue #349: platform_staging_odoo_ci_plan is the read-only Platform Account counterpart to
# platform_staging_odoo_deploy, trusted by the existing shared infra_plan role (not a new,
# dedicated Hosting Account PR-time role) — a PR touching infra/staging-odoo needs a real
# `tofu plan`, the same reasoning platform_ci_plan exists for infra/registry and infra/platform.
# Kept as its own dedicated role rather than folded into platform_ci_plan itself, matching issue
# #341's already-shipped ci.yml wiring (PLATFORM_STAGING_ODOO_CI_PLAN_ROLE_ARN, distinct from
# PLATFORM_CI_PLAN_ROLE_ARN). Proves: (1) its trust policy allows exactly infra_plan; (2) its
# permission document grants only read-only (Get*/List*/Describe*) actions, scoped to
# infra/staging-odoo's own resources; (3) it does not carry platform_staging_odoo_deploy's own
# write grants.
#
# No live AWS account is wired into this repo's CI, so this uses OpenTofu's own native test
# framework, applying the real module with every resource's own creation replaced by a literal
# stand-in ARN (`override_resource`), so nothing here ever makes a real AWS API call.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                                  = "us-east-1"
  hosting_account_ecs_task_execution_role_arn = "arn:aws:iam::222222222222:role/hosting-tofu-runner-execution"
  staging_deploy_role_arn                     = "arn:aws:iam::222222222222:role/github-actions-staging-deploy"
  production_deploy_role_arn                  = "arn:aws:iam::222222222222:role/github-actions-production-deploy"
  infra_plan_role_arn                         = "arn:aws:iam::222222222222:role/github-actions-infra-plan"
  ecr_push_role_arn                           = "arn:aws:iam::222222222222:role/github-actions-ecr-push"
  staging_odoo_deploy_role_arn                = "arn:aws:iam::222222222222:role/github-actions-staging-odoo-deploy"
  staging_odoo_ecs_cluster_name               = "staging-odoo"
  staging_odoo_task_family                    = "staging-odoo"
  staging_odoo_ecs_service_name               = "staging-odoo"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "333333333333"
  }
}

override_resource {
  target = aws_iam_role.platform_staging_odoo_ci_plan
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-staging-odoo-ci-plan"
  }
}

run "verify_platform_staging_odoo_ci_plan_trust_and_read_only_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_role.platform_staging_odoo_ci_plan,
      data.aws_iam_policy_document.platform_staging_odoo_ci_plan_trust,
      data.aws_iam_policy_document.platform_staging_odoo_ci_plan,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_ci_plan_trust.json).Statement :
      statement.Action == "sts:AssumeRole"
      && toset(flatten([statement.Principal.AWS])) == toset([
        "arn:aws:iam::222222222222:role/github-actions-infra-plan",
      ])
    ])
    error_message = "platform-staging-odoo-ci-plan's trust policy must allow sts:AssumeRole from exactly infra_plan — not staging_odoo_deploy, not staging_deploy/production_deploy, no OIDC principal."
  }

  # Mirrors platform_ci_plan's own read-only-only assertion exactly.
  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_ci_plan.json).Statement :
      alltrue([
        for action in flatten([statement.Action]) :
        !can(regex("^(ec2|ecs|iam|logs|ssm):(Create|Update|Delete|Put|Attach|Detach|Tag|Register|Deregister|AddTags|RemoveTags|AssociateRouteTable|DisassociateRouteTable|AuthorizeSecurity|RevokeSecurity|Allocate|Release|Attach|Detach)", action))
      ])
    ])
    error_message = "platform-staging-odoo-ci-plan's policy must grant only read-only (Get*/List*/Describe*) actions — no ec2:Create*/Delete*, no ecs:Create*/Delete*/Register*, no iam:Create*/Put*/Delete*, no logs:Create*/Put*/Delete*, no ssm:Put*/Delete*."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_ci_plan.json).Statement :
      statement.Sid == "ReadStagingOdooEcs"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecs:us-east-1:333333333333:cluster/staging-odoo",
        "arn:aws:ecs:us-east-1:333333333333:service/staging-odoo/staging-odoo",
      ])
    ])
    error_message = "ReadStagingOdooEcs must be scoped to exactly infra/staging-odoo's own ECS cluster and service ARNs."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_ci_plan.json).Statement :
      statement.Sid == "ReadStagingOdooDeployedCommitParameter"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ssm:us-east-1:333333333333:parameter/staging-odoo/deployed-commit",
      ])
    ])
    error_message = "ReadStagingOdooDeployedCommitParameter must be scoped to exactly staging-odoo's own deployed-commit parameter ARN."
  }

  # No write grant from platform_staging_odoo_deploy rides along here.
  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_ci_plan.json).Statement :
      contains(["ManageStagingOdooEcs", "DeployStagingOdooService", "ManageStagingOdooTaskRoles", "ManageStagingOdooDeployedCommitParameter"], statement.Sid)
    ])
    error_message = "platform-staging-odoo-ci-plan must not carry any of platform_staging_odoo_deploy's write statements."
  }
}
