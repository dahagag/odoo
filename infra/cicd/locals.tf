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

  # The one repository ci.yml's test job pulls back (issue #259) — the dev image build-image just
  # pushed, to run the test matrix against it. Not all four: nothing else in this repo's CI pulls
  # any of the other three.
  odoo_dev_repository_arn = "arn:aws:ecr:${var.aws_region}:${var.platform_account_id}:repository/agentic-erp/odoo-dev"
}
