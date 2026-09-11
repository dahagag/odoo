# ---------------------------------------------------------------------------
# Cross-account trust roles for CI (issue #271/#272). staging_deploy, production_deploy, and
# infra_plan are Hosting Account roles (infra/cicd/oidc.tf) that need to manage or read
# resources in THIS account (the Platform Account, ADR-0038) — this module's own ECR
# repositories, and infra/platform's VPC/ECS/IAM/Logs resources. Unlike ECR's data-plane pull
# actions (tofu_runner_pull above, or the new push/retag policies in ecr.tf), EC2, ECS, IAM, and
# CloudWatch Logs have no cross-account resource-based policy mechanism at all — the only way a
# Hosting Account identity can act on those services here is sts:AssumeRole into a role that
# lives in this account and explicitly trusts it.
#
# Three roles, one per distinct permission set — the same "narrow role per caller" discipline
# infra/cicd/oidc.tf already applies to staging_deploy/production_deploy/infra_plan themselves.
# None of these trust policies reference the GitHub OIDC provider — only the exact Hosting
# Account role ARN(s) below, via plain sts:AssumeRole (these roles are only ever reached by a
# workflow run that has already assumed one of those OIDC-trusted roles first).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# platform-registry-deploy: staging_deploy AND production_deploy both already manage
# infra/registry today (infra/cicd's infra_management_statements, issue #215, shared by both) —
# so both are trusted here, mirroring that existing shared scope exactly.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "platform_registry_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.staging_deploy_role_arn, var.production_deploy_role_arn]
    }
  }
}

resource "aws_iam_role" "platform_registry_deploy" {
  name               = "platform-registry-deploy"
  assume_role_policy = data.aws_iam_policy_document.platform_registry_deploy_trust.json
}

# Exactly infra/cicd's old ManageRegistryRepositories statement, moved here verbatim — nothing
# broader. staging_deploy/production_deploy's own identity policies now carry only an
# sts:AssumeRole grant onto this role's ARN (infra/cicd/oidc.tf).
data "aws_iam_policy_document" "platform_registry_deploy" {
  statement {
    sid    = "ManageRegistryRepositories"
    effect = "Allow"
    actions = [
      "ecr:CreateRepository",
      "ecr:DescribeRepositories",
      "ecr:DeleteRepository",
      "ecr:PutLifecyclePolicy",
      "ecr:GetLifecyclePolicy",
      "ecr:DeleteLifecyclePolicy",
      "ecr:SetRepositoryPolicy",
      "ecr:GetRepositoryPolicy",
      "ecr:DeleteRepositoryPolicy",
      "ecr:PutImageTagMutability",
      "ecr:PutImageScanningConfiguration",
      "ecr:TagResource",
      "ecr:ListTagsForResource",
    ]
    resources = local.ecr_repository_arns
  }

  # This role is the one both staging_deploy and production_deploy assume to apply the whole of
  # infra/registry via CI — not just the ECR repositories above, but this module's own three
  # cross-account IAM roles too (a `tofu apply`/`plan` refreshes every resource in state
  # regardless of what's being written, and self-management of a module's own IAM resources is
  # the same pattern infra/cicd's manage_own_role_staging_deploy/manage_own_role_production_deploy
  # already establish for its own roles). Scoped to exactly the three roles this module creates —
  # not a wildcard, and not any other account's role.
  statement {
    sid    = "ManageRegistryCrossAccountRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:CreateRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [
      aws_iam_role.platform_registry_deploy.arn,
      aws_iam_role.platform_administration_stack_deploy.arn,
      aws_iam_role.platform_ci_plan.arn,
    ]
  }
}

resource "aws_iam_role_policy" "platform_registry_deploy" {
  name   = "platform-registry-deploy"
  role   = aws_iam_role.platform_registry_deploy.id
  policy = data.aws_iam_policy_document.platform_registry_deploy.json
}

# ---------------------------------------------------------------------------
# platform-administration-stack-deploy: staging_deploy only — production_deploy gets none of
# this yet (#217 defines what a production deploy of the administration stack touches).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "platform_administration_stack_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.staging_deploy_role_arn]
    }
  }
}

resource "aws_iam_role" "platform_administration_stack_deploy" {
  name               = "platform-administration-stack-deploy"
  assume_role_policy = data.aws_iam_policy_document.platform_administration_stack_deploy_trust.json
}

# Exactly infra/cicd's old administration_stack_deploy document's EC2/ECS/IAM/Logs statements,
# moved here verbatim (same sids, same actions, same resources/conditions) — its
# TofuStateBackendPlatform (S3, Hosting Account bucket), RetagAdministrationStackImage, and
# EcrAuthForRetag statements stay on staging_deploy exactly as they were: the state bucket lives
# in the Hosting Account, and ECR retag access is a data-plane grant handled by a repository
# policy (ecr.tf), not this role-chaining mechanism.
data "aws_iam_policy_document" "platform_administration_stack_deploy" {
  statement {
    sid    = "ManageAdministrationStackNetworking"
    effect = "Allow"
    actions = [
      "ec2:DescribeVpcs",
      "ec2:CreateVpc",
      "ec2:DescribeVpcAttribute",
      "ec2:DescribeSubnets",
      "ec2:CreateSubnet",
      "ec2:DescribeInternetGateways",
      "ec2:CreateInternetGateway",
      "ec2:DescribeNatGateways",
      "ec2:CreateNatGateway",
      "ec2:DescribeAddresses",
      "ec2:AllocateAddress",
      "ec2:DescribeRouteTables",
      "ec2:CreateRouteTable",
      "ec2:DescribeSecurityGroups",
      "ec2:CreateSecurityGroup",
      "ec2:DescribeTags",
    ]
    resources = ["*"]
  }

  # See infra/cicd's old TagAdministrationStackNetworkingOnCreate comment (issue #216) for why
  # ec2:CreateTags is conditioned on ec2:CreateAction rather than folded into the statement above.
  statement {
    sid    = "TagAdministrationStackNetworkingOnCreate"
    effect = "Allow"
    actions = [
      "ec2:CreateTags",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values = [
        "CreateVpc",
        "CreateSubnet",
        "CreateInternetGateway",
        "CreateNatGateway",
        "AllocateAddress",
        "CreateRouteTable",
        "CreateSecurityGroup",
      ]
    }
  }

  statement {
    sid    = "ManageAdministrationStackNetworkingScoped"
    effect = "Allow"
    actions = [
      "ec2:DeleteVpc",
      "ec2:ModifyVpcAttribute",
      "ec2:DeleteSubnet",
      "ec2:ModifySubnetAttribute",
      "ec2:AttachInternetGateway",
      "ec2:DetachInternetGateway",
      "ec2:DeleteInternetGateway",
      "ec2:DeleteNatGateway",
      "ec2:ReleaseAddress",
      "ec2:AssociateRouteTable",
      "ec2:DisassociateRouteTable",
      "ec2:DeleteRouteTable",
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:DeleteTags",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/TofuModule"
      values   = ["platform"]
    }
  }

  statement {
    sid    = "ManageAdministrationStackEcs"
    effect = "Allow"
    actions = [
      "ecs:DescribeClusters",
      "ecs:CreateCluster",
      "ecs:DeleteCluster",
      "ecs:PutClusterCapacityProviders",
      "ecs:TagResource",
    ]
    resources = [local.administration_stack_ecs_cluster_arn]
  }

  statement {
    sid    = "RegisterAdministrationStackTaskDefinition"
    effect = "Allow"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DeregisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ReadAdministrationStackTaskDefinition"
    effect    = "Allow"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = [local.administration_stack_task_family_arn]
  }

  statement {
    sid    = "DeployAdministrationStackService"
    effect = "Allow"
    actions = [
      "ecs:CreateService",
      "ecs:UpdateService",
      "ecs:DeleteService",
      "ecs:DescribeServices",
      "ecs:TagResource",
    ]
    resources = [local.administration_stack_service_arn]
  }

  statement {
    sid    = "ManageAdministrationStackTaskRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:CreateRole",
      "iam:UpdateRole",
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [local.administration_stack_task_role_arn_pattern]
  }

  statement {
    sid       = "PassAdministrationStackTaskRoles"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [local.administration_stack_task_role_arn_pattern]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid    = "ManageAdministrationStackLogGroup"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:DescribeLogGroups",
    ]
    resources = [
      local.administration_stack_log_group_arn,
      "${local.administration_stack_log_group_arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "platform_administration_stack_deploy" {
  name   = "platform-administration-stack-deploy"
  role   = aws_iam_role.platform_administration_stack_deploy.id
  policy = data.aws_iam_policy_document.platform_administration_stack_deploy.json
}

# ---------------------------------------------------------------------------
# platform-ci-plan: infra_plan only — one shared, read-only role across both registry's and
# platform's PR-time plans, mirroring infra_plan's own existing design as a single shared
# read-only Hosting Account role (its trust condition carries no branch information to isolate
# by anyway; see infra/cicd/oidc.tf's infra_plan comment).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "platform_ci_plan_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.infra_plan_role_arn]
    }
  }
}

resource "aws_iam_role" "platform_ci_plan" {
  name               = "platform-ci-plan"
  assume_role_policy = data.aws_iam_policy_document.platform_ci_plan_trust.json
}

# Exactly infra/cicd's old ReadRegistryRepositories and ReadAdministrationStackNetworking/-Ecs/
# -TaskRoles/-LogGroup statements, moved here verbatim and combined into one role.
data "aws_iam_policy_document" "platform_ci_plan" {
  statement {
    sid    = "ReadRegistryRepositories"
    effect = "Allow"
    actions = [
      "ecr:DescribeRepositories",
      "ecr:GetLifecyclePolicy",
      "ecr:GetRepositoryPolicy",
      "ecr:ListTagsForResource",
    ]
    resources = local.ecr_repository_arns
  }

  statement {
    sid    = "ReadAdministrationStackNetworking"
    effect = "Allow"
    actions = [
      "ec2:DescribeVpcs",
      "ec2:DescribeVpcAttribute",
      "ec2:DescribeSubnets",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeNatGateways",
      "ec2:DescribeAddresses",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeTags",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ReadAdministrationStackEcs"
    effect = "Allow"
    actions = [
      "ecs:DescribeClusters",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
    ]
    resources = [
      local.administration_stack_ecs_cluster_arn,
      local.administration_stack_service_arn,
      local.administration_stack_task_family_arn,
    ]
  }

  statement {
    sid    = "ReadAdministrationStackTaskRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [local.administration_stack_task_role_arn_pattern]
  }

  statement {
    sid       = "ReadAdministrationStackLogGroup"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = [local.administration_stack_log_group_arn]
  }

  # infra_plan also plans infra/registry itself (via this same role) — a `tofu plan` refreshes
  # every resource in state regardless of what's being written, including this module's own three
  # cross-account IAM roles, mirroring infra/cicd's own ReadCicdOidcAndRoles/ReadOtherManagedRoles
  # pattern for the identical reason.
  statement {
    sid    = "ReadRegistryCrossAccountRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [
      aws_iam_role.platform_registry_deploy.arn,
      aws_iam_role.platform_administration_stack_deploy.arn,
      aws_iam_role.platform_ci_plan.arn,
    ]
  }
}

resource "aws_iam_role_policy" "platform_ci_plan" {
  name   = "platform-ci-plan"
  role   = aws_iam_role.platform_ci_plan.id
  policy = data.aws_iam_policy_document.platform_ci_plan.json
}
