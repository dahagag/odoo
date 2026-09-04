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
