locals {
  tags = merge(var.tags, {
    TofuModule = "cicd"
  })

  # GitHub's own fixed OIDC issuer URL and the audience every GitHub Actions OIDC token is
  # minted for (not repo-specific, so not a variable).
  github_oidc_provider_url = "https://token.actions.githubusercontent.com"
  github_oidc_audience     = "sts.amazonaws.com"

  ecr_repository_arns = [
    for name in var.ecr_repository_names :
    "arn:aws:ecr:${var.aws_region}:${var.platform_account_id}:repository/${name}"
  ]
}
