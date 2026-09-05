# CI/local `tofu validate` fixture for the `trial_org` module — not a deployable root module.
#
# Supplies dummy-but-valid values for every required variable so `tofu validate` exercises the
# module the way a real invocation would (type-checking against actual argument values, not just
# the module's own internal syntax), without needing real AWS resource ids or network access.
# Never `tofu apply` this — it has no backend configured and its values don't correspond to any
# real VPC/subnet/zone/AMI.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "trial_org" {
  source = "../.."

  trial_org_id              = "123456"
  trial_org_subdomain_label = "example-trial"
  dns_environment           = "dev"

  vpc_id    = "vpc-0123456789abcdef0"
  subnet_id = "subnet-0123456789abcdef0"

  ami_id = "ami-0123456789abcdef0"

  route53_zone_id = "Z0123456789ABCDEFGHIJ"
  root_domain     = "example.test"
  dev_subdomain   = "dev.example.test"

  log_forwarder_lambda_arn = "arn:aws:lambda:us-east-1:123456789012:function:log-forwarder"

  instance_role_permissions_boundary_arn = "arn:aws:iam::123456789012:policy/example-boundary"

  module_git_sha = "0000000000000000000000000000000000000000"
}
