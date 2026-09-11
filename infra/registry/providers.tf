# Tagging convention: see infra/foundation/providers.tf — default_tags applies local.tags to
# every resource this module creates automatically; individual resources only add tags beyond
# that common set.
provider "aws" {
  region = var.aws_region

  # Issue #272: unset (null) for a human operator's first, bootstrap apply of this module (runs
  # with their own direct Platform Account credentials — see var.platform_assume_role_arn's own
  # description for why); set for every CI-driven apply/plan thereafter, once
  # platform_registry_deploy/platform_ci_plan below exist for it to chain into. A `dynamic` block
  # (not a plain `assume_role { role_arn = var.platform_assume_role_arn }`) because the `assume_role`
  # block itself must be entirely absent for the bootstrap case — a present block with a null
  # role_arn is a validation error, not a no-op.
  dynamic "assume_role" {
    for_each = var.platform_assume_role_arn == null ? [] : [var.platform_assume_role_arn]
    content {
      role_arn = assume_role.value
    }
  }

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}
