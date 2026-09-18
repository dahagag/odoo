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

output "administration_stack_deployed_commit_parameter_name" {
  value       = aws_ssm_parameter.administration_stack_deployed_commit.name
  description = "SSM parameter name ci.yml's release-order guard (issue #218) reads/writes."
}

output "ses_sending_domain" {
  value       = aws_ses_domain_identity.sender.domain
  description = "SES sending domain (SesEmailSender's SES_FROM_ADDRESS is an address under this domain, #327)."
}

output "ses_domain_verification_record" {
  value       = aws_ses_domain_identity.sender.verification_token
  description = "TXT record value for \"_amazonses.<ses_sending_domain>\" — add this to the sending domain's real DNS zone to complete SES domain verification (a manual, one-time step, same as infra/foundation/dns.tf's Route53 delegation)."
}

output "ses_dkim_tokens" {
  value       = aws_ses_domain_dkim.sender.dkim_tokens
  description = "DKIM tokens: for each token, add a CNAME from \"<token>._domainkey.<ses_sending_domain>\" to \"<token>.dkim.amazonses.com\" on the sending domain's real DNS zone."
}
