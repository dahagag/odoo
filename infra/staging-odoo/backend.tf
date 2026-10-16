# Remote state configuration — declared, not applied. Values for `bucket`, `region` and
# `dynamodb_table` come from `infra/bootstrap`'s outputs, supplied at `tofu init` time via
# `-backend-config`, not hardcoded here. See ../foundation/backend.tf, ../platform/backend.tf, and
# ../README.md's one-root-module-per-deployable-unit convention — this module gets its own state
# key, independent of `infra/platform` (the unrelated administration-stack API).
terraform {
  backend "s3" {
    key     = "staging-odoo/terraform.tfstate"
    encrypt = true
  }
}
