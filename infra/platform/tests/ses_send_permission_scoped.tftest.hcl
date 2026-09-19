# Issue #327: the administration-stack API's ECS task role must be able to call ses:SendEmail for
# its own verified sending domain and nothing else — a resource-unscoped ("*") grant would let a
# compromised task send mail as any identity in the account. No live AWS account is wired into
# this repo's CI (administration_stack_api_no_public_ingress.tftest.hcl's own header), so every
# resource's own creation is replaced by a literal stand-in (`override_resource`).

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  aws_region                              = "us-east-1"
  administration_stack_api_repository_url = "111111111111.dkr.ecr.us-east-1.amazonaws.com/agentic-erp/administration-stack-api"
  administration_stack_image_tag          = "v1.2.3"
  platform_assume_role_arn                = "arn:aws:iam::333333333333:role/platform-administration-stack-deploy"
  ses_sending_domain                      = "notifications.method.factory1.io"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
  }
}

override_resource {
  target = aws_vpc.main
  values = {
    id = "vpc-0123456789abcdef0"
  }
}

override_resource {
  target = aws_subnet.private
  values = {
    id = "subnet-0123456789abcdef0"
  }
}

override_resource {
  target = aws_security_group.administration_stack_api
  values = {
    id = "sg-0123456789abcdef0"
  }
}

override_resource {
  target = aws_ecs_cluster.platform
  values = {
    id  = "arn:aws:ecs:us-east-1:111111111111:cluster/platform"
    arn = "arn:aws:ecs:us-east-1:111111111111:cluster/platform"
  }
}

override_resource {
  target = aws_cloudwatch_log_group.administration_stack_api
  values = {
    arn = "arn:aws:logs:us-east-1:111111111111:log-group:/ecs/platform/administration-stack-api"
  }
}

override_resource {
  target = aws_iam_role.ecs_task_execution
  values = {
    arn = "arn:aws:iam::111111111111:role/platform-administration-stack-api-execution"
  }
}

override_resource {
  target = aws_iam_role.ecs_task
  values = {
    id  = "platform-administration-stack-api-task"
    arn = "arn:aws:iam::111111111111:role/platform-administration-stack-api-task"
  }
}

override_resource {
  target = aws_ses_domain_identity.sender
  values = {
    arn                = "arn:aws:ses:us-east-1:111111111111:identity/notifications.method.factory1.io"
    verification_token = "fake-verification-token"
  }
}

override_resource {
  target = aws_ses_domain_dkim.sender
  values = {
    dkim_tokens = ["fake-dkim-token-1", "fake-dkim-token-2", "fake-dkim-token-3"]
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_ses_send
  values = {
    id = "platform-administration-stack-api-task:platform-administration-stack-api-ses-send"
  }
}

run "verify_ses_send_scoped_to_the_domain_identity" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_ses_send]
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_ses_send.policy).Statement[0].Resource == aws_ses_domain_identity.sender.arn
    error_message = "The ecs_task role's ses:SendEmail grant must be scoped to this one verified SES domain identity, not \"*\" or any other resource."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_ses_send.policy).Statement[0].Action == "ses:SendEmail"
    error_message = "The ecs_task role must be granted exactly ses:SendEmail, not a broader SES permission set (SesEmailSender never calls SendRawEmail)."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_ses_send.role == aws_iam_role.ecs_task.id
    error_message = "The ses:SendEmail grant must attach to the administration-stack API's own ECS task role."
  }
}

run "verify_domain_identity_and_dkim_are_provisioned" {
  command = apply

  plan_options {
    target = [aws_ses_domain_identity.sender, aws_ses_domain_dkim.sender]
  }

  assert {
    condition     = aws_ses_domain_identity.sender.domain == var.ses_sending_domain
    error_message = "The SES domain identity must be provisioned for var.ses_sending_domain."
  }

  assert {
    condition     = aws_ses_domain_dkim.sender.domain == aws_ses_domain_identity.sender.domain
    error_message = "DKIM must be enabled for the same domain the domain identity verifies."
  }
}
