# Issue #216: the administration-stack API's ECS service has no load balancer and no public
# ingress (epic #193 story 18: "the administration surface unreachable from the public
# internet"). This proves that boundary directly against the real module, the same way
# infra/cicd's tftest.hcl suite proves its own IAM scoping — no live AWS account is wired into
# this repo's CI, so every resource's own creation is replaced by a literal stand-in
# (`override_resource`), and nothing here ever makes a real AWS API call. `command = apply` (not
# `plan`) throughout: aws_security_group's ingress/egress attributes are only fully known once
# the provider has actually "created" the resource, even when config sets them, so a plan-time
# condition on them errors with "Unknown condition run".

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
    arn = "arn:aws:iam::111111111111:role/platform-administration-stack-api-task"
  }
}

override_resource {
  target = aws_ecs_task_definition.administration_stack_api
  values = {
    arn = "arn:aws:ecs:us-east-1:111111111111:task-definition/platform-administration-stack-api:1"
  }
}

override_resource {
  target = aws_ecs_service.administration_stack_api
  values = {
    id = "arn:aws:ecs:us-east-1:111111111111:service/platform/platform-administration-stack-api"
  }
}

run "verify_no_public_ingress" {
  command = apply

  plan_options {
    target = [aws_security_group.administration_stack_api]
  }

  assert {
    condition     = length(aws_security_group.administration_stack_api.ingress) == 0
    error_message = "The administration-stack API's security group must have no ingress rule at all — it must not be reachable from the public internet or elsewhere in the VPC."
  }
}

run "verify_service_runs_in_private_subnets_with_no_public_ip" {
  command = apply

  plan_options {
    target = [
      aws_ecs_task_definition.administration_stack_api,
      aws_ecs_service.administration_stack_api,
    ]
  }

  assert {
    condition     = aws_ecs_service.administration_stack_api.network_configuration[0].assign_public_ip == false
    error_message = "The administration-stack API's ECS service must not assign a public IP to its tasks."
  }

  assert {
    condition = toset(aws_ecs_service.administration_stack_api.network_configuration[0].subnets) == toset([
      for subnet in aws_subnet.private : subnet.id
    ])
    error_message = "The administration-stack API's ECS service must run in exactly the private subnets, not the public ones."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.administration_stack_api.container_definitions)[0].image == "111111111111.dkr.ecr.us-east-1.amazonaws.com/agentic-erp/administration-stack-api:v1.2.3"
    error_message = "The task definition's container image must be the ECR repository URL tagged with var.administration_stack_image_tag — this is what makes an apply a deploy of that specific release."
  }

  assert {
    condition = anytrue([
      for env in jsondecode(aws_ecs_task_definition.administration_stack_api.container_definitions)[0].environment :
      env.name == "RELEASE_VERSION" && env.value == "v1.2.3"
    ])
    error_message = "The container must receive RELEASE_VERSION so /healthz can report which release is running without cross-referencing ECR/ECS directly (issue #216)."
  }

  assert {
    condition     = aws_ecs_service.administration_stack_api.tags["Release"] == "v1.2.3"
    error_message = "The ECS service's own Release tag must match the deployed image tag, so 'what's running in staging' is answerable via `aws ecs describe-services` alone."
  }
}
