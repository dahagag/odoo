# Issue #216: staging_deploy's administration-stack deploy permissions must stay scoped to
# exactly infra/platform's resource shapes and the one ECR repository it retags — not a broader
# grant, and never granted to production_deploy (that stays #217's job).
#
# Issue #271/#272: the EC2/ECS/IAM/Logs statements this test used to assert directly (the actual
# scoping now lives in infra/registry/cross_account_iam.tf's platform_administration_stack_deploy
# role — see infra/registry/tests/platform_administration_stack_deploy_role_scoping.tftest.hcl)
# are replaced here by an assertion that staging_deploy carries exactly one narrow
# sts:AssumeRole statement onto that role's ARN, and none of the old direct EC2/ECS/IAM/Logs
# actions at all. Same no-live-AWS-account style as this directory's other tftest.hcl files:
# every resource's own creation is replaced by a literal stand-in (`override_resource`).

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                                    = "us-east-1"
  github_repository                             = "dahagag/odoo"
  staging_branch                                = "dev/19.0"
  production_branch                             = "main/19.0"
  platform_account_id                           = "333333333333"
  tofu_state_bucket_arn                         = "arn:aws:s3:::hosting-tofu-state"
  tofu_state_lock_table_arn                     = "arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"
  platform_registry_deploy_role_arn             = "arn:aws:iam::333333333333:role/platform-registry-deploy"
  platform_administration_stack_deploy_role_arn = "arn:aws:iam::333333333333:role/platform-administration-stack-deploy"
  platform_ci_plan_role_arn                     = "arn:aws:iam::333333333333:role/platform-ci-plan"
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
      statement.Sid == "AssumePlatformAdministrationStackDeployRole"
      && flatten([statement.Action]) == ["sts:AssumeRole"]
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::333333333333:role/platform-administration-stack-deploy"])
    ])
    error_message = "staging_deploy must carry exactly one sts:AssumeRole statement scoped to platform-administration-stack-deploy's own ARN."
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

  # --- issue #271/#272: none of the old direct EC2/ECS/IAM/Logs statements survive on
  # --- staging_deploy itself — they moved wholesale to platform_administration_stack_deploy
  # --- (infra/registry/cross_account_iam.tf), replaced here by the single AssumeRole statement
  # --- asserted above.
  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      contains([
        "ManageAdministrationStackNetworking", "TagAdministrationStackNetworkingOnCreate",
        "ManageAdministrationStackNetworkingScoped", "ManageAdministrationStackEcs",
        "RegisterAdministrationStackTaskDefinition", "ReadAdministrationStackTaskDefinition",
        "DeployAdministrationStackService", "ManageAdministrationStackTaskRoles",
        "PassAdministrationStackTaskRoles", "ManageAdministrationStackLogGroup",
      ], statement.Sid)
    ])
    error_message = "staging_deploy must not carry any direct EC2/ECS/IAM/Logs statement — those services have no cross-account resource-based policy mechanism, so any such grant here could never work against real AWS; the fix is the AssumePlatformAdministrationStackDeployRole statement instead."
  }

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      contains(flatten([statement.Action]), "ec2:CreateVpc") || contains(flatten([statement.Action]), "ecs:CreateCluster")
    ])
    error_message = "staging_deploy must not grant any EC2/ECS action directly, under any statement Sid — this is a belt-and-suspenders check on top of the Sid-based one above."
  }

  # --- production_deploy gets none of this — that's #217's own ticket to define ---

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy.json).Statement :
      contains([
        "TofuStateBackendPlatform", "AssumePlatformAdministrationStackDeployRole",
        "RetagAdministrationStackImage", "EcrAuthForRetag",
      ], statement.Sid)
    ])
    error_message = "production_deploy must not carry any of staging_deploy's administration-stack deploy statements (issue #216 is staging-only; #217 defines production's own)."
  }
}
