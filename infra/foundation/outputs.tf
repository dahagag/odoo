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

output "route53_name_servers" {
  value       = aws_route53_zone.root.name_servers
  description = "Route53 hosted zone name servers. var.root_domain is only publicly authoritative once these are delegated at the registrar or parent zone (a manual, one-time operator step — see dns.tf and infra/README.md)."
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
  description = "ECS task role the tofu-runner container's own instance-metadata credential chain resolves to. Carries no inline policy (issue #125) — see trial_org_execution_role_arn for the role RunTofu actually acts as."
}

output "trial_org_execution_role_arn" {
  value       = aws_iam_role.trial_org_execution.arn
  description = "Per-invocation role (issue #125) sfn_execution assumes with a TrialOrgId/DnsRecordName session tag before RunTofu launches the ECS task, scoping that invocation's EC2/DNS mutate permissions to the one Trial Org it targets."
}

output "trial_org_instance_permissions_boundary_arn" {
  value       = aws_iam_policy.trial_org_instance_boundary.arn
  description = "Permissions boundary ARN, for use as an input to trial_org module invocations (ADR-0021) — the ECS task role's iam:CreateRole grant requires every per-Trial-Org instance role to have this attached."
}

output "trial_org_log_group_prefix" {
  value       = var.trial_org_log_group_prefix
  description = "CloudWatch log group name prefix, for use as an input to trial_org module invocations so the two modules never disagree on the naming convention."
}
