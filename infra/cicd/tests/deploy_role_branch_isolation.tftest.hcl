# Issue #212 acceptance criterion: "tofu test covers the branch-scoping (IAM isolation) the same
# way existing trial_org IAM isolation tests do" (see
# infra/foundation/tests/trial_org_execution_iam_isolation.tftest.hcl).
#
# No live AWS account is wired into this repo's CI (infra-checks only runs `tofu fmt`/`validate`/
# `test`/lint — .github/workflows/ci.yml), so this uses OpenTofu's own native test framework: it
# applies the real module (so the JSON asserted on below is the actual policy documents rendered
# from oidc.tf, not a hand-duplicated copy of them), with every resource's own creation replaced
# by a literal stand-in ARN (`override_resource`) so nothing here ever makes a real AWS API call.
#
# Unlike trial_org_execution's ABAC (a `${aws:PrincipalTag/...}` policy variable resolved at
# assume-role time), GitHub's OIDC `sub` claim is compared with a plain, fixed StringEquals — so
# the isolation proof here is direct: assert the rendered condition equals this repo's own
# staging/production `sub` value, and separately assert it does not equal a different branch's or
# a different (e.g. forked) repository's `sub` value, which is exactly the string GitHub would put
# in the token for a run this trust policy must reject.
#
# Issue #266: the expected `sub` value below uses the ID-qualified "owner@id/repo@id" form
# (github_repository_immutable_subject), not the plain "owner/repo" — this account has GitHub's
# immutable-subject OIDC customization enabled, so that's what a real token's `sub` actually
# contains. The first real push-triggered infra-apply failed until this was fixed; this test's
# fixture value was wrong in the same way oidc.tf's code was, which is why it didn't catch it.

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

run "verify_staging_deploy_branch_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.staging_deploy,
      data.aws_iam_policy_document.staging_deploy_trust,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.staging_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRoleWithWebIdentity"
      && contains(flatten([statement.Principal.Federated]), aws_iam_openid_connect_provider.github_actions.arn)
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/dev/19.0"
    ])
    error_message = "staging_deploy's trust policy must allow sts:AssumeRoleWithWebIdentity only from the GitHub OIDC provider, scoped to this repo's staging branch."
  }

  # --- isolation proof: neither an arbitrary branch nor a forked repo's OIDC sub claim matches ---

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.staging_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/some-other-branch"
    )
    error_message = "staging_deploy's trust policy sub condition must not match a different branch of this same repo."
  }

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.staging_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:someone-else/odoo:ref:refs/heads/dev/19.0"
    )
    error_message = "staging_deploy's trust policy sub condition must not match a forked repository's OIDC token, even on an identically-named branch."
  }
}

run "verify_production_deploy_branch_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.production_deploy,
      data.aws_iam_policy_document.production_deploy_trust,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.production_deploy_trust.json).Statement :
      statement.Action == "sts:AssumeRoleWithWebIdentity"
      && contains(flatten([statement.Principal.Federated]), aws_iam_openid_connect_provider.github_actions.arn)
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/main/19.0"
    ])
    error_message = "production_deploy's trust policy must allow sts:AssumeRoleWithWebIdentity only from the GitHub OIDC provider, scoped to this repo's production branch."
  }

  # --- cross-role isolation: a staging-branch run's own sub claim must not satisfy production's
  # trust policy either — this is the acceptance criterion's core claim ("a workflow running on
  # an arbitrary branch cannot assume the production role"), proven against the actual staging
  # branch specifically, not just an unrelated placeholder branch name. ---

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.production_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:dahagag@2604865/odoo@1351561791:ref:refs/heads/dev/19.0"
    )
    error_message = "production_deploy's trust policy sub condition must not match the staging branch's OIDC token — a staging-branch workflow run must not be able to assume production_deploy."
  }

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.production_deploy_trust.json).Statement : statement][0]
      .Condition.StringEquals["token.actions.githubusercontent.com:sub"] != "repo:someone-else/odoo:ref:refs/heads/main/19.0"
    )
    error_message = "production_deploy's trust policy sub condition must not match a forked repository's OIDC token, even on an identically-named branch."
  }
}
