output "ecs_cluster_name" {
  value       = aws_ecs_cluster.platform.name
  description = "Platform Account ECS cluster name — `aws ecs describe-services --cluster <this> --services <ecs_service_name>` is the discoverability path for issue #216's \"what's running in staging\" acceptance criterion."
}

output "ecs_service_name" {
  value       = aws_ecs_service.administration_stack_api.name
  description = "ECS service name for the administration-stack API."
}

output "administration_stack_release_version" {
  value       = var.administration_stack_image_tag
  description = "The release version this apply deployed — also set as this service's and task definition's own `Release` tag, and as the running container's RELEASE_VERSION env var (surfaced on /healthz)."
}
