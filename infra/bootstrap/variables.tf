variable "aws_region" {
  type        = string
  description = "AWS region the Hosting Account's OpenTofu state backend lives in."
  default     = "us-east-1"
}

variable "state_bucket_name" {
  type        = string
  description = <<-EOT
    Globally-unique S3 bucket name for OpenTofu remote state (both `foundation` and every
    per-Trial-Org `trial-orgs/<trial_org_id>/terraform.tfstate` object live in this one bucket,
    per ADR-0016's state-key isolation).
  EOT
}

variable "state_lock_table_name" {
  type        = string
  description = <<-EOT
    DynamoDB table name for OpenTofu's own S3-backend state locking. Distinct from the
    Trial-Org-lifecycle orchestration lock table declared in `foundation` (ADR-0020) — this table
    only ever holds OpenTofu's own lock-per-state-file items, one per concurrent `tofu` run.
  EOT
}

variable "tags" {
  type        = map(string)
  description = "Common tags applied to every resource this module creates."
  default = {
    Project    = "hosting-operations"
    ManagedBy  = "opentofu"
    TofuModule = "bootstrap"
  }
}
