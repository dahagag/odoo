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
# a tag a stale deploy still references purely because it is old (ADR-0038).
#
# tofu-runner and administration-stack-api deliberately get no lifecycle policy yet: neither has
# a CI build workflow in this repo, so there is no build cadence or tagging scheme to set a rule
# against (ADR-0038, "Deferred").
# ---------------------------------------------------------------------------

resource "aws_ecr_lifecycle_policy" "odoo_dev" {
  repository = aws_ecr_repository.odoo_dev.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ${var.odoo_dev_retention_count} most recent images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.odoo_dev_retention_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "odoo_prod" {
  repository = aws_ecr_repository.odoo_prod.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ${var.odoo_prod_retention_count} most recent images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.odoo_prod_retention_count
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
