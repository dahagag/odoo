# Issue #349: platform_staging_odoo_deploy is a Platform Account role that staging_odoo_deploy
# alone (not staging_deploy, not production_deploy) assumes via sts:AssumeRole to deploy
# infra/staging-odoo's VPC/ECS/IAM/Logs resources — same role-chaining mechanism as
# platform_administration_stack_deploy, but trusted by its own dedicated Hosting Account caller
# since infra/staging-odoo is its own deployable unit with no production counterpart. Proves:
# (1) its trust policy allows exactly staging_odoo_deploy, not staging_deploy/production_deploy/
# infra_plan; (2) its permissions document is scoped to infra/staging-odoo's own resource shapes,
# not administration_stack's; (3) it carries none of staging_odoo_deploy's own Hosting-Account-
# side statements.
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
  target = aws_iam_role.platform_staging_odoo_deploy
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-staging-odoo-deploy"
  }
}

run "verify_platform_staging_odoo_deploy_trust_and_permissions" {
  command = apply

  plan_options {
    target = [
      aws_iam_role.platform_staging_odoo_deploy,
      data.aws_iam_policy_document.platform_staging_odoo_deploy_trust,
      data.aws_iam_policy_document.platform_staging_odoo_deploy,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRole"
      && toset(flatten([statement.Principal.AWS])) == toset([
        "arn:aws:iam::222222222222:role/github-actions-staging-odoo-deploy",
      ])
    ])
    error_message = "platform-staging-odoo-deploy's trust policy must allow sts:AssumeRole from exactly staging_odoo_deploy — not staging_deploy, not production_deploy, not infra_plan, no OIDC principal."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "ManageStagingOdooEcs"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:ecs:us-east-1:333333333333:cluster/staging-odoo"])
    ])
    error_message = "ManageStagingOdooEcs must be scoped to exactly infra/staging-odoo's own ECS cluster ARN, built from this account's own identity, not a platform_account_id variable."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "DeployStagingOdooService"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecs:us-east-1:333333333333:service/staging-odoo/staging-odoo",
      ])
    ])
    error_message = "DeployStagingOdooService must be scoped to exactly the staging-odoo ECS service ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "PassStagingOdooTaskRoles"
      && flatten([statement.Action]) == ["iam:PassRole"]
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::333333333333:role/staging-odoo-*"])
      && try(statement.Condition.StringEquals["iam:PassedToService"], null) == "ecs-tasks.amazonaws.com"
    ])
    error_message = "PassStagingOdooTaskRoles must be scoped to exactly the staging-odoo-* role naming pattern (covers both staging-odoo-execution and staging-odoo-task), conditioned on passing only to ecs-tasks.amazonaws.com."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "ManageStagingOdooNetworkingScoped"
      && try(statement.Condition.StringEquals["ec2:ResourceTag/TofuModule"], null) == "staging-odoo"
    ])
    error_message = "ManageStagingOdooNetworkingScoped must be conditioned on ec2:ResourceTag/TofuModule=staging-odoo, not \"platform\" (administration_stack's own tag value) or any other module's."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "ManageStagingOdooDeployedCommitParameter"
      && toset(flatten([statement.Action])) == toset([
        "ssm:GetParameter", "ssm:PutParameter",
        "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:ListTagsForResource",
      ])
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ssm:us-east-1:333333333333:parameter/staging-odoo/deployed-commit",
      ])
    ])
    error_message = "ManageStagingOdooDeployedCommitParameter (issue #218's pattern) must be scoped to exactly staging-odoo's own deployed-commit parameter ARN, distinct from administration_stack's."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      statement.Sid == "ManageStagingOdooLogGroup"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/postgres",
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/postgres:*",
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/odoo",
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/odoo:*",
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/tailscale",
        "arn:aws:logs:us-east-1:333333333333:log-group:/ecs/staging-odoo/tailscale:*",
      ])
    ])
    error_message = "ManageStagingOdooLogGroup must cover exactly infra/staging-odoo's three log groups (postgres/odoo/tailscale, one per task container) - not administration_stack's single log group."
  }

  # This role carries none of staging_odoo_deploy's own Hosting-Account-side statements — the S3
  # state-backend grant, the ECR retag grant, or an sts:AssumeRole back onto itself — same split
  # platform_administration_stack_deploy's own test proves for staging_deploy.
  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_staging_odoo_deploy.json).Statement :
      contains(["TofuStateBackendStagingOdoo", "RetagStagingOdooImage", "EcrAuthForRetag", "CallerIdentity"], statement.Sid)
    ])
    error_message = "platform-staging-odoo-deploy must not carry the Hosting-Account-side S3 state or ECR retag statements — those stay on staging_odoo_deploy itself (infra/cicd/oidc.tf)."
  }
}
