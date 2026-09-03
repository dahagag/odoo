# ---------------------------------------------------------------------------
# hosting_admin-facing role (ADR-0019, ADR-0022, ADR-0023)
#
# Assumed cross-account from the Platform Account by hosting_admin's own native role. Narrow by
# design: hosting_admin only ever starts/reads Step Functions executions and reads Trial Org log
# groups — it never touches EC2/S3/DynamoDB directly (those belong to the state machine's own
# execution role and the ECS task role below).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "hosting_admin_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.hosting_admin_trusted_role_arn]
    }
  }
}

resource "aws_iam_role" "hosting_admin" {
  name                 = "${var.environment}-hosting-admin"
  assume_role_policy   = data.aws_iam_policy_document.hosting_admin_trust.json
  max_session_duration = 3600

  tags = local.tags
}

data "aws_iam_policy_document" "hosting_admin" {
  # states:StartExecution and states:DescribeExecution/GetExecutionHistory are scoped to
  # different resource types (state machine vs. execution ARN) per AWS's own Step Functions IAM
  # reference — kept as separate statements rather than one over-broad one (ADR-0019).
  statement {
    sid       = "StartTrialOrgLifecycleExecution"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.trial_org_lifecycle.arn]
  }

  statement {
    sid    = "ReadTrialOrgLifecycleExecutions"
    effect = "Allow"
    actions = [
      "states:DescribeExecution",
      "states:GetExecutionHistory",
    ]
    resources = ["${replace(aws_sfn_state_machine.trial_org_lifecycle.arn, ":stateMachine:", ":execution:")}:*"]
  }

  # Per-Trial-Org live log viewer (ADR-0023). Scoped to this account's Trial Org log group naming
  # convention (see modules/trial_org's aws_cloudwatch_log_group), not every log group in the
  # account.
  statement {
    sid    = "ReadTrialOrgLogs"
    effect = "Allow"
    actions = [
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/hosting/trial-orgs/*",
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/hosting/trial-orgs/*:*",
    ]
  }
}

resource "aws_iam_role_policy" "hosting_admin" {
  name   = "${var.environment}-hosting-admin"
  role   = aws_iam_role.hosting_admin.id
  policy = data.aws_iam_policy_document.hosting_admin.json
}

# ---------------------------------------------------------------------------
# Step Functions execution role (assumed by states.amazonaws.com)
#
# Broader than hosting_admin's role by necessity (it acquires/releases the DynamoDB lock, runs
# the ECS tofu task, and drives the EC2 power-state Lambda) but still resource-scoped: no "*"
# resource except where the AWS service genuinely requires it (the runTask.sync EventBridge rule
# it manages for itself).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "sfn_execution_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sfn_execution" {
  name               = "${var.environment}-trial-org-lifecycle-sfn"
  assume_role_policy = data.aws_iam_policy_document.sfn_execution_trust.json

  tags = local.tags
}

data "aws_iam_policy_document" "sfn_execution" {
  statement {
    sid    = "RunTofuRunnerTask"
    effect = "Allow"
    actions = [
      "ecs:RunTask",
      "ecs:StopTask",
      "ecs:DescribeTasks",
    ]
    resources = [
      aws_ecs_task_definition.tofu_runner.arn,
      # ecs:RunTask permits any active revision of the family unless pinned; StopTask/DescribeTasks
      # need the task ARN pattern within this cluster.
      "arn:aws:ecs:${var.aws_region}:${local.account_id}:task/${aws_ecs_cluster.hosting.name}/*",
    ]
  }

  # Required by AWS for the ecs:runTask.sync integration to manage its own completion-polling rule.
  statement {
    sid    = "ManageRunTaskSyncEventRule"
    effect = "Allow"
    actions = [
      "events:PutTargets",
      "events:PutRule",
      "events:DescribeRule",
    ]
    resources = [
      "arn:aws:events:${var.aws_region}:${local.account_id}:rule/StepFunctionsGetEventsForECSTaskRule",
    ]
  }

  statement {
    sid       = "PassEcsRolesToRunningTask"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
  }

  statement {
    sid    = "InvokeLifecycleLambdas"
    effect = "Allow"
    actions = [
      "lambda:InvokeFunction",
    ]
    resources = [
      aws_lambda_function.ec2_power_control.arn,
      aws_lambda_function.lock_acquire.arn,
    ]
  }

  # Required by AWS for a state machine's own execution-history logging_configuration.
  statement {
    sid    = "DeliverExecutionLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }

  # DynamoDB lifecycle lock (ADR-0020): conditional PutItem to acquire, conditional Delete to
  # release. GetItem is used by the cleanup path to check current ownership before deleting.
  statement {
    sid    = "TrialOrgLifecycleLock"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
    ]
    resources = [aws_dynamodb_table.trial_org_lock.arn]
  }
}

resource "aws_iam_role_policy" "sfn_execution" {
  name   = "${var.environment}-trial-org-lifecycle-sfn"
  role   = aws_iam_role.sfn_execution.id
  policy = data.aws_iam_policy_document.sfn_execution.json
}

# ---------------------------------------------------------------------------
# ECS task execution role (standard: pull the tofu-runner image, write task logs).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.environment}-tofu-runner-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---------------------------------------------------------------------------
# ECS task role: the identity `tofu` itself runs as inside the container. This is the broadest
# role in the foundation because it's what actually creates/destroys each Trial Org's
# infrastructure (EC2, security group, log group, DNS record, IAM instance profile) plus reads/
# writes OpenTofu's own remote state. Scoped with aws:ResourceTag / aws:RequestTag ABAC
# conditions to the Trial Org each invocation targets, per ADR-0019.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name               = "${var.environment}-tofu-runner-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json

  tags = local.tags
}

data "aws_iam_policy_document" "ecs_task" {
  # OpenTofu's own remote state for the per-trial module: one object per Trial Org under
  # trial-orgs/<trial_org_id>/terraform.tfstate, plus the S3-backend DynamoDB lock table.
  statement {
    sid    = "TofuStateBackend"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.tofu_state_bucket}/trial-orgs/*"]
  }

  statement {
    sid       = "TofuStateBackendListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.tofu_state_bucket}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["trial-orgs/*"]
    }
  }

  statement {
    sid    = "TofuStateLockTable"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.tofu_state_lock_table}"]
  }

  # EC2 resources the per-trial module manages. Create/tag actions are scoped by the tag the
  # request itself carries (aws:RequestTag) since the resource doesn't exist yet to carry a tag
  # of its own; actions against an existing resource are scoped by the tag it already carries
  # (aws:ResourceTag). Both require TrialOrgId to be present, which the per-trial module always
  # sets (infra/modules/trial_org/main.tf).
  statement {
    sid    = "ManageTrialOrgEc2Create"
    effect = "Allow"
    actions = [
      "ec2:RunInstances",
      "ec2:CreateSecurityGroup",
      "ec2:CreateTags",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/ManagedBy"
      values   = ["opentofu"]
    }
  }

  statement {
    sid    = "ManageTrialOrgEc2Existing"
    effect = "Allow"
    actions = [
      "ec2:TerminateInstances",
      "ec2:StopInstances",
      "ec2:StartInstances",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/ManagedBy"
      values   = ["opentofu"]
    }
  }

  # Read-only EC2 describes have no per-resource tag scoping in the IAM action reference
  # (Describe* actions do not support resource-level permissions), so they're granted broadly;
  # this is a read-only grant, not a mutation.
  statement {
    sid    = "DescribeEc2"
    effect = "Allow"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcs",
      "ec2:DescribeImages",
      "ec2:DescribeNetworkInterfaces",
    ]
    resources = ["*"]
  }

  # Per-Trial-Org CloudWatch log group + subscription filter (ADR-0023).
  statement {
    sid    = "ManageTrialOrgLogGroups"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:PutSubscriptionFilter",
      "logs:DeleteSubscriptionFilter",
      "logs:DescribeLogGroups",
      "logs:DescribeSubscriptionFilters",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/hosting/trial-orgs/*",
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/hosting/trial-orgs/*:*",
    ]
  }

  # Per-Trial-Org narrow instance role + instance profile (ADR-0021). Scoped to the naming
  # convention the trial_org module uses, not a bare "*" — see locals.tf.
  statement {
    sid    = "ManageTrialOrgInstanceRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:TagRole",
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:GetInstanceProfile",
    ]
    resources = [
      "arn:aws:iam::${local.account_id}:role/${local.trial_org_role_name_prefix}*${local.trial_org_role_name_suffix}",
      "arn:aws:iam::${local.account_id}:instance-profile/${local.trial_org_role_name_prefix}*${local.trial_org_role_name_suffix}",
    ]
  }

  # iam:PassRole so RunInstances can attach the per-Trial-Org instance profile. Scoped to the
  # same narrow naming convention and to EC2 as the only service allowed to assume it (never a
  # wildcard across arbitrary roles) — the ADR-0021 "never one without the other" boundary,
  # applied at the granularity available at foundation-apply-time (a per-trial-exact ARN can't be
  # enumerated here since each role is created by this same task at trial-provisioning time).
  statement {
    sid       = "PassTrialOrgInstanceRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.trial_org_role_name_prefix}*${local.trial_org_role_name_suffix}"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ec2.amazonaws.com"]
    }
  }

  # Per-Trial-Org DNS record under the shared zone.
  statement {
    sid       = "ManageTrialOrgDnsRecords"
    effect    = "Allow"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [aws_route53_zone.root.arn]
  }

  statement {
    sid       = "ReadTrialOrgDnsRecords"
    effect    = "Allow"
    actions   = ["route53:GetChange", "route53:ListResourceRecordSets"]
    resources = ["arn:aws:route53:::change/*", aws_route53_zone.root.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "${var.environment}-tofu-runner-task"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task.json
}
