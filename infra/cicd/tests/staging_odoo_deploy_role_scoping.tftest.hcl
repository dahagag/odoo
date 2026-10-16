# Issue #341/#349: staging_odoo_deploy is a fifth, separate role dedicated to deploy-odoo-staging
# (dev/19.0 push) — not a reuse of staging_deploy. Proves: (1) its trust policy allows exactly
# this repo's staging branch, isolated from a different branch or a forked repo's OIDC sub claim
# (same proof shape as deploy_role_branch_isolation.tftest.hcl); (2) its permission document is
# scoped to exactly infra/staging-odoo's own state object and ECR repository, not
# administration_stack's or any other module's; (3) it carries no manage_own_role-style
# self-referential grant, since it never applies infra/cicd itself.
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
  aws_region                                    = "us-east-1"
  github_repository                             = "dahagag/odoo"
  github_repository_immutable_subject           = "dahagag@2604865/odoo@1351561791"
  staging_branch                                = "dev/19.0"
  production_branch                             = "main/19.0"
  platform_account_id                           = "333333333333"
  tofu_state_bucket_arn                         = "arn:aws:s3:::hosting-tofu-state"
  tofu_state_lock_table_arn                     = "arn:aws:dynamodb:us-east-1:111111111111:table/hosting-tofu-state-lock"
  platform_registry_deploy_role_arn             = "arn:aws:iam::333333333333:role/platform-registry-deploy"
  platform_administration_stack_deploy_role_arn = "arn:aws:iam::333333333333:role/platform-administration-stack-deploy"
  platform_ci_plan_role_arn                     = "arn:aws:iam::333333333333:role/platform-ci-plan"
  platform_staging_odoo_deploy_role_arn         = "arn:aws:iam::333333333333:role/platform-staging-odoo-deploy"
  platform_staging_odoo_ci_plan_role_arn        = "arn:aws:iam::333333333333:role/platform-staging-odoo-ci-plan"
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
  target = aws_iam_role.staging_odoo_deploy
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-staging-odoo-deploy"
  }
}

run "verify_staging_odoo_deploy_branch_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.staging_odoo_deploy,
      data.aws_iam_policy_document.staging_odoo_deploy_trust,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRoleWithWebIdentity"
      && contains(flatten([statement.Principal.Federated]), aws_iam_openid_connect_provider.github_actions.arn)
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/dev/19.0"
    ])
    error_message = "staging_odoo_deploy's trust policy must allow sts:AssumeRoleWithWebIdentity only from the GitHub OIDC provider, scoped to this repo's staging branch."
  }

  # --- isolation proof: neither an arbitrary branch nor a forked repo's OIDC sub claim matches,
  # same shape as deploy_role_branch_isolation.tftest.hcl's staging_deploy proof ---

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/some-other-branch"
    )
    error_message = "staging_odoo_deploy's trust policy sub condition must not match a different branch of this same repo."
  }

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:someone-else/odoo:ref:refs/heads/dev/19.0"
    )
    error_message = "staging_odoo_deploy's trust policy sub condition must not match a forked repository's OIDC token, even on an identically-named branch."
  }
}

run "verify_staging_odoo_deploy_permissions_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_role.staging_odoo_deploy,
      data.aws_iam_policy_document.staging_odoo_deploy,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy.json).Statement :
      statement.Sid == "TofuStateBackendStagingOdoo"
      && toset(flatten([statement.Action])) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
      && toset(flatten([statement.Resource])) == toset(["arn:aws:s3:::hosting-tofu-state/staging-odoo/terraform.tfstate"])
    ])
    error_message = "TofuStateBackendStagingOdoo must be scoped to exactly infra/staging-odoo's own state object, not administration_stack's (platform/terraform.tfstate) or any other module's."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy.json).Statement :
      statement.Sid == "AssumePlatformStagingOdooDeployRole"
      && flatten([statement.Action]) == ["sts:AssumeRole"]
      && toset(flatten([statement.Resource])) == toset(["arn:aws:iam::333333333333:role/platform-staging-odoo-deploy"])
    ])
    error_message = "AssumePlatformStagingOdooDeployRole must be scoped to exactly platform_staging_odoo_deploy_role_arn, not platform_administration_stack_deploy_role_arn."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy.json).Statement :
      statement.Sid == "RetagStagingOdooImage"
      && toset(flatten([statement.Action])) == toset(["ecr:BatchGetImage", "ecr:PutImage"])
      && toset(flatten([statement.Resource])) == toset(["arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-staging"])
    ])
    error_message = "RetagStagingOdooImage must be scoped to exactly agentic-erp/odoo-staging — never agentic-erp/administration-stack-api or any other repository, and never new-layer-upload actions (this role only retags, it never pushes new content)."
  }

  # This role carries no self-referential manage_own_role-style grant — unlike staging_deploy/
  # production_deploy, it never applies infra/cicd itself (deploy-odoo-staging's infra-tofu step
  # only ever runs dir: infra/staging-odoo), so it needs no iam:PutRolePolicy onto its own ARN.
  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_odoo_deploy.json).Statement :
      alltrue([
        for action in flatten([statement.Action]) :
        can(regex("^iam:(Create|Update|Delete|Put|Attach|Detach|Tag)Role", action))
      ])
    ])
    error_message = "staging_odoo_deploy must not grant any IAM role-management action — unlike staging_deploy/production_deploy, it never self-manages its own role via infra/cicd's apply."
  }
}
