# Issue #215: staging_deploy/production_deploy now also apply infra/cicd and infra/registry
# themselves on a push to their own branch (see oidc.tf's comment above staging_deploy's policy
# document for the full rationale, including the deliberate self-management tradeoff). This proves
# the new statements stay scoped to exactly the resource shapes those two modules create — the
# `github-actions-*` role name pattern and this account's OIDC provider, the four ADR-0038 ECR
# repository ARNs, and infra/cicd + infra/registry's own two state objects — not a broader
# `iam:*`/`ecr:*`/`s3:*` grant, and not the other root modules' (foundation, a Trial Org) state.
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

run "verify_staging_deploy_infra_management_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.staging_deploy,
      data.aws_iam_policy_document.staging_deploy,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "ManageCicdOidcAndRoles"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com",
        "arn:aws:iam::111111111111:role/github-actions-*",
      ])
    ])
    error_message = "staging_deploy's ManageCicdOidcAndRoles statement must be scoped to exactly this account's OIDC provider and the github-actions-* role name pattern — no resource=\"*\"."
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
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:s3:::hosting-tofu-state/cicd/terraform.tfstate",
        "arn:aws:s3:::hosting-tofu-state/registry/terraform.tfstate",
      ])
    ])
    error_message = "staging_deploy's TofuStateBackend statement must be scoped to exactly infra/cicd and infra/registry's own state objects — not foundation's or a Trial Org's state, and not the whole bucket."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy.json).Statement :
      statement.Sid == "TofuStateLock"
      && flatten([statement.Resource]) == ["arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"]
    ])
    error_message = "staging_deploy's TofuStateLock statement must be scoped to exactly the configured lock table ARN."
  }
}
