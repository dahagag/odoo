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
