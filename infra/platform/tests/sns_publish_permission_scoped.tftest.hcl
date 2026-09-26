# Issue #198: the administration-stack API's ECS task role must be able to publish cost-dashboard
# alerts to its own SNS topic and nothing else — a resource-unscoped ("*") grant would let a
# compromised task publish to any topic in the account. No live AWS account is wired into this
# repo's CI (administration_stack_api_no_public_ingress.tftest.hcl's own header), so every
# resource's own creation is replaced by a literal stand-in (`override_resource`), mirroring
# ses_send_permission_scoped.tftest.hcl's own shape.

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
  cost_alert_email                        = "hosting-ops@factory1.tech"
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
  target = aws_sns_topic.cost_alerts
  values = {
    arn = "arn:aws:sns:us-east-1:111111111111:platform-cost-alerts"
  }
}

override_resource {
  target = aws_sns_topic_subscription.cost_alerts_email
  values = {
    id = "arn:aws:sns:us-east-1:111111111111:platform-cost-alerts:fake-subscription-id"
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_sns_publish
  values = {
    id = "platform-administration-stack-api-task:platform-administration-stack-api-sns-publish"
  }
}

override_resource {
  target = aws_iam_role_policy.ecs_task_cost_explorer_read
  values = {
    id = "platform-administration-stack-api-task:platform-administration-stack-api-cost-explorer-read"
  }
}

run "verify_sns_publish_scoped_to_the_cost_alerts_topic" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_sns_publish]
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_sns_publish.policy).Statement[0].Resource == aws_sns_topic.cost_alerts.arn
    error_message = "The ecs_task role's sns:Publish grant must be scoped to this one cost-alerts topic, not \"*\" or any other resource."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_sns_publish.policy).Statement[0].Action == "sns:Publish"
    error_message = "The ecs_task role must be granted exactly sns:Publish, not a broader SNS permission set."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_sns_publish.role == aws_iam_role.ecs_task.id
    error_message = "The sns:Publish grant must attach to the administration-stack API's own ECS task role."
  }
}

run "verify_cost_alerts_topic_and_subscription_are_provisioned" {
  command = apply

  plan_options {
    target = [aws_sns_topic.cost_alerts, aws_sns_topic_subscription.cost_alerts_email]
  }

  assert {
    condition     = aws_sns_topic_subscription.cost_alerts_email.topic_arn == aws_sns_topic.cost_alerts.arn
    error_message = "The email subscription must be on the cost-alerts topic itself."
  }

  assert {
    condition     = aws_sns_topic_subscription.cost_alerts_email.protocol == "email"
    error_message = "The cost-alerts subscription must be email (ADR-0030's amendment: \"an SNS topic with email subscribed\")."
  }

  assert {
    condition     = aws_sns_topic_subscription.cost_alerts_email.endpoint == var.cost_alert_email
    error_message = "The cost-alerts subscription must go to the configured var.cost_alert_email."
  }
}

run "verify_cost_explorer_read_grant" {
  command = apply

  plan_options {
    target = [aws_iam_role_policy.ecs_task_cost_explorer_read]
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.ecs_task_cost_explorer_read.policy).Statement[0].Action == "ce:GetCostAndUsage"
    error_message = "The ecs_task role must be granted exactly ce:GetCostAndUsage, not a broader Cost Explorer permission set."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_cost_explorer_read.role == aws_iam_role.ecs_task.id
    error_message = "The ce:GetCostAndUsage grant must attach to the administration-stack API's own ECS task role."
  }
}
