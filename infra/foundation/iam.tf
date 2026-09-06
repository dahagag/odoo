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

  # sts:TagSession lets hosting_admin pass a TrialOrgId session tag when it assumes this role to
  # view one specific Trial Org's execution history or logs. AWS Step Functions doesn't support
  # tagging individual executions (only state machines/activities), so per-Trial-Org scoping of
  # DescribeExecution/GetExecutionHistory/log reads (ADR-0022, ADR-0023) is expressed instead via
  # an IAM policy variable (${aws:PrincipalTag/TrialOrgId}) matched against the execution-name /
  # log-group-name convention below, populated from this session tag.
  statement {
    effect  = "Allow"
    actions = ["sts:TagSession"]

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

  # Scoped to the specific Trial Org each session is viewing (ADR-0022: "per-execution ARN,
  # resource-tag-conditioned to the specific Trial Org"). Executions aren't a taggable resource
  # type in Step Functions, so this uses the execution-name naming convention
  # (trial-<trial_org_id>-<job_id>, ADR-0019) plus the ${aws:PrincipalTag/TrialOrgId} policy
  # variable populated by the sts:TagSession call above — the practical equivalent of an
  # aws:ResourceTag condition for a resource type that has none.
  statement {
    sid    = "ReadTrialOrgLifecycleExecutions"
    effect = "Allow"
    actions = [
      "states:DescribeExecution",
      "states:GetExecutionHistory",
    ]
    resources = [
      "${replace(aws_sfn_state_machine.trial_org_lifecycle.arn, ":stateMachine:", ":execution:")}:trial-$${aws:PrincipalTag/TrialOrgId}-*",
    ]
  }

  # Per-Trial-Org live log viewer (ADR-0023): "resource-scoped per Trial Org's own log group ...
  # so a support employee viewing one org's live logs can't read another's." Same
  # PrincipalTag/TrialOrgId session-tag pattern as above, this time against a real
  # aws:ResourceTag-supporting resource type — the log group's own TrialOrgId tag (set in
  # infra/modules/trial_org) — so this one *is* a genuine resource-tag condition.
  statement {
    sid    = "ReadTrialOrgLogs"
    effect = "Allow"
    actions = [
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "${local.trial_org_log_group_arn_prefix}*",
      "${local.trial_org_log_group_arn_prefix}*:*",
    ]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/TrialOrgId"
      values   = ["$${aws:PrincipalTag/TrialOrgId}"]
    }
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

  # Issue #125: the AssumeTrialOrgExecutionRole Task state (state_machine.asl.json.tftpl) assumes
  # trial_org_execution on the ECS task's behalf, tagging the session with this invocation's own
  # TrialOrgId/DnsRecordName before RunTofu launches it - both sts:AssumeRole (identity-side) and
  # sts:TagSession are required for a session-tagged assume, on top of trial_org_execution's own
  # trust policy allowing this role as principal.
  statement {
    sid       = "AssumeTrialOrgExecutionRole"
    effect    = "Allow"
    actions   = ["sts:AssumeRole", "sts:TagSession"]
    resources = [aws_iam_role.trial_org_execution.arn]
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
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---------------------------------------------------------------------------
# ECS task role: the identity the tofu-runner container's own instance-metadata credential
# chain resolves to. Deliberately carries no inline policy at all (issue #125) - every AWS call
# `tofu apply` makes during a RunTofu invocation instead runs under trial_org_execution's
# per-invocation scoped-down credentials, injected as container environment overrides
# (state_machine.asl.json.tftpl's AssumeTrialOrgExecutionRole state; the AWS SDK/Terraform AWS
# provider credential chain prefers explicit AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/
# AWS_SESSION_TOKEN env vars over a container's own ECS task-role credentials). A compromised or
# buggy tofu-runner image that never assumes trial_org_execution therefore has zero standing AWS
# access under this role, rather than falling back to the shared task-wide permissions it used to
# carry directly.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name               = "${var.environment}-tofu-runner-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json
}

# Permissions boundary every per-Trial-Org instance role (created by the trial_org module, at
# runtime, by this same ECS task role) must be attached to. Caps what that role can ever hold —
# logs:PutLogEvents/CreateLogStream on its own Trial Org's log group, nothing else — as an
# IAM-enforced backstop on top of ADR-0021's "narrow, logs-only" module-code guarantee.
data "aws_iam_policy_document" "trial_org_instance_boundary" {
  statement {
    sid    = "PushOwnLogsOnlyBoundary"
    effect = "Allow"
    actions = [
      "logs:PutLogEvents",
      "logs:CreateLogStream",
    ]
    resources = [
      "${local.trial_org_log_group_arn_prefix}*",
      "${local.trial_org_log_group_arn_prefix}*:*",
    ]
  }
}

resource "aws_iam_policy" "trial_org_instance_boundary" {
  name        = "${var.environment}-trial-org-instance-boundary"
  description = "Permissions boundary attached to every per-Trial-Org EC2 instance role (ADR-0021): caps it at logs:PutLogEvents/CreateLogStream on its own log group, regardless of what the role's own inline policy grants."
  policy      = data.aws_iam_policy_document.trial_org_instance_boundary.json
}

# ---------------------------------------------------------------------------
# Trial Org execution role (issue #125, ADR-0031): the per-invocation identity RunTofu actually acts as.
# Assumed by sfn_execution on the ECS task's behalf (the AssumeTrialOrgExecutionRole state,
# state_machine.asl.json.tftpl), with sts:TagSession carrying this invocation's own TrialOrgId
# and DnsRecordName - the same session-tag mechanism hosting_admin's own role above uses for
# ReadTrialOrgLogs, applied here because ecs:RunTask itself has no equivalent to
# sts:AssumeRole's TagSession for the ECS task role directly. This is what makes
# ManageTrialOrgEc2Existing/ManageTrialOrgDnsRecords below genuine per-execution ABAC rather
# than "any tagged Trial Org resource" - every other statement here is otherwise identical to
# what the (now-empty) ecs_task role used to carry directly.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "trial_org_execution_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.sfn_execution.arn]
    }
  }
}

resource "aws_iam_role" "trial_org_execution" {
  name                 = "${var.environment}-trial-org-execution"
  assume_role_policy   = data.aws_iam_policy_document.trial_org_execution_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "trial_org_execution" {
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

  # EC2 resources the per-trial module manages. ec2:RunInstances authorizes against several
  # resource types at once (instance, volume, network-interface, subnet, image, security-group,
  # key-pair — AWS's own RunInstances IAM reference); only the ones actually *created* by the
  # call (instance, volume) carry the request's own tags, so only those two are tag-conditioned.
  # The rest (existing subnet/security-group/image/network-interface) are referenced, not
  # created, and so are granted unconditioned here — they're already scoped elsewhere (the
  # foundation's own VPC/subnets, and the AMI account in var.base_ami_owner_account_id).
  statement {
    sid    = "RunInstancesReferencedResources"
    effect = "Allow"
    actions = [
      "ec2:RunInstances",
    ]
    resources = [
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:subnet/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:security-group/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:network-interface/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:key-pair/*",
      "arn:aws:ec2:${var.aws_region}:${var.base_ami_owner_account_id}:image/*",
    ]
  }

  # Require TrialOrgId to be present (any value) on the instance/volume RunInstances actually
  # creates. aws:RequestTag can't be pinned to one specific Trial Org id here since the same
  # shared ECS task role launches every trial's instance — "Null: false" (any value present)
  # is the tightest condition expressible without per-invocation session tags, which RunInstances
  # itself doesn't consult the way the ABAC statements below do for reads.
  statement {
    sid    = "RunInstancesTaggedResources"
    effect = "Allow"
    actions = [
      "ec2:RunInstances",
    ]
    resources = [
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:instance/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:volume/*",
    ]
    condition {
      test     = "Null"
      variable = "aws:RequestTag/TrialOrgId"
      values   = ["false"]
    }
  }

  statement {
    sid    = "CreateSecurityGroupTagged"
    effect = "Allow"
    actions = [
      "ec2:CreateSecurityGroup",
    ]
    resources = ["arn:aws:ec2:${var.aws_region}:${local.account_id}:security-group/*"]
    condition {
      test     = "Null"
      variable = "aws:RequestTag/TrialOrgId"
      values   = ["false"]
    }
  }

  # ec2:CreateTags is scoped to the moment of creation (ec2:CreateAction), so it can never be
  # used to retag an unrelated pre-existing resource outside of RunInstances/CreateSecurityGroup.
  statement {
    sid    = "CreateTagsOnCreate"
    effect = "Allow"
    actions = [
      "ec2:CreateTags",
    ]
    resources = [
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:instance/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:volume/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:security-group/*",
      "arn:aws:ec2:${var.aws_region}:${local.account_id}:network-interface/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values   = ["RunInstances", "CreateSecurityGroup"]
    }
  }

  # Mutations against an *existing* instance/security-group, scoped to the exact Trial Org this
  # session's TrialOrgId tag names (issue #125) - the resource's own TrialOrgId tag must equal
  # the assumed session's, not merely be present. One Trial Org's RunTofu invocation can no
  # longer touch another tagged Trial Org's EC2 resources, closing the gap the previous "any
  # tagged resource" Null condition here left open (CodeRabbit, PR #124).
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
      variable = "aws:ResourceTag/TrialOrgId"
      values   = ["$${aws:PrincipalTag/TrialOrgId}"]
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
      "${local.trial_org_log_group_arn_prefix}*",
      "${local.trial_org_log_group_arn_prefix}*:*",
    ]
  }

  # Per-Trial-Org narrow instance role + instance profile (ADR-0021). Scoped to the naming
  # convention the trial_org module uses, not a bare "*" (see locals.tf) — and, since the module
  # itself deciding what permissions the role gets is not a guarantee IAM enforces on its own,
  # iam:CreateRole additionally requires the role be created with the permissions boundary below
  # attached, so even a compromised or buggy tofu-runner task can never grant this role anything
  # broader than logs:PutLogEvents/CreateLogStream regardless of what PutRolePolicy is asked to do.
  statement {
    sid    = "CreateTrialOrgInstanceRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.trial_org_role_name_prefix}*${local.trial_org_role_name_suffix}"]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.trial_org_instance_boundary.arn]
    }
  }

  statement {
    sid    = "ManageTrialOrgInstanceRole"
    effect = "Allow"
    actions = [
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

  # Per-Trial-Org DNS record under the shared zone, scoped to the exact record name this
  # session's DnsRecordName tag names (issue #125) rather than the *.<root_domain>/
  # *.<dev_subdomain> hostname patterns previously used - Route53 record sets carry no
  # aws:ResourceTag of their own to condition on, so the state machine instead computes the one
  # record this invocation is allowed to touch (hosting_admin's provisioner, from the Trial
  # Org's own dns_subdomain_label) and passes it in as a session tag, the same way TrialOrgId is
  # passed for the ABAC statement above. One Trial Org's RunTofu invocation can no longer touch
  # another Trial Org's record under the same hostname pattern (CodeRabbit, PR #124). Still
  # narrowed to record type A and the UPSERT/DELETE actions the aws_route53_record resource
  # actually issues (never CREATE).
  statement {
    sid       = "ManageTrialOrgDnsRecords"
    effect    = "Allow"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [aws_route53_zone.root.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = ["$${aws:PrincipalTag/DnsRecordName}"]
    }
    condition {
      test     = "Null"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = ["false"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["A"]
    }
    condition {
      test     = "Null"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["false"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsActions"
      values   = ["UPSERT", "DELETE"]
    }
    condition {
      test     = "Null"
      variable = "route53:ChangeResourceRecordSetsActions"
      values   = ["false"]
    }
  }

  statement {
    sid       = "ReadTrialOrgDnsRecords"
    effect    = "Allow"
    actions   = ["route53:GetChange", "route53:ListResourceRecordSets"]
    resources = ["arn:aws:route53:::change/*", aws_route53_zone.root.arn]
  }
}

resource "aws_iam_role_policy" "trial_org_execution" {
  name   = "${var.environment}-trial-org-execution"
  role   = aws_iam_role.trial_org_execution.id
  policy = data.aws_iam_policy_document.trial_org_execution.json
}
