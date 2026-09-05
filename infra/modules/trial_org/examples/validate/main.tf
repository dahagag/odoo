# Standalone fixture supplying dummy-but-valid variable values so `tofu validate` can exercise
# the trial_org module's variable validations and resource wiring without a real caller (per
# ../../README.md, nothing in this repo invokes the module yet). Reused by both the infra-checks
# CI job and any human validating this module locally:
#
#   cd infra/modules/trial_org/examples/validate
#   tofu init -backend=false
#   tofu validate
#
# No backend/provider credentials are required or used — `validate` makes no AWS calls.

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

  trial_org_id              = "12345"
  trial_org_subdomain_label = "acme-widgets"
  dns_environment           = "dev"

  vpc_id    = "vpc-00000000000000000"
  subnet_id = "subnet-00000000000000000"

  ami_id = "ami-00000000000000000"

  route53_zone_id = "Z00000000000000EXAMPLE"
  root_domain     = "example.com"
  dev_subdomain   = "dev.example.com"

  log_forwarder_lambda_arn = "arn:aws:lambda:us-east-1:123456789012:function:log-forwarder"

  instance_role_permissions_boundary_arn = "arn:aws:iam::123456789012:policy/trial-org-boundary"

  module_git_sha = "0000000000000000000000000000000000000000"
}
