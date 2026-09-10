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
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.tofu_runner_pull.json).Statement :
      statement.Effect == "Allow"
      && contains(flatten([statement.Principal.AWS]), "arn:aws:iam::222222222222:role/hosting-tofu-runner-execution")
      && length(flatten([statement.Principal.AWS])) == 1
    ])
    error_message = "tofu_runner's repository policy must grant exactly one principal: the configured Hosting Account execution role ARN, not a wildcard or additional principal."
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

# --- isolation proof: ecr.tf declares exactly one aws_ecr_repository_policy resource, and it
# targets tofu-runner — so the other three repositories get no repository policy at all, and no
# principal in any other account can read them. ---

run "verify_tofu_runner_is_the_only_repository_with_a_policy" {
  command = plan

  assert {
    condition     = aws_ecr_repository_policy.tofu_runner_pull.repository == "agentic-erp/tofu-runner"
    error_message = "The module's one aws_ecr_repository_policy resource must target agentic-erp/tofu-runner — the cross-account grant must not be declared against any of the other three repositories."
  }
}
