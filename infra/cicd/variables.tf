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

variable "github_repository_immutable_subject" {
  type        = string
  description = <<-EOT
    The ID-qualified "owner@owner_id/repo@repo_id" form GitHub embeds in a token's `sub` claim for
    this repository, because this account has GitHub's "immutable subject" OIDC customization
    enabled (`gh api repos/<repo>/actions/oidc/customization/sub` confirms
    sub_claim_prefix = "repo:dahagag@2604865/odoo@1351561791" — not the plain "repo:dahagag/odoo"
    var.github_repository holds). staging_deploy_trust/production_deploy_trust's `sub` condition
    must match this exact qualified form, or sts:AssumeRoleWithWebIdentity is denied — found the
    hard way when the first real push-triggered infra-apply failed against the plain,
    unqualified form (issue #266). Not looked up dynamically (no GitHub provider/token wired into
    this module) — supplied as a default here, same convention as github_oidc_thumbprint above,
    since it's a fixed fact about this specific repository rather than a per-environment input.
    job_workflow_ref (ecr_push_trust's and infra_plan_trust's condition) is unaffected — confirmed
    elsewhere in oidc.tf that it stays plain owner/repo even with this setting enabled; only `sub`
    is ID-qualified.
  EOT
  default     = "dahagag@2604865/odoo@1351561791"
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

variable "tofu_state_bucket_arn" {
  type        = string
  description = <<-EOT
    ARN of the S3 bucket holding OpenTofu remote state (`infra/bootstrap`'s `state_bucket_name`
    output, as an ARN). Not looked up via remote state (this module has no data dependency on
    bootstrap's own state), supplied at apply time same as `platform_account_id` — used only to
    scope the deploy roles' backend-read/write statements (issue #215) to the exact state objects
    `infra/cicd` and `infra/registry` own (`cicd/terraform.tfstate`, `registry/terraform.tfstate`),
    not the whole bucket.
  EOT
}

variable "tofu_state_lock_table_arn" {
  type        = string
  description = <<-EOT
    ARN of the DynamoDB table backing OpenTofu's S3-backend state lock (`infra/bootstrap`'s
    `state_lock_table_name` output, as an ARN). Supplied at apply time, same convention as
    `tofu_state_bucket_arn` above — used only to let the deploy roles acquire/release the lock
    during a real `tofu apply` (issue #215); no per-item (`LockID`) condition, since every root
    module sharing this table already trusts each other's own state key naming.
  EOT
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
