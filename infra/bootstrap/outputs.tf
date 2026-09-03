output "state_bucket_name" {
  value       = aws_s3_bucket.tofu_state.bucket
  description = "S3 bucket name to use as `bucket` in every other root module's partial backend config."
}

output "state_lock_table_name" {
  value       = aws_dynamodb_table.tofu_state_lock.name
  description = "DynamoDB table name to use as `dynamodb_table` in every other root module's partial backend config."
}

output "aws_region" {
  value       = var.aws_region
  description = "Region to use as `region` in every other root module's partial backend config."
}
