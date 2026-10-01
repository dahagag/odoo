# ---------------------------------------------------------------------------
# ECS task execution role: pulls the postgres/odoo/tailscale images, writes task logs, and
# resolves the two ECS-native `secrets` (postgres password, Tailscale auth key) at container
# start. Mirrors infra/platform/iam.tf's ecs_task_execution role.
#
# No statement in this file, or anywhere else in this module, grants any sts:AssumeRole (or any
# other action) against a Hosting Account principal or resource — this module's own provider is
# the only cross-account relationship it has, and that's this module assuming *into* the Platform
# Account (providers.tf), never the reverse. Staging must have no credential or network path into
# the Hosting Account (#203's own constraint; ADR-0040).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.environment}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS requires ssm:GetParameters (plural) on the execution role to resolve a container
# definition's own `secrets` entries at task start — distinct from the task role's singular
# ssm:GetParameter grant below, which the application itself calls at runtime.
data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  statement {
    sid    = "ResolveContainerSecretsAtStart"
    effect = "Allow"
    actions = [
      "ssm:GetParameters",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.postgres_password_ssm_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.tailscale_authkey_ssm_parameter_name}",
    ]
  }

  # Both parameters above are SecureString, encrypted under the same key — scoped to exactly
  # that one key, never "*" or the default alias/aws/ssm key implicitly.
  statement {
    sid       = "DecryptContainerSecretsAtStart"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.staging_odoo_secrets_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name   = "${var.environment}-execution-secrets"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets.json
}

# ---------------------------------------------------------------------------
# ECS task role: the identity the staging Odoo container's own instance-metadata credential
# chain resolves to. Its only standing grant is reading the admin/seed-account password
# SecureString parameters at runtime — exactly infra/foundation/lambda_src/log_forwarder's
# existing SecureString + `GetParameter --with-decryption` shape
# (infra/foundation/lambda.tf's log_forwarder IAM policy document), applied here for the staging
# entrypoint's own post-install password-seeding step (#338) instead of the webhook secret.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name               = "${var.environment}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json
}

data "aws_iam_policy_document" "ecs_task_seed_secrets" {
  statement {
    sid    = "ReadSeedAccountSecrets"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.odoo_admin_password_ssm_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.seed_account_password_ssm_parameter_path}/*",
    ]
  }

  # Same KMS key as the execution role's own decrypt grant above — scoped to exactly that one
  # key, never "*" or the default alias/aws/ssm key implicitly.
  statement {
    sid       = "DecryptSeedAccountSecrets"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.staging_odoo_secrets_kms_key_arn]
  }

  # docker/odoo-staging-entrypoint.sh's seed step calls `aws ssm get-parameters-by-path`
  # (plural, recursive) to enumerate every seed-account password under the path prefix —
  # a distinct IAM action from the singular ssm:GetParameter grant above, which only covers
  # fetching one already-known parameter name.
  statement {
    sid     = "ListSeedAccountSecretsByPath"
    effect  = "Allow"
    actions = ["ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.seed_account_password_ssm_parameter_path}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ecs_task_seed_secrets" {
  name   = "${var.environment}-task-seed-secrets"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_seed_secrets.json
}

# ---------------------------------------------------------------------------
# ECS Exec channel (#342): the task role itself (not the execution role) must grant the
# ssmmessages actions AWS's ECS Exec agent uses to open its control/data channel back to the
# caller of `aws ecs execute-command` - this is the documented, resource-unscoped (ssmmessages
# has no resource-level permissions) grant AWS's own ECS Exec setup requires, not a broader
# SSM Session Manager grant against arbitrary instances/documents. It exists so the
# deploy-odoo-staging CI job can run dev_e2e_smoke_test's post-deploy assertions inside the
# already-running container over the ECS/SSM control plane, since ADR-0040 leaves no network
# path (no ALB, no public DNS, CI runner not on the tailnet) for an ordinary HTTP-based smoke
# check to reach this task at all.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_exec" {
  statement {
    sid    = "AllowEcsExecChannel"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task_exec" {
  name   = "${var.environment}-task-exec"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_exec.json
}
