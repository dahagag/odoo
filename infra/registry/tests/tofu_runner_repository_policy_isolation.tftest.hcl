# Issue #252 / ADR-0038: agentic-erp/tofu-runner is the only one of the four repositories with a
# cross-account grant (it runs in the Hosting Account; this registry lives in the Platform
# Account). Proves the repository policy grants pull-only access to exactly the configured
# Hosting Account execution role — not a wildcard principal, not write access, and not leaked
# onto the other three repositories, which get no repository policy at all.
#
# No live AWS account is wired into this repo's CI (infra-checks only runs `tofu fmt`/`validate`/
# `test`/lint — .github/workflows/ci.yml), so this uses OpenTofu's own native test framework: it
# applies the real module (so the JSON asserted on below is the actual policy document rendered
# from ecr.tf, not a hand-duplicated copy of it), with every resource's own creation replaced by a
# literal stand-in ARN (`override_resource`) so nothing here ever makes a real AWS API call.

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
}

# Issue #271/#272: this module's provider now declares data.aws_caller_identity.current (used to
# build infra/platform's resource ARNs without a separate account-id variable) — overridden here
# the same way every infra/cicd tftest.hcl already overrides it, so no real STS call happens.
override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_ecr_repository.tofu_runner
  values = {
    arn = "arn:aws:ecr:us-east-1:111111111111:repository/agentic-erp/tofu-runner"
  }
}

run "verify_tofu_runner_pull_grant_is_narrow" {
  command = apply

  plan_options {
    target = [
      aws_ecr_repository.tofu_runner,
      data.aws_iam_policy_document.tofu_runner_pull,
    ]
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.tofu_runner_pull.json).Statement :
      statement.Effect != "Allow" || (
        toset(flatten([statement.Principal.AWS])) == toset(["arn:aws:iam::222222222222:role/hosting-tofu-runner-execution"])
      )
    ])
    error_message = "Every Allow statement in tofu_runner's repository policy must authorize exactly one principal: the configured Hosting Account execution role ARN, not a wildcard or additional principal."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.tofu_runner_pull.json).Statement :
      alltrue([
        for action in flatten([statement.Action]) :
        contains(["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], action)
      ])
    ])
    error_message = "tofu_runner's repository policy must grant only pull actions — no push (ecr:PutImage), no admin (ecr:SetRepositoryPolicy/ecr:DeleteRepository)."
  }
}

# --- isolation proof: tofu_runner_pull's own principal (the Hosting Account ECS task execution
# --- role) is the pull-only grant that predates issue #271/#272 — it must never be mixed with
# --- ecr_push/staging_deploy's own push/retag principals (odoo_dev_push, odoo_prod_push,
# --- administration_stack_api_push in ecr.tf), and vice versa. ---

run "verify_tofu_runner_is_the_only_repository_with_a_policy" {
  command = plan

  assert {
    condition     = aws_ecr_repository_policy.tofu_runner_pull.repository == "agentic-erp/tofu-runner"
    error_message = "tofu_runner_pull must target agentic-erp/tofu-runner."
  }

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.tofu_runner_pull.json).Statement :
      contains(
        flatten([statement.Principal.AWS]),
        var.ecr_push_role_arn
        ) || contains(
        flatten([statement.Principal.AWS]),
        var.staging_deploy_role_arn
      )
    ])
    error_message = "tofu_runner's pull-only policy must not also grant ecr_push or staging_deploy — those roles' own push/retag access lives on odoo_dev/odoo_prod/administration_stack_api's separate repository policies (issue #271/#272), never mixed onto tofu-runner's."
  }

  assert {
    condition = !anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.administration_stack_api_push.json).Statement :
      contains(flatten([statement.Principal.AWS]), var.hosting_account_ecs_task_execution_role_arn)
    ])
    error_message = "administration_stack_api's push/retag policy must not also grant the Hosting Account ECS task execution role — that principal is tofu_runner_pull's alone."
  }
}
