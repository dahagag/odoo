locals {
  tags = merge(var.tags, {
    Environment = var.environment
    TofuModule  = "foundation"
  })

  account_id = data.aws_caller_identity.current.account_id

  # Naming convention the trial_org module's per-Trial-Org instance role follows
  # (trial-<trial_org_id>-ec2-logs — matches ADR-0019's trial-<trial_org_id>-<job_id> execution-name
  # convention). The ECS task role's iam:PassRole grant below is scoped to this pattern rather than
  # a bare "*" — see iam.tf for the full reasoning.
  trial_org_role_name_prefix = "trial-"
  trial_org_role_name_suffix = "-ec2-logs"

  # Naming convention every Trial Org's own CloudWatch log group follows
  # (/hosting/trial-orgs/<trial_org_id>, set by infra/modules/trial_org and passed to it here as
  # var.trial_org_log_group_prefix so both modules agree on one convention instead of hardcoding
  # it independently in two places).
  trial_org_log_group_arn_prefix = "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:${var.trial_org_log_group_prefix}"

  # Container name shared between the ECS task definition (ecs_task.tf) and the state machine's
  # RunTask ContainerOverrides (state_machine.tf) — kept in one place so the two can never drift.
  tofu_runner_container_name = "tofu-runner"

  # Total wait time across sfn_retry_max_attempts retries of the RunTofu Task state
  # (state_machine.tf), given Step Functions' own IntervalSeconds * BackoffRate^(attempt-1)
  # backoff formula (CodeRabbit, PR #171). BackoffRate == 1 is a documented, valid Step Functions
  # value meaning "retry at a constant interval, don't back off" - the geometric-series closed
  # form below divides by (BackoffRate - 1), so that case is branched off separately instead of
  # dividing by zero.
  run_tofu_retry_wait_seconds = var.sfn_retry_backoff_rate == 1 ? (
    var.sfn_retry_interval_seconds * var.sfn_retry_max_attempts
  ) : (
    var.sfn_retry_interval_seconds * (pow(var.sfn_retry_backoff_rate, var.sfn_retry_max_attempts) - 1) / (var.sfn_retry_backoff_rate - 1)
  )

  # RunTofu's own worst-case total duration: every attempt (the original plus every retry) runs
  # to its full TimeoutSeconds, plus the backoff waits between them - the exact bound
  # trial_org_execution_session_duration_seconds (variables.tf) must cover so a retried tofu
  # apply never runs with expired STS credentials (CodeRabbit, PR #171). Enforced by
  # aws_sfn_state_machine.trial_org_lifecycle's own lifecycle.precondition in state_machine.tf.
  run_tofu_worst_case_seconds = (
    var.sfn_task_timeout_seconds * (var.sfn_retry_max_attempts + 1) + local.run_tofu_retry_wait_seconds
  )
}

data "aws_caller_identity" "current" {}
