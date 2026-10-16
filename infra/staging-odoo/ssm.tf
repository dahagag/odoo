# Tracks which commit is currently deployed to this ECS service — mirrors
# infra/platform/ssm.tf's administration_stack_deployed_commit resource/comment exactly (issue
# #218's release-order guard), scoped to this module's own deploy pipeline. Terraform only
# declares the parameter's existence/name/tags; the deploy workflow owns the value.
resource "aws_ssm_parameter" "staging_odoo_deployed_commit" {
  name        = var.staging_odoo_deployed_commit_parameter_name
  type        = "String"
  value       = "unset"
  description = "Commit SHA last confirmed deployed to staging Odoo's ECS service (issue #218's release-order guard pattern). Value is managed by CI, not Terraform."
  tags        = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}
