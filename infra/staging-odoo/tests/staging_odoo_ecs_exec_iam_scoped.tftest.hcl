# #342 acceptance criterion: the post-deploy smoke check (dev_e2e_smoke_test, wired into
# deploy-odoo-staging in .github/workflows/ci.yml) reaches the running task via ECS Exec, since
# ADR-0040 leaves no other network path (no ALB, no public Route53 record, CI runner off the
# tailnet). ssmmessages has no resource-level permissions of its own (AWS's ECS Exec setup docs
# require "Resource": "*" for exactly these four actions on the task role), so this test instead
# asserts the grant is scoped to exactly those four actions and attached to the task role, not
# the execution role - mirroring staging_odoo_ssm_iam_scoped.tftest.hcl's own header and shape.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                       = "us-east-1"
  odoo_repository_url              = "111111111111.dkr.ecr.us-east-1.amazonaws.com/agentic-erp/odoo-staging"
  odoo_image_tag                   = "deadbeef"
  platform_assume_role_arn         = "arn:aws:iam::333333333333:role/platform-staging-odoo-deploy"
  staging_odoo_secrets_kms_key_arn = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_iam_role.ecs_task_execution
  values = {
    id  = "staging-odoo-execution"
    arn = "arn:aws:iam::111111111111:role/staging-odoo-execution"
  }
}

override_resource {
  target = aws_iam_role.ecs_task
  values = {
    id  = "staging-odoo-task"
    arn = "arn:aws:iam::111111111111:role/staging-odoo-task"
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_exec
  values = {
    id = "staging-odoo-task:staging-odoo-task-exec"
  }
}

run "verify_ecs_exec_channel_scoped_to_task_role" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_exec]
  }

  assert {
    condition = toset(jsondecode(aws_iam_role_policy.ecs_task_exec.policy).Statement[0].Action) == toset([
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ])
    error_message = "The ECS Exec channel grant must be scoped to exactly the four ssmmessages channel actions ECS Exec needs, not a broader SSM Session Manager grant."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_exec.role == aws_iam_role.ecs_task.id
    error_message = "The ECS Exec channel grant must attach to staging Odoo's own task role (the identity the running container assumes), not the execution role."
  }
}
