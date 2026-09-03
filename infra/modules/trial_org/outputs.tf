output "instance_id" {
  value       = aws_instance.trial_org.id
  description = "EC2 instance id — this is what the state machine's Suspend/Wake Task state (outside this module) operates on."
}

output "public_ip" {
  value       = aws_instance.trial_org.public_ip
  description = "Public IP address of the Trial Org instance."
}

output "ami_id" {
  value       = aws_instance.trial_org.ami
  description = "AMI id this instance was actually launched from (ADR-0024 — recorded by the caller as the Trial Org's deployment-versioning audit trail)."
}

output "domain" {
  value       = local.domain
  description = "Fully-qualified domain name provisioned for this Trial Org."
}

output "log_group_name" {
  value       = aws_cloudwatch_log_group.trial_org.name
  description = "This Trial Org's own CloudWatch log group name."
}

output "log_group_arn" {
  value       = aws_cloudwatch_log_group.trial_org.arn
  description = "This Trial Org's own CloudWatch log group ARN."
}

output "instance_role_arn" {
  value       = aws_iam_role.instance.arn
  description = "ARN of this Trial Org's narrow, logs-only EC2 instance role."
}

output "security_group_id" {
  value       = aws_security_group.instance.id
  description = "Security group id attached to the Trial Org instance."
}
