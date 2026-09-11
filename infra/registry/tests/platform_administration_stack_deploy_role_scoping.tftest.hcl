# Issue #271/#272: platform_administration_stack_deploy is a Platform Account role that
# staging_deploy alone (not production_deploy — that stays #217's job) assumes via sts:AssumeRole
# to deploy infra/platform's VPC/ECS/IAM/Logs resources — replacing infra/cicd's old, broken
# direct EC2/ECS/IAM/Logs grants, none of which could ever have worked cross-account (those four
# services have no cross-account resource-based policy mechanism at all). Proves: (1) its trust
# policy allows exactly staging_deploy, not production_deploy or infra_plan; (2) its permissions
# document carries the same nine statements infra/cicd's administration_stack_deploy document
# used to, scoped to the same resource shapes, moved verbatim.
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
  administration_stack_ecs_cluster_name       = "platform"
  administration_stack_task_family            = "platform-administration-stack-api"
  administration_stack_ecs_service_name       = "platform-administration-stack-api"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "333333333333"
  }
}

override_resource {
  target = aws_iam_role.platform_administration_stack_deploy
  values = {
    arn = "arn:aws:iam::333333333333:role/platform-administration-stack-deploy"
  }
}

run "verify_platform_administration_stack_deploy_trust_and_permissions" {
  command = apply

  plan_options {
    target = [
      aws_iam_role.platform_administration_stack_deploy,
      data.aws_iam_policy_document.platform_administration_stack_deploy_trust,
      data.aws_iam_policy_document.platform_administration_stack_deploy,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRole"
      && toset(flatten([statement.Principal.AWS])) == toset(["arn:aws:iam::222222222222:role/github-actions-staging-deploy"])
    ])
    error_message = "platform-administration-stack-deploy's trust policy must allow sts:AssumeRole from exactly staging_deploy — not production_deploy (that stays #217's job), not infra_plan, no OIDC principal."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy.json).Statement :
      statement.Sid == "ManageAdministrationStackEcs"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:ecs:us-east-1:333333333333:cluster/platform"])
    ])
    error_message = "ManageAdministrationStackEcs must be scoped to exactly the administration-stack platform ECS cluster ARN, built from this account's own identity, not a platform_account_id variable."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy.json).Statement :
      statement.Sid == "DeployAdministrationStackService"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecs:us-east-1:333333333333:service/platform/platform-administration-stack-api",
      ])
    ])
    error_message = "DeployAdministrationStackService must be scoped to exactly the administration-stack-api ECS service ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy.json).Statement :
      statement.Sid == "PassAdministrationStackTaskRoles"
      && flatten([statement.Action]) == ["iam:PassRole"]
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::333333333333:role/platform-administration-stack-api-*"])
      && try(statement.Condition.StringEquals["iam:PassedToService"], null) == "ecs-tasks.amazonaws.com"
    ])
    error_message = "PassAdministrationStackTaskRoles must be scoped to exactly the administration-stack task/execution role naming pattern, conditioned on passing only to ecs-tasks.amazonaws.com."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy.json).Statement :
      statement.Sid == "ManageAdministrationStackNetworkingScoped"
      && try(statement.Condition.StringEquals["ec2:ResourceTag/TofuModule"], null) == "platform"
    ])
    error_message = "ManageAdministrationStackNetworkingScoped must stay conditioned on ec2:ResourceTag/TofuModule=platform, exactly as infra/cicd's original statement was."
  }

  # --- this role carries none of staging_deploy's own Hosting-Account-side statements — the
  # --- S3 state-backend grant, the ECR retag grant, or an sts:AssumeRole back onto itself ---

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.platform_administration_stack_deploy.json).Statement :
      contains(["TofuStateBackendPlatform", "RetagAdministrationStackImage", "EcrAuthForRetag"], statement.Sid)
    ])
    error_message = "platform-administration-stack-deploy must not carry the Hosting-Account-side S3 state or ECR retag statements — those stay on staging_deploy itself (infra/cicd/oidc.tf)."
  }
}
