locals {
  tags = merge(var.tags, {
    TofuModule = "registry"
  })

  # Fixed by ADR-0038's topology decision (one repository per image, namespaced under the
  # project) — not variables, since renaming any of these is a deliberate, separate decision,
  # not a per-environment knob.
  odoo_dev_repository_name                 = "agentic-erp/odoo-dev"
  odoo_prod_repository_name                = "agentic-erp/odoo-prod"
  tofu_runner_repository_name              = "agentic-erp/tofu-runner"
  administration_stack_api_repository_name = "agentic-erp/administration-stack-api"

  # Issue #271/#272: platform_registry_deploy's own ECR-management permissions (moved here from
  # infra/cicd's infra_management_statements) are scoped to these four repositories' own ARNs —
  # read directly off the resources this module already creates, not a reconstructed ARN pattern,
  # since this module is the one thing that can never drift from its own resources' real ARNs.
  ecr_repository_arns = [
    aws_ecr_repository.odoo_dev.arn,
    aws_ecr_repository.odoo_prod.arn,
    aws_ecr_repository.tofu_runner.arn,
    aws_ecr_repository.administration_stack_api.arn,
  ]

  # infra/platform's own resource shapes (issue #272), built from this account's own identity
  # (data.aws_caller_identity.current, providers.tf) rather than a platform_account_id variable —
  # unlike infra/cicd, this module already runs *in* the Platform Account, so it needs no
  # separate account-id input to describe resources that live here.
  administration_stack_ecs_cluster_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${var.administration_stack_ecs_cluster_name}"
  administration_stack_task_family_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${var.administration_stack_task_family}:*"
  administration_stack_service_arn     = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.administration_stack_ecs_cluster_name}/${var.administration_stack_ecs_service_name}"
  administration_stack_log_group_arn   = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${var.administration_stack_ecs_cluster_name}/administration-stack-api"

  # Mirrors infra/cicd's own manage_own_role-style pattern: staging_deploy's iam:CreateRole/
  # PutRolePolicy/PassRole grant (via platform_administration_stack_deploy) is scoped to this
  # naming pattern, not a bare "*" or the whole account.
  administration_stack_task_role_arn_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.administration_stack_ecs_cluster_name}-administration-stack-api-*"
}
