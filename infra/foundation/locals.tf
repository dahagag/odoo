locals {
  tags = merge(var.tags, {
    Environment = var.environment
    TofuModule  = "foundation"
  })

  account_id = data.aws_caller_identity.current.account_id

  # Naming convention the trial_org module's per-Trial-Org instance role follows
  # (hosting-trial-<trial_org_id>-ec2-logs). The ECS task role's iam:PassRole grant below is
  # scoped to this pattern rather than a bare "*" — see iam.tf for the full reasoning.
  trial_org_role_name_prefix = "hosting-trial-"
  trial_org_role_name_suffix = "-ec2-logs"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
