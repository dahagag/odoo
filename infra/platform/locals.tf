locals {
  tags = merge(var.tags, {
    Environment = var.environment
    TofuModule  = "platform"
  })

  account_id = data.aws_caller_identity.current.account_id

  # Container name shared between the task definition (ecs_task.tf) and its own log group naming
  # below, kept in one place so the two can never drift.
  administration_stack_api_container_name = "administration-stack-api"
}
