# ADR-0040 acceptance criterion: staging Odoo has no public surface at all — no ALB, no WAFv2, no
# public Route53 record, and every access tier reaches it over the Tailscale sidecar container
# instead. No live AWS account is wired into this repo's CI (same precedent as
# infra/platform/tests/administration_stack_api_no_public_ingress.tftest.hcl's own header), so
# every resource's own creation is replaced by a literal stand-in (`override_resource`), and
# nothing here ever makes a real AWS API call. `command = apply` (not `plan`) throughout: a
# security group's ingress/egress attributes are only fully known post-"create" even with config
# setting them (same "Unknown condition run" plan-time error that file's own header explains).

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
  target = aws_security_group.staging_odoo
  values = {
    id = "sg-0123456789abcdef0"
  }
}

override_resource {
  target = aws_ecs_cluster.staging_odoo
  values = {
    id  = "arn:aws:ecs:us-east-1:111111111111:cluster/staging-odoo"
    arn = "arn:aws:ecs:us-east-1:111111111111:cluster/staging-odoo"
  }
}

override_resource {
  target = aws_cloudwatch_log_group.postgres
  values = {
    arn = "arn:aws:logs:us-east-1:111111111111:log-group:/ecs/staging-odoo/postgres"
  }
}

override_resource {
  target = aws_cloudwatch_log_group.odoo
  values = {
    arn = "arn:aws:logs:us-east-1:111111111111:log-group:/ecs/staging-odoo/odoo"
  }
}

override_resource {
  target = aws_cloudwatch_log_group.tailscale
  values = {
    arn = "arn:aws:logs:us-east-1:111111111111:log-group:/ecs/staging-odoo/tailscale"
  }
}

override_resource {
  target = aws_iam_role.ecs_task_execution
  values = {
    arn = "arn:aws:iam::111111111111:role/staging-odoo-execution"
  }
}

override_resource {
  target = aws_iam_role.ecs_task
  values = {
    arn = "arn:aws:iam::111111111111:role/staging-odoo-task"
  }
}

override_resource {
  target = aws_ecs_task_definition.staging_odoo
  values = {
    arn = "arn:aws:ecs:us-east-1:111111111111:task-definition/staging-odoo:1"
  }
}

override_resource {
  target = aws_ecs_service.staging_odoo
  values = {
    id = "arn:aws:ecs:us-east-1:111111111111:service/staging-odoo/staging-odoo"
  }
}

run "verify_no_public_ingress" {
  command = apply

  plan_options {
    target = [aws_security_group.staging_odoo]
  }

  assert {
    condition     = length(aws_security_group.staging_odoo.ingress) == 0
    error_message = "Staging Odoo's security group must have no ingress rule at all - it must not be reachable from the public internet or elsewhere in the VPC. Every access tier reaches it over the Tailscale sidecar instead (ADR-0040)."
  }
}

run "verify_service_runs_in_private_subnets_with_no_public_ip" {
  command = apply

  plan_options {
    target = [
      aws_ecs_task_definition.staging_odoo,
      aws_ecs_service.staging_odoo,
    ]
  }

  assert {
    condition     = aws_ecs_service.staging_odoo.network_configuration[0].assign_public_ip == false
    error_message = "Staging Odoo's ECS service must not assign a public IP to its tasks."
  }

  assert {
    condition = toset(aws_ecs_service.staging_odoo.network_configuration[0].subnets) == toset([
      for subnet in aws_subnet.private : subnet.id
    ])
    error_message = "Staging Odoo's ECS service must run in exactly the private subnets, not the public ones."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.staging_odoo.container_definitions)[1].image == "111111111111.dkr.ecr.us-east-1.amazonaws.com/agentic-erp/odoo-staging:deadbeef"
    error_message = "The odoo container's image must be the ECR repository URL tagged with var.odoo_image_tag."
  }

  assert {
    condition = anytrue([
      for container in jsondecode(aws_ecs_task_definition.staging_odoo.container_definitions) :
      container.name == "tailscale"
    ])
    error_message = "The task definition must include a Tailscale sidecar container - it is the only way any access tier reaches staging Odoo at all (ADR-0040: no ALB, no WAFv2, no public Route53 record)."
  }

  assert {
    condition = anytrue([
      for container in jsondecode(aws_ecs_task_definition.staging_odoo.container_definitions) :
      container.name == "tailscale" && anytrue([
        for env in container.environment : env.name == "TS_EXTRA_ARGS" && strcontains(env.value, "tag:dev-domain-com")
      ])
    ])
    error_message = "The Tailscale sidecar must advertise the device tag that the tailnet's own ACL policy wires group:engineering/group:stakeholders/group:early-adopters access onto (ADR-0040)."
  }

  assert {
    condition = anytrue([
      for container in jsondecode(aws_ecs_task_definition.staging_odoo.container_definitions) :
      container.name == "tailscale" && anytrue([
        for secret in container.secrets : secret.name == "TS_AUTHKEY"
      ])
    ])
    error_message = "The Tailscale sidecar must resolve its auth key from an SSM-backed ECS secret, never a plaintext environment variable."
  }
}
