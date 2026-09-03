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

    task_timeout_seconds          = var.sfn_task_timeout_seconds
    ec2_power_timeout_seconds     = var.ec2_power_timeout_seconds
    lambda_invoke_timeout_seconds = var.lambda_invoke_timeout_seconds

    retry_max_attempts          = var.sfn_retry_max_attempts
    retry_backoff_rate          = var.sfn_retry_backoff_rate
    retry_interval_seconds      = var.sfn_retry_interval_seconds
    lock_retry_max_attempts     = var.lock_retry_max_attempts
    lock_retry_interval_seconds = var.lock_retry_interval_seconds
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.state_machine.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }
}

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = "/aws/vendedlogs/states/${var.state_machine_name}"
  retention_in_days = var.log_retention_days
}
