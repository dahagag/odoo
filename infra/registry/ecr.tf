# ---------------------------------------------------------------------------
# ECR repositories (ADR-0038): one repository per image, not a shared repository with tag
# prefixes — keeps each image's repository policy, lifecycle policy, and encryption setting
# independent. Tags are unchanged (CI's existing content-hash scheme); nothing here touches
# tagging.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "odoo_dev" {
  name = local.odoo_dev_repository_name

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "odoo_prod" {
  name = local.odoo_prod_repository_name

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "tofu_runner" {
  name = local.tofu_runner_repository_name

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "administration_stack_api" {
  name = local.administration_stack_api_repository_name

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# ---------------------------------------------------------------------------
# Lifecycle policies. Count-based (not age-based): both images are content-hash tagged and
# deduped on push, so a deploy pins a specific content-hash tag — age-based expiry risks deleting
# a tag a stale deploy still references purely because it is old (ADR-0038). Both repositories'
# rules are identical in shape, differing only by retention count, so one for_each renders both.
#
# tofu-runner and administration-stack-api deliberately get no lifecycle policy yet: neither has
# a CI build workflow in this repo, so there is no build cadence or tagging scheme to set a rule
# against (ADR-0038, "Deferred").
# ---------------------------------------------------------------------------

locals {
  ecr_retention_by_repository = {
    odoo_dev  = { repository_name = aws_ecr_repository.odoo_dev.name, retention_count = var.odoo_dev_retention_count }
    odoo_prod = { repository_name = aws_ecr_repository.odoo_prod.name, retention_count = var.odoo_prod_retention_count }
  }
}

resource "aws_ecr_lifecycle_policy" "retention" {
  for_each = local.ecr_retention_by_repository

  repository = each.value.repository_name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ${each.value.retention_count} most recent images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = each.value.retention_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# tofu-runner cross-account pull grant. It is the only one of the four images consumed outside
# the Platform Account: it runs in the Hosting Account (ADR-0013/ADR-0015), while this registry
# lives in the Platform Account (ADR-0038). ECR authorization is resource-based on top of
# identity-based — this repository policy and the execution role's own identity policy are
# ANDed, not ORed; both must allow the call.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "tofu_runner_pull" {
  statement {
    sid    = "AllowHostingAccountEcsTaskExecutionPull"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.hosting_account_ecs_task_execution_role_arn]
    }

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
  }
}

resource "aws_ecr_repository_policy" "tofu_runner_pull" {
  repository = aws_ecr_repository.tofu_runner.name
  policy     = data.aws_iam_policy_document.tofu_runner_pull.json
}

# ---------------------------------------------------------------------------
# ecr_push's and staging_deploy's own cross-account push/retag grants (issue #271/#272). Both
# roles' identity policies (infra/cicd/oidc.tf's EcrPush/EcrTestPull and
# RetagAdministrationStackImage/EcrAuthForRetag statements) already grant these actions, and
# already did before this change — but an identity policy alone has never been sufficient for
# cross-account ECR access, confirmed empirically while scoping this fix: a cross-account call
# with no repository policy in place gets AccessDeniedException naming "no resource-based policy
# allows" the action, even from an account-admin-equivalent identity, exactly like
# tofu_runner_pull's own comment above already describes for the EC2/ECS/IAM/Logs services this
# same issue's cross_account_iam.tf fixes. tofu_runner is the only one of the four repositories
# that already had this covered; odoo_dev, odoo_prod, and administration_stack_api did not.
#
# ecr:GetAuthorizationToken is excluded from every statement below on purpose — like
# tofu_runner_pull's principal, it isn't a resource-level action, so it can't be granted (or
# meaningfully scoped) via a repository policy; both roles' own EcrAuth/EcrAuthForRetag
# statements grant it directly in the calling (Hosting) account instead, which is where it's
# actually evaluated.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "odoo_dev_push" {
  statement {
    sid    = "AllowEcrPushRolePush"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.ecr_push_role_arn]
    }

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      # ci.yml's test job pulls this image back post-push (issue #259) — see ecr_push's own
      # EcrTestPull statement, scoped to odoo_dev only for the identical reason.
      "ecr:GetDownloadUrlForLayer",
    ]
  }
}

resource "aws_ecr_repository_policy" "odoo_dev_push" {
  repository = aws_ecr_repository.odoo_dev.name
  policy     = data.aws_iam_policy_document.odoo_dev_push.json
}

data "aws_iam_policy_document" "odoo_prod_push" {
  statement {
    sid    = "AllowEcrPushRolePush"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.ecr_push_role_arn]
    }

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
  }
}

resource "aws_ecr_repository_policy" "odoo_prod_push" {
  repository = aws_ecr_repository.odoo_prod.name
  policy     = data.aws_iam_policy_document.odoo_prod_push.json
}

# administration_stack_api carries two distinct grants, to two distinct Hosting Account
# principals: ecr_push's PR-time push (same shape as odoo_dev/odoo_prod above) and
# staging_deploy's own, separate, narrower retag-only access (BatchGetImage + PutImage only —
# staging_deploy never uploads new layers, it only adds a second tag to a manifest ecr_push
# already pushed; see infra/cicd/oidc.tf's RetagAdministrationStackImage comment).
data "aws_iam_policy_document" "administration_stack_api_push" {
  statement {
    sid    = "AllowEcrPushRolePush"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.ecr_push_role_arn]
    }

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
  }

  statement {
    sid    = "AllowStagingDeployRetag"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [var.staging_deploy_role_arn]
    }

    actions = [
      "ecr:BatchGetImage",
      "ecr:PutImage",
    ]
  }
}

resource "aws_ecr_repository_policy" "administration_stack_api_push" {
  repository = aws_ecr_repository.administration_stack_api.name
  policy     = data.aws_iam_policy_document.administration_stack_api_push.json
}
