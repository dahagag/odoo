# Tagging convention: see infra/foundation/providers.tf — default_tags applies local.tags to
# every resource this module creates automatically; individual resources only add tags beyond
# that common set.
provider "aws" {
  region = var.aws_region

  # This module's real resources live in the Platform Account (ADR-0040: dev.domain.com is
  # agentic-erp's own staging Odoo, alongside production, not Hosting Account infrastructure),
  # mirroring infra/platform's own issue #271/#272 cross-account role-chaining convention: every
  # CI job that plans/applies this module authenticates as a Hosting Account role first, then
  # assumes into a Platform Account role that already exists and explicitly trusts it. Never
  # applied by a human operator directly with real Platform Account credentials — always through
  # this chain (infra/README.md).
  assume_role {
    role_arn = var.platform_assume_role_arn
  }

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}
