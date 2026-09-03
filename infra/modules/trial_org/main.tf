# ---------------------------------------------------------------------------
# CloudWatch log group + subscription filter (ADR-0021, ADR-0023)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "trial_org" {
  name              = local.log_group_name
  retention_in_days = var.log_group_retention_days

  tags = local.tags
}

resource "aws_cloudwatch_log_subscription_filter" "to_log_forwarder" {
  name            = "log-forwarder"
  log_group_name  = aws_cloudwatch_log_group.trial_org.name
  filter_pattern  = "" # forward every line; the shared Lambda/Odoo side does its own filtering
  destination_arn = var.log_forwarder_lambda_arn
}

# ---------------------------------------------------------------------------
# Narrow instance profile (ADR-0021 Update): logs:PutLogEvents/CreateLogStream only, scoped to
# this Trial Org's own log group. No broader AWS API access of any kind.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "instance_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name                 = local.instance_role_name
  assume_role_policy   = data.aws_iam_policy_document.instance_trust.json
  permissions_boundary = var.instance_role_permissions_boundary_arn

  tags = local.tags
}

data "aws_iam_policy_document" "instance_logs_only" {
  statement {
    sid    = "PushOwnLogsOnly"
    effect = "Allow"
    actions = [
      "logs:PutLogEvents",
      "logs:CreateLogStream",
    ]
    resources = [
      aws_cloudwatch_log_group.trial_org.arn,
      "${aws_cloudwatch_log_group.trial_org.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "instance_logs_only" {
  name   = "logs-only"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance_logs_only.json
}

resource "aws_iam_instance_profile" "instance" {
  name = local.instance_role_name
  role = aws_iam_role.instance.name

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Security group
# ---------------------------------------------------------------------------

resource "aws_security_group" "instance" {
  name        = "trial-org-${var.trial_org_id}"
  description = "Trial Org ${var.trial_org_id}'s Odoo instance security group."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidr_blocks
  }

  ingress {
    description = "HTTP (redirected to HTTPS by the instance's own web server config)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidr_blocks
  }

  egress {
    description = "All outbound (package updates, CloudWatch Logs, Odoo outbound integrations)."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "trial-org-${var.trial_org_id}" })
}

# ---------------------------------------------------------------------------
# EC2 instance
#
# Deliberately declares no opinion on running/stopped power state (ADR-0021): OpenTofu owns
# create/destroy only. Suspend/Wake call the EC2 API directly outside of this module, so a later
# `tofu apply` here (e.g. picking up a change to instance_type) must never be able to silently
# start a Suspended instance back up. The AWS provider's aws_instance resource has no
# power-state argument to begin with, so this is the default behavior — the point of this
# comment (and of not adding one) is to keep it that way deliberately, not by omission.
# ---------------------------------------------------------------------------

resource "aws_instance" "trial_org" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.instance.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted = true
  }

  tags = merge(local.tags, { Name = "trial-org-${var.trial_org_id}" })

  # No `lifecycle` block, deliberately: power state (running/stopped) is owned exclusively by
  # the state machine's Suspend/Wake Task state (ADR-0021), never by OpenTofu, and the AWS
  # provider's aws_instance resource has no power-state argument to begin with — so there's
  # nothing here that could reassert a running/stopped assumption on a later `tofu apply`.
}

# ---------------------------------------------------------------------------
# Elastic IP
#
# Suspend/Wake stop/start this instance directly via the EC2 API, outside of OpenTofu (ADR-0021).
# Without an EIP, StopInstances releases the instance's public IP and StartInstances assigns a
# new one, silently staling out the DNS record below until the next `tofu apply` happened to
# notice — an EIP keeps the address (and therefore the DNS record) stable across every
# Suspend/Wake power cycle.
# ---------------------------------------------------------------------------

resource "aws_eip" "trial_org" {
  domain = "vpc"

  tags = merge(local.tags, { Name = "trial-org-${var.trial_org_id}" })
}

resource "aws_eip_association" "trial_org" {
  instance_id   = aws_instance.trial_org.id
  allocation_id = aws_eip.trial_org.id
}

# ---------------------------------------------------------------------------
# DNS record
# ---------------------------------------------------------------------------

resource "aws_route53_record" "trial_org" {
  zone_id = var.route53_zone_id
  name    = local.domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.trial_org.public_ip]
}
