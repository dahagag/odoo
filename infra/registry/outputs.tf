output "odoo_dev_repository_url" {
  value       = aws_ecr_repository.odoo_dev.repository_url
  description = "agentic-erp/odoo-dev repository URL, for use as the `docker push`/pull target."
}

output "odoo_prod_repository_url" {
  value       = aws_ecr_repository.odoo_prod.repository_url
  description = "agentic-erp/odoo-prod repository URL, for use as the `docker push`/pull target."
}

output "tofu_runner_repository_url" {
  value       = aws_ecr_repository.tofu_runner.repository_url
  description = "agentic-erp/tofu-runner repository URL — infra/foundation's tofu_runner_image input, once a build pipeline publishes to it."
}

output "administration_stack_api_repository_url" {
  value       = aws_ecr_repository.administration_stack_api.repository_url
  description = "agentic-erp/administration-stack-api repository URL."
}

output "platform_registry_deploy_role_arn" {
  value       = aws_iam_role.platform_registry_deploy.arn
  description = "Platform Account role ARN infra/cicd's staging_deploy/production_deploy assume to manage infra/registry's own ECR repositories (issue #271/#272) — infra/cicd's platform_registry_deploy_role_arn input."
}

output "platform_administration_stack_deploy_role_arn" {
  value       = aws_iam_role.platform_administration_stack_deploy.arn
  description = "Platform Account role ARN infra/cicd's staging_deploy assumes to deploy infra/platform's VPC/ECS/IAM/Logs resources (issue #271/#272) — infra/cicd's platform_administration_stack_deploy_role_arn input, and infra/platform's own platform_assume_role_arn input for its apply job."
}

output "platform_ci_plan_role_arn" {
  value       = aws_iam_role.platform_ci_plan.arn
  description = "Platform Account role ARN infra/cicd's infra_plan assumes for a read-only plan of infra/registry or infra/platform (issue #271/#272) — infra/cicd's platform_ci_plan_role_arn input, and infra/platform's own platform_assume_role_arn input for its plan job."
}
