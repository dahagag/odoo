locals {
  tags = merge(var.tags, {
    TrialOrgId   = var.trial_org_id
    ManagedBy    = "opentofu"
    TofuModule   = "trial_org"
    ModuleGitSha = var.module_git_sha
  })

  # Matches infra/foundation/locals.tf's trial_org_role_name_prefix/suffix convention, which the
  # foundation's ECS task role's iam:PassRole grant is scoped to.
  instance_role_name = "hosting-trial-${var.trial_org_id}-ec2-logs"

  domain = var.dns_environment == "prod" ? "${var.trial_org_subdomain_label}.${var.root_domain}" : "${var.trial_org_subdomain_label}.${var.dev_subdomain}"

  log_group_name = "${var.log_group_prefix}${var.trial_org_id}"
}
