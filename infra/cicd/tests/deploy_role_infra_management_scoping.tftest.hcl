# Issue #215/#262: staging_deploy/production_deploy now also apply infra/cicd and infra/registry
# themselves on a push to their own branch (see oidc.tf's comment above staging_deploy's policy
# document for the full rationale, including why each role manages only its own IAM role, not the
# other's). This proves the new statements stay scoped to exactly the resource shapes those two
# modules create — each role's own literal ARN (not a `github-actions-*` wildcard, and not the
# other role's ARN) for role management, this account's OIDC provider, the four ADR-0038 ECR
# repository ARNs, and infra/cicd + infra/registry's own two state objects — not a broader
# `iam:*`/`ecr:*`/`s3:*` grant, and not the other root modules' (foundation, a Trial Org) state.
# It also proves the cross-role isolation directly: staging_deploy's policy grants no write action
# against production_deploy's ARN, and vice versa.
#
# No live AWS account is wired into this repo's CI, so this uses OpenTofu's own native test
# framework the same way deploy_role_branch_isolation.tftest.hcl and ecr_push_role_scoping.tftest.hcl
# do: it applies the real module with every resource's own creation replaced by a literal stand-in
# ARN (`override_resource`), so nothing here ever makes a real AWS API call.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                = "us-east-1"
  github_repository         = "dahagag/odoo"
  staging_branch            = "dev/19.0"
  production_branch         = "main/19.0"
  platform_account_id       = "333333333333"
  tofu_state_bucket_arn     = "arn:aws:s3:::hosting-tofu-state"
  tofu_state_lock_table_arn = "arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"
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

run "verify_deploy_role_infra_management_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.staging_deploy,
      aws_iam_role.production_deploy,
      data.aws_iam_policy_document.staging_deploy,
      data.aws_iam_policy_document.production_deploy,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ManageCicdOidc"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com",
      ])
    ])
    error_message = "staging_deploy's ManageCicdOidc statement must be scoped to exactly this account's OIDC provider — no github-actions-* role pattern, no resource=\"*\"."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ManageOwnRole"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::111111111111:role/github-actions-staging-deploy"])
    ])
    error_message = "staging_deploy's ManageOwnRole statement must be scoped to exactly its own role ARN — not production_deploy's, not a github-actions-* wildcard."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ReadOtherDeployRole"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::111111111111:role/github-actions-production-deploy"])
      && alltrue([for action in flatten([statement.Action]) : can(regex("^iam:(Get|List).*$", action))])
    ])
    error_message = "staging_deploy's ReadOtherDeployRole statement must grant only read-only actions against exactly production_deploy's ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy.json).Statement :
      statement.Sid == "ManageOwnRole"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::111111111111:role/github-actions-production-deploy"])
    ])
    error_message = "production_deploy's ManageOwnRole statement must be scoped to exactly its own role ARN — not staging_deploy's, not a github-actions-* wildcard."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy.json).Statement :
      statement.Sid == "ReadOtherDeployRole"
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::111111111111:role/github-actions-staging-deploy"])
      && alltrue([for action in flatten([statement.Action]) : can(regex("^iam:(Get|List).*$", action))])
    ])
    error_message = "production_deploy's ReadOtherDeployRole statement must grant only read-only actions against exactly staging_deploy's ARN."
  }

  # --- cross-role isolation proof: neither role's policy grants a write action against the
  # --- other's ARN under any statement, by any Sid ---

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      !contains(flatten([statement.Resource]), "arn:aws:iam::111111111111:role/github-actions-production-deploy")
      || alltrue([for action in flatten([statement.Action]) : can(regex("^iam:(Get|List).*$", action))])
    ])
    error_message = "staging_deploy's policy must not grant any write action against production_deploy's role ARN."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy.json).Statement :
      !contains(flatten([statement.Resource]), "arn:aws:iam::111111111111:role/github-actions-staging-deploy")
      || alltrue([for action in flatten([statement.Action]) : can(regex("^iam:(Get|List).*$", action))])
    ])
    error_message = "production_deploy's policy must not grant any write action against staging_deploy's role ARN."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ManageRegistryRepositories"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-dev",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-prod",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/tofu-runner",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "staging_deploy's ManageRegistryRepositories statement must be scoped to exactly the four ADR-0038 repository ARNs — no resource=\"*\"."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "TofuStateBackend"
      && toset(flatten([statement.Action])) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:s3:::hosting-tofu-state/cicd/terraform.tfstate",
        "arn:aws:s3:::hosting-tofu-state/registry/terraform.tfstate",
      ])
    ])
    error_message = "staging_deploy's TofuStateBackend statement must grant exactly GetObject/PutObject/DeleteObject, scoped to exactly infra/cicd and infra/registry's own state objects — not foundation's or a Trial Org's state, and not the whole bucket."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "TofuStateBackendListBucket"
      && flatten([statement.Action]) == ["s3:ListBucket"]
      && flatten([statement.Resource]) == ["arn:aws:s3:::hosting-tofu-state"]
    ])
    error_message = "staging_deploy's TofuStateBackendListBucket statement must grant exactly s3:ListBucket on the state bucket ARN itself (bucket-level, not the state objects)."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "TofuStateLock"
      && toset(flatten([statement.Action])) == toset(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"])
      && flatten([statement.Resource]) == ["arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"]
    ])
    error_message = "staging_deploy's TofuStateLock statement must grant exactly GetItem/PutItem/DeleteItem/DescribeTable, scoped to exactly the configured lock table ARN."
  }
}
