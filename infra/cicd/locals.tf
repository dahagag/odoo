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

  # Issue #215: the deploy roles now also manage infra/cicd and infra/registry themselves (a
  # `tofu apply` in either root module touches the OIDC provider, these three roles, and the four
  # ECR repositories) — so their IAM-management statement is scoped to exactly the resource shapes
  # those two modules create, by ARN pattern, in *this* account (data.aws_caller_identity.current,
  # not platform_account_id, which is the separate Platform Account infra/registry's ECR
  # repositories live in).
  managed_role_name_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-*"
  managed_oidc_provider_arn = aws_iam_openid_connect_provider.github_actions.arn

  # infra/cicd and infra/registry's own state objects in the shared bootstrap state bucket/lock
  # table (see tofu_state_bucket_arn/tofu_state_lock_table_arn's descriptions) — not the whole
  # bucket, so a compromised deploy role can't read/overwrite foundation's or a Trial Org's state.
  managed_state_object_arns = [
    "${var.tofu_state_bucket_arn}/cicd/terraform.tfstate",
    "${var.tofu_state_bucket_arn}/registry/terraform.tfstate",
  ]
}
