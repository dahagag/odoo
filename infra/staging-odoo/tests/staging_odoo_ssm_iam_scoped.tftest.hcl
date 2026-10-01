# ADR-0041 acceptance criterion: the Odoo admin password and every early-adopter/stakeholder
# seed-account password are SSM SecureString parameters, IAM-scoped, never plaintext - and the
# Tailscale auth key / in-task Postgres password (resolved via ECS-native `secrets`) must be
# scoped the same way. A resource-unscoped ("*") grant, or the default alias/aws/ssm KMS key,
# would let a compromised task read every SecureString parameter in the account, not just its
# own - mirroring infra/platform/tests/ses_send_permission_scoped.tftest.hcl's own header and
# shape (no live AWS account wired into this repo's CI; every resource's own creation is a
# literal stand-in via `override_resource`).

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

run "verify_task_role_seed_secrets_scoped" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_seed_secrets]
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[0].Action == "ssm:GetParameter"
      && toset(jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[0].Resource) == toset([
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/odoo-admin-password",
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/seed-accounts/*",
      ])
    )
    error_message = "The ecs_task role's ssm:GetParameter grant must be scoped to exactly the admin-password parameter and the seed-accounts path prefix, not '*' or any other parameter."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[1].Action == "kms:Decrypt"
    error_message = "The ecs_task role must be granted exactly kms:Decrypt for the seed-secret SecureString parameters."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[1].Resource == var.staging_odoo_secrets_kms_key_arn
    error_message = "The ecs_task role's kms:Decrypt grant must be scoped to exactly var.staging_odoo_secrets_kms_key_arn, never '*' or the default alias/aws/ssm key implicitly."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_seed_secrets.role == aws_iam_role.ecs_task.id
    error_message = "The seed-secrets grant must attach to staging Odoo's own ECS task role, not the execution role."
  }

  # docker/odoo-staging-entrypoint.sh's seed step calls the plural, recursive
  # ssm:GetParametersByPath (not just the singular ssm:GetParameter above) to enumerate every
  # seed-account password under the path prefix - distinct IAM actions, both required. IAM
  # evaluates this action against the Path argument's own parameter resource, not only its
  # children, so both the bare path ARN and its "/*" form must be present (CodeRabbit review on
  # PR #346 - the "/*"-only grant left the direct call ungranted).
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[2].Action == "ssm:GetParametersByPath"
      && toset(flatten([jsondecode(aws_iam_role_policy.ecs_task_seed_secrets.policy).Statement[2].Resource])) == toset([
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/seed-accounts",
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/seed-accounts/*",
      ])
    )
    error_message = "The ecs_task role must be granted ssm:GetParametersByPath on both the bare seed-accounts path ARN and its /* form - the bare form alone or the /* form alone is each individually insufficient for this action."
  }
}

run "verify_execution_role_container_secrets_scoped" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_execution_secrets]
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.ecs_task_execution_secrets.policy).Statement[0].Action == "ssm:GetParameters"
      && toset(jsondecode(aws_iam_role_policy.ecs_task_execution_secrets.policy).Statement[0].Resource) == toset([
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/postgres-password",
        "arn:aws:ssm:us-east-1:111111111111:parameter/staging-odoo/tailscale-authkey",
      ])
    )
    error_message = "The execution role's ssm:GetParameters grant must be scoped to exactly the postgres-password and tailscale-authkey parameters - these (and only these) are resolved via ECS-native container secrets."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_execution_secrets.policy).Statement[1].Resource == var.staging_odoo_secrets_kms_key_arn
    error_message = "The execution role's kms:Decrypt grant must be scoped to exactly var.staging_odoo_secrets_kms_key_arn."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_execution_secrets.role == aws_iam_role.ecs_task_execution.id
    error_message = "The container-secrets grant must attach to staging Odoo's own ECS task execution role, not the task role."
  }
}
