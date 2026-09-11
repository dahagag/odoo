# Tagging convention: see infra/foundation/providers.tf — default_tags applies local.tags to
# every resource this module creates automatically; individual resources only add tags beyond
# that common set.
provider "aws" {
  region = var.aws_region

  # Issue #271/#272: this module's real resources live in the Platform Account, but every CI job
  # that plans/applies it authenticates as a Hosting Account role (staging_deploy or infra_plan,
  # via GitHub OIDC) — EC2/ECS/IAM/Logs have no cross-account resource-based policy mechanism, so
  # the only way that Hosting Account identity can act here is by assuming a role that already
  # exists in this account and explicitly trusts it (infra/registry's
  # platform_administration_stack_deploy or platform_ci_plan). Unlike infra/registry's own
  # provider, this is never optional/dynamic — infra/platform is never applied by a human
  # operator directly (infra/README.md), only ever through this chain.
  assume_role {
    role_arn = var.platform_assume_role_arn
  }

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}
