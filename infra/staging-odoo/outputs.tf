output "ecs_cluster_name" {
  value       = aws_ecs_cluster.staging_odoo.name
  description = "Platform Account ECS cluster name for staging Odoo — `aws ecs describe-services --cluster <this> --services <ecs_service_name>` is the discoverability path for \"what's running in staging\"."
}

output "ecs_service_name" {
  value       = aws_ecs_service.staging_odoo.name
  description = "ECS service name for staging Odoo."
}

output "odoo_release_version" {
  value       = var.odoo_image_tag
  description = "The release version this apply deployed — also set as this service's and task definition's own `Release` tag."
}

output "staging_odoo_deployed_commit_parameter_name" {
  value       = aws_ssm_parameter.staging_odoo_deployed_commit.name
  description = "SSM parameter name CI's release-order guard (issue #218's pattern) reads/writes for this module's own deploy pipeline."
}

output "ecs_task_role_arn" {
  value       = aws_iam_role.ecs_task.arn
  description = "Staging Odoo's ECS task role ARN — the identity the entrypoint's SSM GetParameter calls run as (#338)."
}
