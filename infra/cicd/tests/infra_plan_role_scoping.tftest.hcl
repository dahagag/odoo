# Issue #215: infra_plan is a fourth, separate, read-only role used by a pull_request run's
# `tofu plan` against infra/cicd and infra/registry (see oidc.tf's infra_plan comment for why it
# can't reuse ecr_push's trust pattern to become branch-scoped like staging_deploy/production_deploy
# — job_workflow_ref carries no branch information). This proves: (1) its trust condition is scoped
# to this repo's ci.yml pull_request runs the same way ecr_push's is, and not to any other
# repository's or workflow file's token; (2) its permission policy is read-only — no write action
# anywhere in it — and scoped to exactly the resource shapes infra/cicd and infra/registry create,
# no wildcard.
#
# No live AWS account is wired into this repo's CI (infra-checks only runs `tofu fmt`/`validate`/
# `test`/lint — .github/workflows/ci.yml), so this uses OpenTofu's own native test framework: it
# applies the real module (so the JSON asserted on below is the actual policy documents rendered
# from oidc.tf, not a hand-duplicated copy of them), with every resource's own creation replaced by
# a literal stand-in ARN (`override_resource`) so nothing here ever makes a real AWS API call.

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
  target = aws_iam_role.infra_plan
  values = {
    arn = "arn:aws:iam::111111111111:role/github-actions-infra-plan"
  }
}

run "verify_infra_plan_trust_and_read_only_scoping" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github_actions,
      aws_iam_role.infra_plan,
      data.aws_iam_policy_document.infra_plan_trust,
      data.aws_iam_policy_document.infra_plan,
    ]
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.infra_plan_trust.json).Statement :
      statement.Action == "sts:AssumeRoleWithWebIdentity"
      && contains(flatten([statement.Principal.Federated]), aws_iam_openid_connect_provider.github_actions.arn)
      && statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      && toset(flatten([statement.Condition.StringLike["token.actions.githubusercontent.com:job_workflow_ref"]])) == toset([
        "dahagag/odoo/.github/workflows/ci.yml@refs/pull/*/merge",
      ])
    ])
    error_message = "infra_plan's trust policy must allow sts:AssumeRoleWithWebIdentity from the GitHub OIDC provider, scoped to exactly this repo's ci.yml pull_request job_workflow_ref pattern — no more, no fewer."
  }

  # --- isolation proof: a different repository's job_workflow_ref does not match ---

  assert {
    condition = !contains(
      flatten([
        [for statement in jsondecode(data.aws_iam_policy_document.infra_plan_trust.json).Statement : statement][0]
        .Condition.StringLike["token.actions.githubusercontent.com:job_workflow_ref"]
      ]),
      "someone-else/odoo/.github/workflows/ci.yml@refs/pull/1/merge"
    )
    error_message = "infra_plan's trust policy job_workflow_ref condition must not match a different repository's OIDC token."
  }

  # --- read-only proof: no statement in infra_plan's policy grants a write/mutate action ---

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.infra_plan.json).Statement :
      alltrue([
        for action in flatten([statement.Action]) :
        # Every action infra_plan grants must be a read-only IAM/ECR/S3 verb — Get*, List*,
        # Describe*, or ecr:GetLifecyclePolicy/GetRepositoryPolicy (also read-only despite not
        # matching the Get*/List*/Describe* prefixes below).
        can(regex("^(iam|ecr|s3):(Get|List|Describe).*$", action))
      ])
    ])
    error_message = "infra_plan's policy must grant only read-only (Get*/List*/Describe*) actions — no iam:Create*/Put*/Update*/Delete*, no ecr:Create*/Put*/Delete*, no s3:PutObject."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.infra_plan.json).Statement :
      statement.Sid == "ReadRegistryRepositories"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-dev",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/odoo-prod",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/tofu-runner",
        "arn:aws:ecr:us-east-1:333333333333:repository/agentic-erp/administration-stack-api",
      ])
    ])
    error_message = "infra_plan's ReadRegistryRepositories statement must be scoped to exactly the four ADR-0038 repository ARNs — no resource=\"*\"."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.infra_plan.json).Statement :
      statement.Sid == "TofuStateBackendRead"
      && toset(flatten([statement.Resource])) == toset([
        "arn:aws:s3:::hosting-tofu-state/cicd/terraform.tfstate",
        "arn:aws:s3:::hosting-tofu-state/registry/terraform.tfstate",
      ])
    ])
    error_message = "infra_plan's TofuStateBackendRead statement must be scoped to exactly infra/cicd and infra/registry's own state objects — not the whole state bucket."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.infra_plan.json).Statement :
      statement.Sid == "TofuStateBackendReadListBucket"
      && flatten([statement.Action]) == ["s3:ListBucket"]
      && flatten([statement.Resource]) == ["arn:aws:s3:::hosting-tofu-state"]
    ])
    error_message = "infra_plan's TofuStateBackendReadListBucket statement must grant exactly read-only s3:ListBucket on the state bucket ARN itself — no write action, no DynamoDB (this role runs tofu plan -lock=false)."
  }
}
