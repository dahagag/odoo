# Cost dashboard threshold/exhaustion-horizon alerting (this ticket, #198, ADR-0030's amendment:
# "alerting is emitted to an SNS topic with email subscribed ... so another channel can be added
# later without changing the code that emits them"). Lives alongside the ECS task that publishes
# through it (ecs_task.tf), mirroring ses.tf's own "one AWS capability, one file" shape.

variable "cost_alert_email" {
  type        = string
  description = "Email address SNS subscribes for cost-dashboard threshold/horizon alerts (this ticket, #198)."
  default     = "hosting-ops@factory1.tech"
}

resource "aws_sns_topic" "cost_alerts" {
  name = "${var.environment}-cost-alerts"
}

resource "aws_sns_topic_subscription" "cost_alerts_email" {
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "email"
  endpoint  = var.cost_alert_email
}

# ---------------------------------------------------------------------------
# sns:Publish permission for the administration-stack API's own task role (iam.tf's
# aws_iam_role.ecs_task) - scoped to this one topic, never "*", mirroring ecs_task_ses_send's own
# single-resource scoping (ses.tf).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_sns_publish" {
  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.cost_alerts.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_sns_publish" {
  name   = "${var.environment}-administration-stack-api-sns-publish"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_sns_publish.json
}

# ---------------------------------------------------------------------------
# ce:GetCostAndUsage permission for the same task role (this ticket, #198). Cost Explorer's API
# has no resource-level scoping at all (its actions only ever accept "*" as the resource) - this
# is a property of the AWS API itself, not a scoping omission on this grant's part.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_cost_explorer_read" {
  statement {
    effect  = "Allow"
    actions = ["ce:GetCostAndUsage"]
    # Cost Explorer does not support resource-level permissions for this action - every AWS
    # example and SDK caller scopes this the same way; "*" here is inherent to the API, not a
    # broader-than-needed grant.
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task_cost_explorer_read" {
  name   = "${var.environment}-administration-stack-api-cost-explorer-read"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_cost_explorer_read.json
}
