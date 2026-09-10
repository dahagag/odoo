variable "aws_region" {
  type        = string
  description = "AWS region API calls for this module's (global) IAM/OIDC resources are made against."
  default     = "us-east-1"
}

variable "github_repository" {
  type        = string
  description = "GitHub \"owner/repo\" this OIDC provider and its deploy roles trust — only workflow runs from this exact repository (never a fork) can assume either role."
  default     = "dahagag/odoo"
}

variable "staging_branch" {
  type        = string
  description = "Branch whose workflow runs may assume staging_deploy (docs/agents/sdlc.md's default/staging branch)."
  default     = "dev/19.0"
}

variable "production_branch" {
  type        = string
  description = "Branch whose workflow runs may assume production_deploy (docs/agents/sdlc.md's protected production branch)."
  default     = "main/19.0"
}

variable "platform_account_id" {
  type        = string
  description = "Platform Account id (ADR-0038) — the account infra/registry's four ECR repositories live in. Used only to build the ecr_push role's resource ARN pattern (arn:aws:ecr:<region>:<platform_account_id>:repository/agentic-erp/<image>); no cross-module remote-state lookup, since the repository names are already fixed by ADR-0038's naming decision."
}

variable "ecr_repository_names" {
  type        = list(string)
  description = "ECR repository names (ADR-0038 topology) the ecr_push role's policy is scoped to, by ARN pattern."
  default = [
    "agentic-erp/odoo-dev",
    "agentic-erp/odoo-prod",
    "agentic-erp/tofu-runner",
    "agentic-erp/administration-stack-api",
  ]
}

variable "github_oidc_thumbprint" {
  type        = string
  description = <<-EOT
    SHA-1 thumbprint of GitHub's OIDC token issuer TLS certificate chain, required by
    aws_iam_openid_connect_provider's schema. AWS has validated GitHub's OIDC provider against its
    own trusted CA store (not this thumbprint) since 2022, per AWS's GitHub OIDC documentation, but
    the field is still mandatory — this defaults to the well-known root CA thumbprint every
    current Terraform/OpenTofu GitHub Actions OIDC example uses.
  EOT
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}

variable "tags" {
  type        = map(string)
  description = "Common tags merged onto every resource this module creates."
  default = {
    Project   = "hosting-operations"
    ManagedBy = "opentofu"
  }
}
