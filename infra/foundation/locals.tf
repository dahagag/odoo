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

  # Naming convention every Trial Org's own CloudWatch log group follows
  # (/hosting/trial-orgs/<trial_org_id>, set by infra/modules/trial_org and passed to it here as
  # var.trial_org_log_group_prefix so both modules agree on one convention instead of hardcoding
  # it independently in two places).
  trial_org_log_group_arn_prefix = "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:${var.trial_org_log_group_prefix}"

  # Container name shared between the ECS task definition (ecs_task.tf) and the state machine's
  # RunTask ContainerOverrides (state_machine.tf) — kept in one place so the two can never drift.
  tofu_runner_container_name = "tofu-runner"
}

data "aws_caller_identity" "current" {}
