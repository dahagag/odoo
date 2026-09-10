variable "aws_region" {
  type        = string
  description = "AWS region this module's ECR repositories are created in."
  default     = "us-east-1"
}

variable "odoo_dev_retention_count" {
  type        = number
  description = "Number of most recent agentic-erp/odoo-dev images to retain (ADR-0038: imageCountMoreThan, tagStatus any)."
  default     = 15
}

variable "odoo_prod_retention_count" {
  type        = number
  description = "Number of most recent agentic-erp/odoo-prod images to retain (ADR-0038: imageCountMoreThan, tagStatus any)."
  default     = 10
}

# ---------------------------------------------------------------------------
# Cross-account IAM (tofu-runner pull, Hosting Account)
# ---------------------------------------------------------------------------

variable "hosting_account_ecs_task_execution_role_arn" {
  type        = string
  description = <<-EOT
    ARN of the Hosting Account's `aws_iam_role.ecs_task_execution` (infra/foundation/iam.tf,
    named "$${var.environment}-tofu-runner-execution" there) — the only principal
    agentic-erp/tofu-runner's repository policy grants pull access to (ADR-0038). Not looked up
    via remote state (infra/foundation does not export it as an output); supplied at apply time,
    same convention as infra/foundation's own hosting_admin_trusted_role_arn. The identity side of
    this cross-account grant needs no change here — AmazonECSTaskExecutionRolePolicy, already
    attached to that role, grants ecr:GetAuthorizationToken/BatchGetImage/
    GetDownloadUrlForLayer/BatchCheckLayerAvailability with resource "*".
  EOT
}

variable "tags" {
  type        = map(string)
  description = "Common tags merged onto every resource this module creates."
  default = {
    Project   = "hosting-operations"
    ManagedBy = "opentofu"
  }
}
