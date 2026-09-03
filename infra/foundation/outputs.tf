output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC id, for use as an input to trial_org module invocations."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet ids, used by the ECS tofu-runner task and the shared log-forwarding Lambda."
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnet ids, for use as the trial_org module's subnet_id input (each Trial Org instance is reached directly over HTTPS)."
}

output "route53_zone_id" {
  value       = aws_route53_zone.root.zone_id
  description = "Route53 hosted zone id, for use as an input to trial_org module invocations."
}

output "route53_zone_name" {
  value       = aws_route53_zone.root.name
  description = "Route53 hosted zone name."
}

output "acm_certificate_arn" {
  value       = aws_acm_certificate_validation.wildcard.certificate_arn
  description = "Validated ACM wildcard certificate ARN covering *.<root_domain> and *.<dev_subdomain>."
}

output "ecs_cluster_arn" {
  value       = aws_ecs_cluster.hosting.arn
  description = "ECS cluster ARN."
}

output "base_ami_id" {
  value       = data.aws_ami.trial_org_base.id
  description = "Most recent base AMI id, for use as an input to trial_org module invocations (ADR-0024)."
}

output "state_machine_arn" {
  value       = aws_sfn_state_machine.trial_org_lifecycle.arn
  description = "Trial Org lifecycle state machine ARN — hosting_admin's StartExecution target."
}

output "hosting_admin_role_arn" {
  value       = aws_iam_role.hosting_admin.arn
  description = "ARN of the narrow hosting_admin-facing role the Platform Account's hosting_admin role assumes cross-account."
}

output "trial_org_lock_table_name" {
  value       = aws_dynamodb_table.trial_org_lock.name
  description = "DynamoDB table name for the per-Trial-Org lifecycle lock."
}

output "log_forwarder_lambda_arn" {
  value       = aws_lambda_function.log_forwarder.arn
  description = "Shared log-forwarding Lambda ARN, for use as an input to trial_org module invocations (each trial's log group subscription filter targets this)."
}

output "ecs_task_role_arn" {
  value       = aws_iam_role.ecs_task.arn
  description = "ECS task role the tofu-runner container runs as."
}
