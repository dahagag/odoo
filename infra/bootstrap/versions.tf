terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Deliberately local state: this module creates the S3 bucket + DynamoDB table that every
  # other root module's remote state depends on, so it cannot depend on that same backend for
  # its own state without a chicken-and-egg problem. Apply this module first, by hand, then
  # point `foundation`'s partial backend config at its outputs.
}
