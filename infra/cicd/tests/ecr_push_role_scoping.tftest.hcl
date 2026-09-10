# Issue #252 / ADR-0038: ecr_push is a third, separate role from staging_deploy/production_deploy
# — not a reuse of either, mirroring #153's discipline that a PR-time image-build job gets only
# the permission it needs. This proves both halves of that narrowness: (1) the trust policy's
# branch scoping — matching either staging_branch or production_branch (image builds only run on
# push to those two), same isolation proof as deploy_role_branch_isolation.tftest.hcl — and (2)
# the permission policy's repository scoping — ecr:* is granted only against the four configured
# repository ARNs, with ecr:GetAuthorizationToken carved out into its own resource="*" statement
# since ECR does not support resource-level permissions for that action.
#
# No live AWS account is wired into this repo's CI (infra-checks only runs `tofu fmt`/`validate`/
# `test`/lint — .github/workflows/ci.yml), so this uses OpenTofu's own native test framework: it
# applies the real module (so the JSON asserted on below is the actual policy documents rendered
# from oidc.tf, not a hand-duplicated copy of them), with every resource's own creation replaced
# by a literal stand-in ARN (`override_resource`) so nothing here ever makes a real AWS API call.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region          = "us-east-1"
  github_repository   = "dahagag/odoo"
  staging_branch      = "dev/19.0"
  production_branch   = "main/19.0"
  platform_account_id = "333333333333"
}

override_resource {
  target = aws_iam_openid_connect_provider.github_actions
  values = {
    arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
  }
}

override_resource {
  target = aws_iam_role.ecr_push
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-ecr-push"
  }
}

run "verify_ecr_push_branch_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.ecr_push,
      data.aws_iam_policy_document.ecr_push_trust,
      data.aws_iam_policy_document.ecr_push,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.ecr_push_trust.json).Statement :
      statement.Action == "sts:AssumeRoleWithWebIdentity"
      && contains(flatten([statement.Principal.Federated]), aws_iam_openid_connect_provider.github_actions.arn)
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      && contains(flatten([statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"]]), "repo:dahagag/odoo:ref:refs/heads/dev/19.0")
      && contains(flatten([statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"]]), "repo:dahagag/odoo:ref:refs/heads/main/19.0")
    ])
    error_message = "ecr_push's trust policy must allow sts:AssumeRoleWithWebIdentity from the GitHub OIDC provider, scoped to both the staging and production branches (image builds run on either)."
  }

  # --- isolation proof: neither an arbitrary branch nor a forked repo's OIDC sub claim matches ---

  assert {
    condition = !contains(
      flatten([
        [for statement in jsondecode(data.aws_iam_policy_document.ecr_push_trust.json).Statement : statement][0]
        .Condition.StringEquals["token.actions.githubusercontent.com:sub"]
      ]),
      "repo:dahagag/odoo:ref:refs/heads/some-other-branch"
    )
    error_message = "ecr_push's trust policy sub condition must not match a different branch of this same repo."
  }

  assert {
    condition = !contains(
      flatten([
        [for statement in jsondecode(data.aws_iam_policy_document.ecr_push_trust.json).Statement : statement][0]
        .Condition.StringEquals["token.actions.githubusercontent.com:sub"]
      ]),
      "repo:someone-else/odoo:ref:refs/heads/dev/19.0"
    )
    error_message = "ecr_push's trust policy sub condition must not match a forked repository's OIDC token, even on an identically-named branch."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.ecr_push.json).Statement :
      statement.Sid == "EcrPush"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-dev",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-prod",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/tofu-runner",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "ecr_push's EcrPush statement must be scoped to exactly the four ADR-0038 repository ARNs, in the configured platform_account_id — no more, no fewer, and no resource=\"*\"."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.ecr_push.json).Statement :
      statement.Sid == "EcrAuth"
      && statement.Action == "ecr:GetAuthorizationToken"
      && flatten([statement.Resource]) == ["*"]
    ])
    error_message = "ecr_push must carry a separate EcrAuth statement granting only ecr:GetAuthorizationToken against resource \"*\" (the one ECR action that does not support resource-level permissions) — this must not be folded into the repo-scoped EcrPush statement."
  }
}
