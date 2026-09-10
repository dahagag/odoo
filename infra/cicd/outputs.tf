output "github_oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.github_actions.arn
  description = "OIDC provider ARN — the Federated principal identifier both deploy roles' trust policies reference."
}

output "staging_deploy_role_arn" {
  value       = aws_iam_role.staging_deploy.arn
  description = "Role ARN a workflow run on var.staging_branch assumes via sts:AssumeRoleWithWebIdentity (aws-actions/configure-aws-credentials' role-to-assume input)."
}

output "production_deploy_role_arn" {
  value       = aws_iam_role.production_deploy.arn
  description = "Role ARN a workflow run on var.production_branch assumes via sts:AssumeRoleWithWebIdentity."
}

output "ecr_push_role_arn" {
  value       = aws_iam_role.ecr_push.arn
  description = "Role ARN a workflow run on var.staging_branch or var.production_branch assumes to push to the four ADR-0038 ECR repositories (aws-actions/configure-aws-credentials' role-to-assume input for the image-build jobs)."
}
