# ---------------------------------------------------------------------------
# Trial Org lifecycle state machine (ADR-0016, ADR-0019, ADR-0020, ADR-0021).
# The lock_acquire/ec2_power_control/lock_cleanup Lambdas this state machine invokes are declared
# in lambda.tf alongside the shared log-forwarding Lambda, for one consistent
# file-per-resource-type layout across the module.
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
    tofu_runner_container_name      = local.tofu_runner_container_name
    tofu_runner_security_group_id   = aws_security_group.tofu_runner.id
    private_subnet_ids_json         = jsonencode(aws_subnet.private[*].id)
    trial_org_execution_role_arn    = aws_iam_role.trial_org_execution.arn

    task_timeout_seconds                         = var.sfn_task_timeout_seconds
    ec2_power_timeout_seconds                    = var.ec2_power_timeout_seconds
    lambda_invoke_timeout_seconds                = var.lambda_invoke_timeout_seconds
    sts_assume_role_timeout_seconds              = var.sts_assume_role_timeout_seconds
    trial_org_execution_session_duration_seconds = var.trial_org_execution_session_duration_seconds

    retry_max_attempts          = var.sfn_retry_max_attempts
    retry_backoff_rate          = var.sfn_retry_backoff_rate
    retry_interval_seconds      = var.sfn_retry_interval_seconds
    lock_retry_max_attempts     = var.lock_retry_max_attempts
    lock_retry_interval_seconds = var.lock_retry_interval_seconds
  })

  logging_configuration {
    log_destination = "${aws_cloudwatch_log_group.state_machine.arn}:*"
    # false: execution input/output (trial_org_id, job_id, and — on Suspend/Wake — instance_id)
    # are tenant-identifying and must not land in the retained CloudWatch log group. Operators
    # needing execution-level detail can still use states:GetExecutionHistory; state-transition
    # logging itself (level = "ALL") is unaffected.
    include_execution_data = false
    level                  = "ALL"
  }
}

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = "/aws/vendedlogs/states/${var.state_machine_name}"
  retention_in_days = var.log_retention_days
}

# Fails `tofu plan`/`apply` if a future change to RunTofu's own timeout/retry variables reopens
# the expired-credentials gap trial_org_execution_session_duration_seconds's description warns
# about (CodeRabbit, PR #171): a `check` block (Terraform >= 1.5) rather than a `variable`
# `validation` block, since validation blocks can only reference other variables from Terraform
# >= 1.9 and this module's required_version (versions.tf) is >= 1.8.0.
check "trial_org_execution_session_covers_run_tofu_worst_case" {
  assert {
    condition = var.trial_org_execution_session_duration_seconds >= (
      var.sfn_task_timeout_seconds * (var.sfn_retry_max_attempts + 1)
      + var.sfn_retry_interval_seconds * (pow(var.sfn_retry_backoff_rate, var.sfn_retry_max_attempts) - 1) / (var.sfn_retry_backoff_rate - 1)
    )
    error_message = "trial_org_execution_session_duration_seconds must cover RunTofu's worst-case total duration (sfn_task_timeout_seconds * (sfn_retry_max_attempts + 1), plus the BackoffRate-compounded IntervalSeconds waits between attempts) or a retried tofu apply can run with expired STS credentials."
  }
}
