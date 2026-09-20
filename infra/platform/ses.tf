# SES domain identity for the administration-stack API's outbound magic-link email (#327,
# SesEmailSender). Lives in the Platform Account alongside the ECS task that sends through it
# (ecs_task.tf) — unlike infra/foundation's Route53 zone (a different, Hosting Account resource,
# dns.tf), this module has no DNS zone of its own to attach verification records to
# automatically, so domain verification is the same "manual, one-time" step infra/foundation's
# Route53 delegation already is (tracked alongside the apply itself, infra/README.md) — the
# ses_domain_verification_record/ses_dkim_tokens outputs (outputs.tf) are what gets added to that
# domain's real DNS zone to complete it.

variable "ses_sending_domain" {
  type        = string
  description = "Domain SES sends magic-link email from (SesEmailSender's SES_FROM_ADDRESS is an address under this domain, #327), e.g. \"notifications.method.factory1.io\"."
  default     = "notifications.method.factory1.io"
}

resource "aws_ses_domain_identity" "sender" {
  domain = var.ses_sending_domain
}

# DKIM signing - a bare domain identity only proves domain ownership; without this, real inbox
# providers (Gmail, etc.) are far more likely to flag mail from this domain as spam or reject it
# outright as unauthenticated.
resource "aws_ses_domain_dkim" "sender" {
  domain = aws_ses_domain_identity.sender.domain
}

# ---------------------------------------------------------------------------
# ses:SendEmail permission for the administration-stack API's own task role (iam.tf's
# aws_iam_role.ecs_task) - scoped to this one verified identity, never "*", so a compromised task
# can send mail as this domain and nothing else.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_ses_send" {
  statement {
    effect = "Allow"
    # Only ses:SendEmail - SesEmailSender/AwsSdkSesGateway calls SendEmailCommand, never a raw
    # MIME message, so ses:SendRawEmail would be an unused, broader-than-needed grant.
    actions   = ["ses:SendEmail"]
    resources = [aws_ses_domain_identity.sender.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_ses_send" {
  name   = "${var.environment}-administration-stack-api-ses-send"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_ses_send.json
}
