# Issue #271/#272: platform_registry_deploy is a Platform Account role that staging_deploy AND
# production_deploy (both Hosting Account roles, infra/cicd) assume via sts:AssumeRole to manage
# this module's own ECR repositories — replacing infra/cicd's old, broken direct
# ManageRegistryRepositories grant, which could never have worked cross-account. Proves: (1) its
# trust policy allows exactly those two principals, no more, no fewer; (2) its permissions
# document is scoped to exactly the four repository ARNs this module creates, with exactly the
# repository-management action list infra/cicd used to grant directly.
#
# No live AWS account is wired into this repo's CI, so this uses OpenTofu's own native test
# framework the same way infra/cicd's tftest.hcl files do: it applies the real module (so the JSON
# asserted on below is the actual policy documents rendered from cross_account_iam.tf, not a
# hand-duplicated copy of them), with every resource's own creation replaced by a literal
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
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_ecr_repository.odoo_dev
  values = {
    arn = "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/odoo-dev"
  }
}

override_resource {
  target = aws_ecr_repository.odoo_prod
  values = {
    arn = "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/odoo-prod"
  }
}

override_resource {
  target = aws_ecr_repository.tofu_runner
  values = {
    arn = "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/tofu-runner"
  }
}

override_resource {
  target = aws_ecr_repository.administration_stack_api
  values = {
    arn = "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/administration-stack-api"
  }
}

override_resource {
  target = aws_iam_role.platform_registry_deploy
  values = {
    arn = "arn:aws:iam::111111111111:role/platform-registry-deploy"
  }
}

# platform_registry_deploy's own policy also references its two sibling roles' ARNs
# (ManageRegistryCrossAccountRoles) — overridden here too so this run never attempts to create
# them for real.
override_resource {
  target = aws_iam_role.platform_administration_stack_deploy
  values = {
    arn = "arn:aws:iam::111111111111:role/platform-administration-stack-deploy"
  }
}

override_resource {
  target = aws_iam_role.platform_ci_plan
  values = {
    arn = "arn:aws:iam::111111111111:role/platform-ci-plan"
  }
}

run "verify_platform_registry_deploy_trust_and_permissions" {
  command = apply

  plan_options {
    target = [
      aws_ecr_repository.odoo_dev,
      aws_ecr_repository.odoo_prod,
      aws_ecr_repository.tofu_runner,
      aws_ecr_repository.administration_stack_api,
      aws_iam_role.platform_registry_deploy,
      aws_iam_role.platform_administration_stack_deploy,
      aws_iam_role.platform_ci_plan,
      data.aws_iam_policy_document.platform_registry_deploy_trust,
      data.aws_iam_policy_document.platform_registry_deploy,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_registry_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRole"
      && toset(flatten([statement.Principal.AWS])) == toset([
        "arn:aws:iam::222222222222:role/github-actions-staging-deploy",
        "arn:aws:iam::222222222222:role/github-actions-production-deploy",
      ])
    ])
    error_message = "platform-registry-deploy's trust policy must allow sts:AssumeRole from exactly staging_deploy and production_deploy — not infra_plan, not a wildcard, no OIDC principal."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_registry_deploy.json).Statement :
      statement.Sid == "ManageRegistryRepositories"
      && toset(flatten([statement.Action])) == toset([
        "ecr:CreateRepository", "ecr:DescribeRepositories", "ecr:DeleteRepository",
        "ecr:PutLifecyclePolicy", "ecr:GetLifecyclePolicy", "ecr:DeleteLifecyclePolicy",
        "ecr:SetRepositoryPolicy", "ecr:GetRepositoryPolicy", "ecr:DeleteRepositoryPolicy",
        "ecr:PutImageTagMutability", "ecr:PutImageScanningConfiguration", "ecr:TagResource",
        "ecr:ListTagsForResource",
      ])
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/odoo-dev",
        "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/odoo-prod",
        "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/tofu-runner",
        "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "platform-registry-deploy's ManageRegistryRepositories statement must grant exactly infra/cicd's old repository-management action list, scoped to exactly the four repositories this module creates."
  }
}
