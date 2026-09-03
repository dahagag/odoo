# Per-Trial-Org lifecycle mutex (ADR-0020). Keyed by Trial Org id; the lock item's `owner`
# attribute holds the acquiring execution's own ARN so release can conditionally delete only the
# lock it actually holds. `expires_at` is a TTL backstop for locks an execution's own Catch and
# the EventBridge cleanup rule both fail to release.
resource "aws_dynamodb_table" "trial_org_lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "trial_org_id"

  attribute {
    name = "trial_org_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = local.tags
}
