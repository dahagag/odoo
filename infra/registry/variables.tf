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

# ---------------------------------------------------------------------------
# Cross-account trust roles for CI (issue #271/#272)
# ---------------------------------------------------------------------------

variable "staging_deploy_role_arn" {
  type        = string
  description = "infra/cicd's staging_deploy_role_arn output (Hosting Account) — the only non-shared principal platform_administration_stack_deploy's trust policy allows, and one of two principals platform_registry_deploy's trust policy allows. Not looked up via remote state (no cross-module data dependency), supplied at apply time same convention as this module's other Hosting-Account-sourced variables."
}

variable "production_deploy_role_arn" {
  type        = string
  description = "infra/cicd's production_deploy_role_arn output (Hosting Account) — the second principal platform_registry_deploy's trust policy allows (production_deploy already manages infra/registry today, via infra_management_statements' shared ManageRegistryRepositories grant — issue #215), but NOT platform_administration_stack_deploy's (that stays staging_deploy-only until #217)."
}

variable "infra_plan_role_arn" {
  type        = string
  description = "infra/cicd's infra_plan_role_arn output (Hosting Account) — the only principal platform_ci_plan's trust policy allows."
}

variable "ecr_push_role_arn" {
  type        = string
  description = <<-EOT
    infra/cicd's ecr_push_role_arn output (Hosting Account) — issue #271/#272's live-AWS testing
    found this role's own EcrPush/EcrTestPull identity-policy statements (infra/cicd/oidc.tf) have
    never been sufficient on their own for cross-account ECR access: unlike same-account access,
    ECR requires a matching repository policy on the *target* account granting the calling
    principal, in addition to its own identity policy — confirmed empirically (an
    AccessDeniedException naming "no resource-based policy allows" the action, even from an
    account-admin-equivalent identity, against a repository with no such policy; the one existing
    repository policy here, tofu_runner_pull, works precisely because it has one). This variable
    is that missing principal for odoo_dev/odoo_prod/administration_stack_api's new repository
    policies below.
  EOT
}

variable "platform_assume_role_arn" {
  type        = string
  default     = null
  description = <<-EOT
    Role ARN this module's own AWS provider assumes into before creating/reading any resource
    (issue #272's role-chaining fix). Left unset (null) for a human operator's first, bootstrap
    apply of this module — it then runs with the operator's own direct Platform Account
    credentials, the same "deliberate human/ops action" infra/README.md already documents for
    infra/bootstrap and infra/foundation, needed here too since nothing can assume into a role
    this module hasn't created yet. Set to platform_registry_deploy_role_arn's or
    platform_ci_plan_role_arn's own output ARN for every apply/plan CI runs thereafter, chained
    from staging_deploy/production_deploy's or infra_plan's own Hosting Account OIDC-assumed
    credentials.
  EOT
}

# ---------------------------------------------------------------------------
# infra/platform naming (issue #272) — fixed here too, same convention infra/cicd's own
# administration_stack_* variables already used before this module took over building these
# ARNs, so platform_administration_stack_deploy/platform_ci_plan's permission documents can be
# scoped to these exact resource shapes rather than a bare "*".
# ---------------------------------------------------------------------------

variable "administration_stack_ecs_cluster_name" {
  type        = string
  description = "infra/platform's var.ecs_cluster_name default (\"platform\")."
  default     = "platform"
}

variable "administration_stack_task_family" {
  type        = string
  description = "infra/platform's aws_ecs_task_definition.administration_stack_api family default (\"platform-administration-stack-api\")."
  default     = "platform-administration-stack-api"
}

variable "administration_stack_ecs_service_name" {
  type        = string
  description = "infra/platform's aws_ecs_service.administration_stack_api name default (same \"platform-administration-stack-api\" convention)."
  default     = "platform-administration-stack-api"
}
