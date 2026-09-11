# Remote state configuration — declared, not applied. Values for `bucket`, `region` and
# `dynamodb_table` come from `infra/bootstrap`'s outputs, supplied at `tofu init` time via
# `-backend-config`, not hardcoded here. See ../foundation/backend.tf and ../README.md.
terraform {
  backend "s3" {
    key     = "platform/terraform.tfstate"
    encrypt = true
  }
}
