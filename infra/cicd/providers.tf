# Tagging convention: see infra/foundation/providers.tf — default_tags applies local.tags to
# every resource this module creates automatically; individual resources only add tags beyond
# that common set.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

# Issue #215: this account's id, used to build the `github-actions-*` role ARN pattern the deploy
# roles' IAM-management statement is scoped to (local.managed_role_name_pattern) — not a variable,
# since it's a fact about the account this module is applied against, not a per-environment input.
data "aws_caller_identity" "current" {}
