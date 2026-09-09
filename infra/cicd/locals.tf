locals {
  tags = merge(var.tags, {
    TofuModule = "cicd"
  })

  # GitHub's own fixed OIDC issuer URL and the audience every GitHub Actions OIDC token is
  # minted for (not repo-specific, so not a variable).
  github_oidc_provider_url = "https://token.actions.githubusercontent.com"
  github_oidc_audience     = "sts.amazonaws.com"
}
