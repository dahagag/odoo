# ---------------------------------------------------------------------------
# Shared log-forwarding Lambda (ADR-0023) — declared once here, not per Trial Org. Each Trial
# Org's log group subscription filter (infra/modules/trial_org) targets this one function's ARN.
# ---------------------------------------------------------------------------

data "archive_file" "log_forwarder" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/log_forwarder"
  output_path = "${path.module}/.build/log_forwarder.zip"
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "log_forwarder" {
  name               = "${var.environment}-log-forwarder"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "log_forwarder_basic" {
  role       = aws_iam_role.log_forwarder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "log_forwarder" {
  statement {
    sid    = "ReadWebhookSecrets"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.log_forwarder_webhook_url_ssm_parameter}",
      "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.log_forwarder_hmac_secret_ssm_parameter}",
    ]
  }
}

resource "aws_iam_role_policy" "log_forwarder" {
  name   = "${var.environment}-log-forwarder"
  role   = aws_iam_role.log_forwarder.id
  policy = data.aws_iam_policy_document.log_forwarder.json
}

resource "aws_lambda_function" "log_forwarder" {
  function_name    = "${var.environment}-log-forwarder"
  role             = aws_iam_role.log_forwarder.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 15
  filename         = data.archive_file.log_forwarder.output_path
  source_code_hash = data.archive_file.log_forwarder.output_base64sha256

  environment {
    variables = {
      WEBHOOK_URL_SSM_PARAMETER = var.log_forwarder_webhook_url_ssm_parameter
      HMAC_SECRET_SSM_PARAMETER = var.log_forwarder_hmac_secret_ssm_parameter
    }
  }

  tags = local.tags
}

# CloudWatch Logs is the only allowed invoker — one subscription filter per Trial Org log group,
# all pointing at this same function (granted broadly here since the source ARN condition below
# still restricts it to this account's log groups; per-Trial-Org restriction isn't expressible on
# a resource-based Lambda policy without one statement per trial, which would defeat the "declare
# the Lambda once" goal this ADR is explicit about).
resource "aws_lambda_permission" "log_forwarder_from_cloudwatch" {
  statement_id   = "AllowCloudWatchLogsInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.log_forwarder.function_name
  principal      = "logs.amazonaws.com"
  source_account = local.account_id
  source_arn     = "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/hosting/trial-orgs/*:*"
}

# ---------------------------------------------------------------------------
# Stale-lock cleanup Lambda (ADR-0020), invoked by the EventBridge rule in eventbridge.tf.
# ---------------------------------------------------------------------------

data "archive_file" "lock_cleanup" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/lock_cleanup"
  output_path = "${path.module}/.build/lock_cleanup.zip"
}

resource "aws_iam_role" "lock_cleanup" {
  name               = "${var.environment}-lock-cleanup"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lock_cleanup_basic" {
  role       = aws_iam_role.lock_cleanup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lock_cleanup" {
  statement {
    sid       = "ReleaseStaleLock"
    effect    = "Allow"
    actions   = ["dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.trial_org_lock.arn]
  }
}

resource "aws_iam_role_policy" "lock_cleanup" {
  name   = "${var.environment}-lock-cleanup"
  role   = aws_iam_role.lock_cleanup.id
  policy = data.aws_iam_policy_document.lock_cleanup.json
}

resource "aws_lambda_function" "lock_cleanup" {
  function_name    = "${var.environment}-lock-cleanup"
  role             = aws_iam_role.lock_cleanup.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 15
  filename         = data.archive_file.lock_cleanup.output_path
  source_code_hash = data.archive_file.lock_cleanup.output_base64sha256

  environment {
    variables = {
      LOCK_TABLE_NAME = aws_dynamodb_table.trial_org_lock.name
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# EC2 power-control Lambda for Suspend/Wake (ADR-0021), invoked by the state machine's own Task
# state — see state_machine.asl.json.tftpl.
# ---------------------------------------------------------------------------

data "archive_file" "ec2_power_control" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/ec2_power_control"
  output_path = "${path.module}/.build/ec2_power_control.zip"
}

resource "aws_iam_role" "ec2_power_control" {
  name               = "${var.environment}-ec2-power-control"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ec2_power_control_basic" {
  role       = aws_iam_role.ec2_power_control.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "ec2_power_control" {
  statement {
    sid    = "ControlTrialOrgInstancePower"
    effect = "Allow"
    actions = [
      "ec2:StartInstances",
      "ec2:StopInstances",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/ManagedBy"
      values   = ["opentofu"]
    }
  }

  # Describe* actions don't support resource-level permissions/tag conditions (AWS EC2 IAM
  # reference), so this is necessarily an account-wide read-only grant, used only by the waiter
  # to poll the instance this function itself just started/stopped.
  statement {
    sid    = "DescribeInstancesForWaiter"
    effect = "Allow"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ec2_power_control" {
  name   = "${var.environment}-ec2-power-control"
  role   = aws_iam_role.ec2_power_control.id
  policy = data.aws_iam_policy_document.ec2_power_control.json
}

resource "aws_lambda_function" "ec2_power_control" {
  function_name    = "${var.environment}-ec2-power-control"
  role             = aws_iam_role.ec2_power_control.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 600 # boto3 EC2 waiters here can take up to ~10 minutes to reach target state
  filename         = data.archive_file.ec2_power_control.output_path
  source_code_hash = data.archive_file.ec2_power_control.output_base64sha256

  tags = local.tags
}
