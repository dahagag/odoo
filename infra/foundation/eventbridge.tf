# Stale-lock cleanup (ADR-0020): a Catch block only handles errors *within* the state machine's
# own states, so an execution stopped externally (StopExecution) or timed out at the top level
# never reaches ReleaseLockOnFailure. This rule catches exactly those cases via EventBridge's
# native Step Functions execution status change events.
resource "aws_cloudwatch_event_rule" "trial_org_lifecycle_failure" {
  name        = "${var.environment}-trial-org-lifecycle-stale-lock"
  description = "Releases the Trial Org lifecycle lock for executions a state-machine Catch block can't reach (externally stopped or top-level timed out)."

  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      status          = ["FAILED", "ABORTED", "TIMED_OUT"]
      stateMachineArn = [aws_sfn_state_machine.trial_org_lifecycle.arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "trial_org_lifecycle_failure_cleanup" {
  rule      = aws_cloudwatch_event_rule.trial_org_lifecycle_failure.name
  target_id = "lock-cleanup-lambda"
  arn       = aws_lambda_function.lock_cleanup.arn
}

resource "aws_lambda_permission" "lock_cleanup_from_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lock_cleanup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trial_org_lifecycle_failure.arn
}

# Snapshot-retention cleanup (#174): AWS has no native TTL for ad-hoc EBS snapshots, so this
# schedule is the only thing that ever deletes a snapshot snapshot_manager created once its
# DeleteAfter tag has passed.
resource "aws_cloudwatch_event_rule" "snapshot_cleanup" {
  name                = "${var.environment}-trial-org-snapshot-cleanup"
  description         = "Daily sweep deleting Trial Org auto-destroy EBS snapshots past their DeleteAfter tag."
  schedule_expression = var.snapshot_cleanup_schedule_expression
}

resource "aws_cloudwatch_event_target" "snapshot_cleanup" {
  rule      = aws_cloudwatch_event_rule.snapshot_cleanup.name
  target_id = "snapshot-cleanup-lambda"
  arn       = aws_lambda_function.snapshot_cleanup.arn
}

resource "aws_lambda_permission" "snapshot_cleanup_from_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.snapshot_cleanup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.snapshot_cleanup.arn
}
