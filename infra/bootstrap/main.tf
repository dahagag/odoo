provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.tags
  }
}

# S3 bucket holding every OpenTofu state file for this project: `foundation/terraform.tfstate`
# and one `trial-orgs/<trial_org_id>/terraform.tfstate` object per Trial Org (ADR-0016).
resource "aws_s3_bucket" "tofu_state" {
  bucket = var.state_bucket_name

  # Deliberately no `force_destroy`: destroying this bucket by accident would take every Trial
  # Org's and the foundation's OpenTofu state with it.
}

resource "aws_s3_bucket_versioning" "tofu_state" {
  bucket = aws_s3_bucket.tofu_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tofu_state" {
  bucket = aws_s3_bucket.tofu_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tofu_state" {
  bucket = aws_s3_bucket.tofu_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3-backend state locking table (one item per state file while it's being written).
resource "aws_dynamodb_table" "tofu_state_lock" {
  name         = var.state_lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
