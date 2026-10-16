# #203's own constraint, carried into #337's acceptance criteria: staging must have no
# credential or network path into the Hosting Account, so a compromised staging instance is
# contained (ADR-0040). Every IAM role this module creates trusts only ecs-tasks.amazonaws.com
# (never an AWS account principal, which is how a Hosting Account role would be granted
# assume-into access - see infra/registry/cross_account_iam.tf's own trust policies for what that
# shape looks like), and no policy document anywhere in the module grants sts:AssumeRole at all -
# there is nothing for a compromised task to assume into, in this account or any other. No live
# AWS account is wired into this repo's CI; every resource's own creation is a literal stand-in
# via `override_resource`.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                       = "us-east-1"
  odoo_repository_url              = "111111111111.dkr.ecr.us-east-1.amazonaws.com/agentic-erp/odoo-staging"
  odoo_image_tag                   = "deadbeef"
  platform_assume_role_arn         = "arn:aws:iam::333333333333:role/platform-staging-odoo-deploy"
  staging_odoo_secrets_kms_key_arn = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_iam_role.ecs_task_execution
  values = {
    id  = "staging-odoo-execution"
    arn = "arn:aws:iam::111111111111:role/staging-odoo-execution"
  }
}

override_resource {
  target = aws_iam_role.ecs_task
  values = {
    id  = "staging-odoo-task"
    arn = "arn:aws:iam::111111111111:role/staging-odoo-task"
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_execution_secrets
  values = {
    id = "staging-odoo-execution:staging-odoo-execution-secrets"
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_seed_secrets
  values = {
    id = "staging-odoo-task:staging-odoo-task-seed-secrets"
  }
}

run "verify_no_cross_account_assume_role_anywhere" {
  command = apply

  plan_options {
    target = [
      aws_iam_role.ecs_task_execution,
      aws_iam_role.ecs_task,
      aws_iam_role_policy.ecs_task_execution_secrets,
      aws_iam_role_policy.ecs_task_seed_secrets,
    ]
  }

  # Both task roles trust only the ECS tasks service principal - no AWS account principal at all,
  # which rules out any "Hosting Account role may assume this" trust grant by construction.
  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role.ecs_task_execution.assume_role_policy).Statement :
      statement.Principal.Service == "ecs-tasks.amazonaws.com" && !contains(keys(statement.Principal), "AWS")
    ])
    error_message = "The ECS task execution role's trust policy must only trust ecs-tasks.amazonaws.com, never an AWS account principal (that is how a cross-account/Hosting-Account assume grant is expressed - infra/registry/cross_account_iam.tf's own trust policies)."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role.ecs_task.assume_role_policy).Statement :
      statement.Principal.Service == "ecs-tasks.amazonaws.com" && !contains(keys(statement.Principal), "AWS")
    ])
    error_message = "The ECS task role's trust policy must only trust ecs-tasks.amazonaws.com, never an AWS account principal."
  }

  # No inline policy this module attaches grants sts:AssumeRole at all - a compromised staging
  # task has nothing to assume into, in this account or the Hosting Account.
  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.ecs_task_execution_secrets.policy).Statement :
      !contains(flatten([statement.Action]), "sts:AssumeRole")
    ])
    error_message = "The ECS task execution role's inline policy must not grant sts:AssumeRole - this module's provider is the only cross-account relationship staging Odoo has (assuming INTO the Platform Account, providers.tf), never a grant a compromised task could use to assume into the Hosting Account or anywhere else."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement :
      !contains(flatten([statement.Action]), "sts:AssumeRole")
    ])
    error_message = "The ECS task role's inline policy must not grant sts:AssumeRole."
  }
}
