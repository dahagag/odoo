# Issue #218: tracks which commit is currently deployed to this shared ECS service, so ci.yml's
# release-order guard (.github/actions/guard-release-order) can tell a delayed dev/19.0 job for an
# older commit apart from a main/19.0 job for a newer one that already won the race — see
# infra/registry/cross_account_iam.tf's ManageAdministrationStackDeployedCommitParameter comment
# for the full scoping rationale.
#
# Terraform only creates the parameter (so its existence, name, tags, and IAM-visible ARN are
# declared here like every other resource) — it never owns the *value*. The deploy workflow
# overwrites that with `aws ssm put-parameter` on every deploy, which would otherwise show up as
# perpetual drift on the next `tofu plan`/`apply`, hence ignore_changes below.
#
# The other half of that split is enforced in .github/actions/record-deployed-commit: it skips its
# write entirely when the parameter is absent rather than letting `--overwrite` create one. That
# action deliberately runs *before* this apply, so if it ever created the parameter, this resource
# would always lose the race and fail with ParameterAlreadyExists — which is exactly how #218's
# first bootstrap deadlocked. Don't "fix" that from this side with `overwrite = true`: it's
# deprecated in AWS provider v5, and on create it would write the "unset" below straight over the
# commit the guard had just recorded.
resource "aws_ssm_parameter" "administration_stack_deployed_commit" {
  name        = var.administration_stack_deployed_commit_parameter_name
  type        = "String"
  value       = "unset"
  description = "Commit SHA last confirmed deployed to the administration-stack API's ECS service (issue #218's release-order guard). Value is managed by CI, not Terraform."
  tags        = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}
