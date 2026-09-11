# Issue #216: staging_deploy's new administration-stack deploy permissions (oidc.tf's
# administration_stack_deploy document) must stay scoped to exactly infra/platform's resource
# shapes and the one ECR repository it retags — not a broader grant, and never granted to
# production_deploy (that stays #217's job). Same no-live-AWS-account style as this directory's
# other tftest.hcl files: every resource's own creation is replaced by a literal stand-in
# (`override_resource`).

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                            = "us-east-1"
  github_repository                     = "dahagag/odoo"
  staging_branch                        = "dev/19.0"
  production_branch                     = "main/19.0"
  platform_account_id                   = "333333333333"
  tofu_state_bucket_arn                 = "arn:aws:s3:::hosting-tofu-state"
  tofu_state_lock_table_arn             = "arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"
  administration_stack_ecs_cluster_name = "platform"
  administration_stack_task_family      = "platform-administration-stack-api"
  administration_stack_ecs_service_name = "platform-administration-stack-api"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_iam_openid_connect_provider.github_actions
  values = {
    arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
  }
}

override_resource {
  target = aws_iam_role.staging_deploy
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-staging-deploy"
  }
}

override_resource {
  target = aws_iam_role.production_deploy
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-production-deploy"
  }
}

override_resource {
  target = aws_iam_role.ecr_push
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-ecr-push"
  }
}

override_resource {
  target = aws_iam_role.infra_plan
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-infra-plan"
  }
}

run "verify_administration_stack_deploy_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.staging_deploy,
      aws_iam_role.production_deploy,
      aws_iam_role.ecr_push,
      aws_iam_role.infra_plan,
      data.aws_iam_policy_document.staging_deploy,
      data.aws_iam_policy_document.production_deploy,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "TofuStateBackendPlatform"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:s3:::hosting-tofu-state/platform/terraform.tfstate"])
    ])
    error_message = "staging_deploy's TofuStateBackendPlatform statement must be scoped to exactly infra/platform's own state object."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ManageAdministrationStackEcs"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:ecs:us-east-1:333333333333:cluster/platform"])
    ])
    error_message = "staging_deploy's ManageAdministrationStackEcs statement must be scoped to exactly the administration-stack platform ECS cluster ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "DeployAdministrationStackService"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecs:us-east-1:333333333333:service/platform/platform-administration-stack-api",
      ])
    ])
    error_message = "staging_deploy's DeployAdministrationStackService statement must be scoped to exactly the administration-stack-api ECS service ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "RetagAdministrationStackImage"
      && toset(flatten([statement.Action])) == toset(["ecr:BatchGetImage", "ecr:PutImage"])
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "staging_deploy's RetagAdministrationStackImage statement must grant exactly BatchGetImage/PutImage on exactly the administration-stack-api repository — not push actions, and not the other three ECR repositories."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "PassAdministrationStackTaskRoles"
      && flatten([statement.Action]) == ["iam:PassRole"]
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::333333333333:role/platform-administration-stack-api-*"])
    ])
    error_message = "staging_deploy's PassAdministrationStackTaskRoles statement must be scoped to exactly the administration-stack task/execution role naming pattern, not a bare github-actions-* or \"*\"."
  }

  # --- production_deploy gets none of this — that's #217's own ticket to define ---

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy.json).Statement :
      contains([
        "TofuStateBackendPlatform", "ManageAdministrationStackNetworking", "ManageAdministrationStackEcs",
        "RegisterAdministrationStackTaskDefinition", "ReadAdministrationStackTaskDefinition",
        "DeployAdministrationStackService", "ManageAdministrationStackTaskRoles",
        "PassAdministrationStackTaskRoles", "ManageAdministrationStackLogGroup",
        "RetagAdministrationStackImage", "EcrAuthForRetag",
      ], statement.Sid)
    ])
    error_message = "production_deploy must not carry any of staging_deploy's new administration-stack deploy statements (issue #216 is staging-only; #217 defines production's own)."
  }
}
