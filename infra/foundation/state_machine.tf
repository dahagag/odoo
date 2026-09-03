# ---------------------------------------------------------------------------
# Lock-acquire Lambda (see lambda_src/lock_acquire) — separate from the shared log-forwarding
# and stale-lock-cleanup Lambdas above, invoked only by AcquireLock in the state machine itself.
# ---------------------------------------------------------------------------

data "archive_file" "lock_acquire" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src/lock_acquire"
  output_path = "${path.module}/.build/lock_acquire.zip"
}

resource "aws_iam_role" "lock_acquire" {
  name               = "${var.environment}-lock-acquire"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lock_acquire_basic" {
  role       = aws_iam_role.lock_acquire.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lock_acquire" {
  statement {
    sid       = "AcquireTrialOrgLock"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.trial_org_lock.arn]
  }
}

resource "aws_iam_role_policy" "lock_acquire" {
  name   = "${var.environment}-lock-acquire"
  role   = aws_iam_role.lock_acquire.id
  policy = data.aws_iam_policy_document.lock_acquire.json
}

resource "aws_lambda_function" "lock_acquire" {
  function_name    = "${var.environment}-lock-acquire"
  role             = aws_iam_role.lock_acquire.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.lock_acquire.output_path
  source_code_hash = data.archive_file.lock_acquire.output_base64sha256

  environment {
    variables = {
      LOCK_TABLE_NAME  = aws_dynamodb_table.trial_org_lock.name
      LOCK_TTL_SECONDS = tostring(var.lock_ttl_hours * 3600)
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Trial Org lifecycle state machine (ADR-0016, ADR-0019, ADR-0020, ADR-0021).
# ---------------------------------------------------------------------------

resource "aws_sfn_state_machine" "trial_org_lifecycle" {
  name     = var.state_machine_name
  role_arn = aws_iam_role.sfn_execution.arn
  type     = "STANDARD"

  definition = templatefile("${path.module}/state_machine.asl.json.tftpl", {
    lock_table_name                 = aws_dynamodb_table.trial_org_lock.name
    lock_acquire_lambda_arn         = aws_lambda_function.lock_acquire.arn
    ec2_power_control_lambda_arn    = aws_lambda_function.ec2_power_control.arn
    ecs_cluster_arn                 = aws_ecs_cluster.hosting.arn
    tofu_runner_task_definition_arn = aws_ecs_task_definition.tofu_runner.arn
    tofu_runner_container_name      = "tofu-runner"
    tofu_runner_security_group_id   = aws_security_group.tofu_runner.id
    private_subnet_ids_json         = jsonencode(aws_subnet.private[*].id)

    task_timeout_seconds          = var.sfn_task_timeout_seconds
    ec2_power_timeout_seconds     = 600
    lambda_invoke_timeout_seconds = 60

    retry_max_attempts          = var.sfn_retry_max_attempts
    retry_backoff_rate          = var.sfn_retry_backoff_rate
    retry_interval_seconds      = var.sfn_retry_interval_seconds
    lock_retry_max_attempts     = 5
    lock_retry_interval_seconds = 3
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.state_machine.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = "/aws/vendedlogs/states/${var.state_machine_name}"
  retention_in_days = var.lambda_log_retention_days

  tags = local.tags
}
