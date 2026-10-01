locals {
  tags = merge(var.tags, {
    Environment = var.environment
    TofuModule  = "staging-odoo"
  })

  account_id = data.aws_caller_identity.current.account_id

  # Container names shared between the task definition (ecs_task.tf) and their own log group
  # naming (ecs.tf), kept in one place so the two can never drift — same pattern as
  # infra/platform/locals.tf's administration_stack_api_container_name.
  postgres_container_name  = "postgres"
  odoo_container_name      = "odoo"
  tailscale_container_name = "tailscale"
}
