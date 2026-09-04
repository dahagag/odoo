# Remote state configuration — declared, not applied. Values for `bucket`, `region` and
# `dynamodb_table` come from the `infra/bootstrap` module's outputs and are supplied at
# `tofu init` time via `-backend-config` (or a gitignored `backend.hcl`), not hardcoded here,
# since they're environment-specific and this file is the same across environments.
#
# Example:
#   tofu init \
#     -backend-config="bucket=<bootstrap state_bucket_name output>" \
#     -backend-config="region=<bootstrap aws_region output>" \
#     -backend-config="dynamodb_table=<bootstrap state_lock_table_name output>"
#
# For local `tofu validate` (no AWS calls) or a `tofu plan` against a mock/local backend, run
# `tofu init -backend=false` instead of the above — see ../README.md.
terraform {
  backend "s3" {
    key     = "foundation/terraform.tfstate"
    encrypt = true
  }
}
