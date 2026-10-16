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
  odoo_staging_repository_name             = "agentic-erp/odoo-staging"

  # Issue #271/#272: platform_registry_deploy's own ECR-management permissions (moved here from
  # infra/cicd's infra_management_statements) are scoped to these five repositories' own ARNs —
  # read directly off the resources this module already creates, not a reconstructed ARN pattern,
  # since this module is the one thing that can never drift from its own resources' real ARNs.
  ecr_repository_arns = [
    aws_ecr_repository.odoo_dev.arn,
    aws_ecr_repository.odoo_prod.arn,
    aws_ecr_repository.tofu_runner.arn,
    aws_ecr_repository.administration_stack_api.arn,
    aws_ecr_repository.odoo_staging.arn,
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

  # Issue #218: infra/platform's aws_ssm_parameter.administration_stack_deployed_commit ARN, built
  # from the same "duplicated literal default, kept in sync by convention" naming this module
  # already uses for the ECS cluster/task-family/service names above — infra/platform is never
  # applied by a human directly (see infra-tofu's platform_assume_role_arn comment), so this
  # module's IAM grant has to know the parameter's name ahead of infra/platform actually creating
  # it, not read it back via remote state.
  administration_stack_deployed_commit_parameter_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.administration_stack_deployed_commit_parameter_name}"

  # infra/staging-odoo's own resource shapes (issue #349) — same "fixed-name-pattern, not remote
  # state" convention as the administration_stack_* locals above, for platform_staging_odoo_deploy/
  # platform_staging_odoo_ci_plan's permission documents.
  staging_odoo_ecs_cluster_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${var.staging_odoo_ecs_cluster_name}"
  staging_odoo_task_family_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${var.staging_odoo_task_family}:*"
  staging_odoo_service_arn     = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.staging_odoo_ecs_cluster_name}/${var.staging_odoo_ecs_service_name}"

  # infra/staging-odoo/ecs.tf creates three log groups (one per task container), not one —
  # unlike administration_stack's single log group, so this is a list.
  staging_odoo_log_group_arns = [
    for container_name in ["postgres", "odoo", "tailscale"] :
    "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${var.staging_odoo_ecs_cluster_name}/${container_name}"
  ]

  # infra/staging-odoo/iam.tf names its two roles "${var.environment}-execution"/"${var.environment}-task"
  # ("staging-odoo-execution"/"staging-odoo-task") — both share the "staging-odoo-" prefix, unlike
  # administration_stack's single "-administration-stack-api-*" suffix pattern, so one wildcard
  # pattern covers both roles here.
  staging_odoo_task_role_arn_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.staging_odoo_ecs_cluster_name}-*"

  staging_odoo_deployed_commit_parameter_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.staging_odoo_deployed_commit_parameter_name}"
}
