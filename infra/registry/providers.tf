# Tagging convention: see infra/foundation/providers.tf — default_tags applies local.tags to
# every resource this module creates automatically; individual resources only add tags beyond
# that common set.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
