locals {
  tags = merge(var.tags, {
    TofuModule = "cicd"
  })

  # GitHub's own fixed OIDC issuer URL and the audience every GitHub Actions OIDC token is
  # minted for (not repo-specific, so not a variable).
  github_oidc_provider_url = "https://token.actions.githubusercontent.com"
  github_oidc_audience     = "sts.amazonaws.com"

  ecr_repository_arns = [
    for name in var.ecr_repository_names :
    "arn:aws:ecr:${var.aws_region}:${var.platform_account_id}:repository/${name}"
  ]

  # The one repository ci.yml's test job pulls back (issue #259) — the dev image build-image just
  # pushed, to run the test matrix against it. Not all four: nothing else in this repo's CI pulls
  # any of the other three.
  odoo_dev_repository_arn = "arn:aws:ecr:${var.aws_region}:${var.platform_account_id}:repository/agentic-erp/odoo-dev"

  # Issue #215: the deploy roles now also manage infra/cicd and infra/registry themselves (a
  # `tofu apply` in either root module touches the OIDC provider, these three roles, and the four
  # ECR repositories) — so their IAM-management statement is scoped to exactly the resource shapes
  # those two modules create, by ARN pattern, in *this* account (data.aws_caller_identity.current,
  # not platform_account_id, which is the separate Platform Account infra/registry's ECR
  # repositories live in).
  managed_role_name_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-*"
  managed_oidc_provider_arn = aws_iam_openid_connect_provider.github_actions.arn

  # infra/cicd and infra/registry's own state objects in the shared bootstrap state bucket/lock
  # table (see tofu_state_bucket_arn/tofu_state_lock_table_arn's descriptions) — not the whole
  # bucket, so a compromised deploy role can't read/overwrite foundation's or a Trial Org's state.
  managed_state_object_arns = [
    "${var.tofu_state_bucket_arn}/cicd/terraform.tfstate",
    "${var.tofu_state_bucket_arn}/registry/terraform.tfstate",
  ]

  # Issue #216: staging_deploy alone (not production_deploy — that's #217's job) also applies
  # infra/platform now, so it needs read/write on that root module's own state object too. Kept
  # out of managed_state_object_arns/infra_management_statements above (shared by both deploy
  # roles) specifically so production_deploy gains no access to infra/platform's state until #217
  # defines what a production deploy touches.
  administration_stack_platform_state_object_arn = "${var.tofu_state_bucket_arn}/platform/terraform.tfstate"

  # The one ECR repository (of the four ecr_repository_arns covers) staging_deploy needs write
  # access to — to add the release-version tag to the image ecr_push already pushed at PR time
  # (issue #216: "deploys the administration stack's image tagged with the derived release
  # version"), not to push new image content (that stays ecr_push's job, PR-time only).
  administration_stack_api_repository_arn = "arn:aws:ecr:${var.aws_region}:${var.platform_account_id}:repository/agentic-erp/administration-stack-api"

  # Naming convention infra/platform's own ECS task execution/task roles follow
  # (iam.tf: "${var.environment}-administration-stack-api-execution" / "-task", environment
  # defaulting to "platform") — staging_deploy's own iam:CreateRole/PutRolePolicy/PassRole grant
  # below is scoped to this pattern, not a bare "*" or "github-actions-*" (which wouldn't even
  # match these role names, but the point is the same narrow-by-pattern discipline
  # manage_own_role_staging_deploy already uses for its own role).
  administration_stack_task_role_arn_pattern = "arn:aws:iam::${var.platform_account_id}:role/${var.administration_stack_ecs_cluster_name}-administration-stack-api-*"

  administration_stack_ecs_cluster_arn = "arn:aws:ecs:${var.aws_region}:${var.platform_account_id}:cluster/${var.administration_stack_ecs_cluster_name}"
  administration_stack_task_family_arn = "arn:aws:ecs:${var.aws_region}:${var.platform_account_id}:task-definition/${var.administration_stack_task_family}:*"
  administration_stack_service_arn     = "arn:aws:ecs:${var.aws_region}:${var.platform_account_id}:service/${var.administration_stack_ecs_cluster_name}/${var.administration_stack_ecs_service_name}"
  administration_stack_log_group_arn   = "arn:aws:logs:${var.aws_region}:${var.platform_account_id}:log-group:/ecs/${var.administration_stack_ecs_cluster_name}/administration-stack-api"
}
