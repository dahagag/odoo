# Issue #271/#272: platform_ci_plan is a Platform Account, read-only role that infra_plan alone
# assumes via sts:AssumeRole for a real (not empty-state) `tofu plan` of infra/registry or
# infra/platform on a pull request — replacing infra/cicd's old, broken direct read statements
# (ReadRegistryRepositories, ReadAdministrationStackNetworking/-Ecs/-TaskRoles/-LogGroup), none of
# which could ever have worked cross-account for the EC2/ECS/IAM/Logs half of them. Proves: (1)
# its trust policy allows exactly infra_plan, not staging_deploy or production_deploy; (2) its
# permissions document is entirely read-only (Get*/List*/Describe* only), covering both the
# registry and administration-stack resource shapes.
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
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "333333333333"
  }
}

override_resource {
  target = aws_ecr_repository.odoo_dev
  values = {
    arn = "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-dev"
  }
}

override_resource {
  target = aws_ecr_repository.odoo_prod
  values = {
    arn = "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-prod"
  }
}

override_resource {
  target = aws_ecr_repository.tofu_runner
  values = {
    arn = "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/tofu-runner"
  }
}

override_resource {
  target = aws_ecr_repository.administration_stack_api
  values = {
    arn = "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api"
  }
}

override_resource {
  target = aws_iam_role.platform_ci_plan
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-ci-plan"
  }
}

# platform_ci_plan's own policy also references its two sibling roles' ARNs
# (ReadRegistryCrossAccountRoles) — overridden here too so this run never attempts to create them
# for real.
override_resource {
  target = aws_iam_role.platform_registry_deploy
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-registry-deploy"
  }
}

override_resource {
  target = aws_iam_role.platform_administration_stack_deploy
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-administration-stack-deploy"
  }
}

run "verify_platform_ci_plan_trust_and_read_only_scoping" {
  command = apply

  plan_options {
    target = [
      aws_ecr_repository.odoo_dev,
      aws_ecr_repository.odoo_prod,
      aws_ecr_repository.tofu_runner,
      aws_ecr_repository.administration_stack_api,
      aws_iam_role.platform_ci_plan,
      aws_iam_role.platform_registry_deploy,
      aws_iam_role.platform_administration_stack_deploy,
      data.aws_iam_policy_document.platform_ci_plan_trust,
      data.aws_iam_policy_document.platform_ci_plan,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_ci_plan_trust.json).Statement :
      statement.Action == "sts:AssumeRole"
      && toset(flatten([statement.Principal.AWS])) == toset(["arn:aws:iam::222222222222:role/github-actions-infra-plan"])
    ])
    error_message = "platform-ci-plan's trust policy must allow sts:AssumeRole from exactly infra_plan — not staging_deploy or production_deploy."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_ci_plan.json).Statement :
      alltrue([
        for action in flatten([statement.Action]) :
        can(regex("^(iam|ecr|ec2|ecs|logs):(Get|List|Describe).*$", action))
      ])
    ])
    error_message = "platform-ci-plan's policy must grant only read-only (Get*/List*/Describe*) actions — no ecr:Create*/Put*/Delete*, no ec2:Create*/Delete*, no ecs:Create*/Delete*, no iam:Create*/Put*/Delete*, no logs:Create*/Put*/Delete*."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_ci_plan.json).Statement :
      statement.Sid == "ReadRegistryRepositories"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-dev",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-prod",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/tofu-runner",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "ReadRegistryRepositories must be scoped to exactly the four repository ARNs this module creates."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_ci_plan.json).Statement :
      statement.Sid == "ReadAdministrationStackEcs"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecs:us-east-1:333333333333:cluster/platform",
        "arn:aws:ecs:us-east-1:333333333333:service/platform/platform-administration-stack-api",
        "arn:aws:ecs:us-east-1:333333333333:task-definition/platform-administration-stack-api:*",
      ])
    ])
    error_message = "ReadAdministrationStackEcs must be scoped to exactly the administration-stack cluster/service/task-family ARNs, built from this account's own identity."
  }
}
