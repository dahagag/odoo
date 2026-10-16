variable "aws_region" {
  type        = string
  description = "AWS region this module's Platform Account resources are created in (ADR-0015)."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Short environment name used in resource names/tags (e.g. \"staging-odoo\")."
  default     = "staging-odoo"
}

variable "platform_assume_role_arn" {
  type        = string
  description = <<-EOT
    Platform Account role ARN this module's own AWS provider assumes into before creating/reading
    any resource (issue #271/#272 pattern, same as infra/platform's identically-named variable) —
    a cross-account deploy role dedicated to this module, or the shared platform_ci_plan role for
    the PR-time plan job. Supplied at apply time, no cross-module terraform_remote_state lookup
    (infra/README.md's no-remote-state convention).
  EOT
}

variable "staging_odoo_deployed_commit_parameter_name" {
  type        = string
  description = <<-EOT
    Name of the SSM parameter tracking the commit SHA last confirmed deployed to this ECS
    service — mirrors infra/platform/variables.tf's identically-shaped
    administration_stack_deployed_commit_parameter_name (issue #218's release-order guard),
    scoped to this module's own deploy pipeline instead.
  EOT
  default     = "/staging-odoo/deployed-commit"
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------
#
# A dedicated VPC, not a reuse of infra/foundation's (Hosting Account) or infra/platform's
# (administration-stack API, an unrelated workload) — same "one small ECS service" sizing as
# infra/platform/variables.tf's own networking comments, one NAT gateway rather than a per-AZ pair.
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the staging Odoo VPC. Distinct range from infra/foundation's Hosting Account VPC (10.42.0.0/16) and infra/platform's administration-stack VPC (10.60.0.0/16) — never peered with either, but kept disjoint to avoid confusion if that ever changes."
  default     = "10.61.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones to spread subnets across."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets (one per AZ) — hold only the NAT gateway. Staging Odoo itself has no public listener at all (ADR-0040): no ALB, no WAFv2, no public Route53 record."
  default     = ["10.61.0.0/24", "10.61.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets (one per AZ). The staging Odoo ECS task runs here, with no assigned public IP and no inbound ingress rule — reachable only over the Tailscale sidecar (ADR-0040)."
  default     = ["10.61.10.0/24", "10.61.11.0/24"]
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

variable "ecs_cluster_name" {
  type        = string
  description = "Name of the Platform Account ECS cluster staging Odoo's task runs in. A dedicated cluster, not infra/platform's \"platform\" cluster — this module has its own backend.tf state key and lifecycle, independent of the administration-stack API."
  default     = "staging-odoo"
}

variable "odoo_repository_url" {
  type        = string
  description = "Repository URL of the staging Odoo image's ECR repository. Supplied at apply time, same no-remote-state convention as infra/platform's administration_stack_api_repository_url."
}

variable "odoo_image_tag" {
  type        = string
  description = "Image tag this apply deploys to staging — the current dev/19.0 content-hash or release tag, same role infra/platform's administration_stack_image_tag plays for the administration-stack API."
}

variable "odoo_container_port" {
  type        = number
  description = "Port Odoo listens on inside the container (odoo.conf's default http_port)."
  default     = 8069
}

variable "postgres_image" {
  type        = string
  description = <<-EOT
    Postgres image for the in-task database container. Staging has no persistent data of any
    kind (#203's own Out of Scope) and the database is dropped and recreated on every deploy
    anyway (ADR-0041), so this runs as a third container in the same task rather than a
    separate stateful service this repo has no RDS/EFS precedent for — losing its ephemeral
    Fargate storage on a task restart is an accepted consequence of "disposable by definition".
  EOT
  default     = "postgres:16"
}

variable "postgres_user" {
  type        = string
  description = "Postgres role name staging Odoo connects as. Not sensitive on its own (no real data behind it, never reachable outside this task's own network namespace) — only the password is SSM-sourced."
  default     = "odoo"
}

variable "odoo_db_name" {
  type        = string
  description = "Database name the entrypoint drops/recreates and installs crm_methodology into (ADR-0041)."
  default     = "staging_odoo"
}

variable "odoo_cpu" {
  type        = string
  description = "Fargate task-level vCPU units for the staging Odoo task (covers all three containers: postgres, odoo, tailscale)."
  default     = "1024"
}

variable "odoo_memory" {
  type        = string
  description = "Fargate task-level memory (MiB) for the staging Odoo task (covers all three containers)."
  default     = "3072"
}

variable "odoo_desired_count" {
  type        = number
  description = "Desired ECS service task count. Kept at 1 — staging is \"sized small, a proving ground\" (#203), not a performance environment."
  default     = 1
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs retention (days) for staging Odoo's log groups."
  default     = 30
}

# ---------------------------------------------------------------------------
# Tailscale (ADR-0040): every access tier — engineering, internal stakeholders, named
# early-adopter clients — reaches staging over one tailnet, no public surface at all. This
# module runs the sidecar container and tags the device; the three ACL groups
# (group:engineering/group:stakeholders/group:early-adopters) themselves are configured in
# Tailscale's own ACL policy (ops-side, outside this repo — no `tailscale` Terraform provider
# exists here, confirmed by a repo-wide search before writing this module), referencing the
# advertised tag(s) below to grant each group whatever access the ACL policy assigns it.
# ---------------------------------------------------------------------------

variable "tailscale_image" {
  type        = string
  description = "Tailscale sidecar container image. Pinned, not \"latest\" — a mutable tag in a security-relevant sidecar is its own supply-chain risk."
  default     = "tailscale/tailscale:v1.76.6"
}

variable "tailscale_advertise_tags" {
  type        = list(string)
  description = "Tailscale ACL tag(s) this device advertises (TS_EXTRA_ARGS=--advertise-tags). Tailscale's ACL policy grants group:engineering/group:stakeholders/group:early-adopters access to whichever tagged device(s) match these tags — the actual group-to-tag grant lives in the tailnet's own ACL policy, not in this module."
  default     = ["tag:dev-domain-com"]
}

variable "tailscale_hostname" {
  type        = string
  description = "Tailscale device hostname (TS_HOSTNAME) — how staging Odoo shows up in the tailnet and in each access tier's own MagicDNS."
  default     = "dev-domain-com"
}

# ---------------------------------------------------------------------------
# Secrets (ADR-0041): the Odoo admin password and every seed-account (early-adopter/stakeholder)
# password are real logins, never committed. They are read from SSM SecureString parameters at
# deploy/boot time — exactly infra/foundation/lambda_src/log_forwarder's existing
# SecureString + `GetParameter --with-decryption` pattern (infra/foundation/lambda.tf's
# log_forwarder IAM policy document is the shape this module's iam.tf copies).
#
# None of these aws_ssm_parameter resources are created by this module (ssm.tf creates only the
# deployed-commit watermark, a plain String parameter whose value CI owns). The SecureString
# parameters themselves, and the KMS key they're encrypted under, are provisioned out-of-band by
# a human operator — mirroring infra/foundation/lambda.tf's own log_forwarder_hmac_secret
# variables, which are plain name/ARN inputs with no corresponding resource in that module either.
# This module only ever reads them, and only ever through an IAM grant scoped to their exact ARNs
# plus the one KMS key — never a plaintext value, and never a wildcarded resource.
# ---------------------------------------------------------------------------

variable "staging_odoo_secrets_kms_key_arn" {
  type        = string
  description = "ARN of the KMS key every staging-Odoo SSM SecureString parameter below is encrypted under. Scoped kms:Decrypt grants reference exactly this key, never \"*\" or the default alias/aws/ssm key implicitly."
}

variable "tailscale_authkey_ssm_parameter_name" {
  type        = string
  description = "SSM SecureString parameter name holding the Tailscale auth key. Resolved by the ECS agent itself at container start (container_definitions' `secrets`, execution-role-scoped) — never passed through application code."
  default     = "/staging-odoo/tailscale-authkey"
}

variable "postgres_password_ssm_parameter_name" {
  type        = string
  description = "SSM SecureString parameter name holding the in-task Postgres role's password. Resolved by the ECS agent at container start for both the postgres and odoo containers (same parameter, same execution-role grant) — never a plaintext default, even though this database holds no persistent data."
  default     = "/staging-odoo/postgres-password"
}

variable "odoo_admin_password_ssm_parameter_name" {
  type        = string
  description = "SSM SecureString parameter name holding the Odoo admin_passwd. Read by the staging entrypoint itself (task-role-scoped ssm:GetParameter --with-decryption, not an ECS-native secret) — the entrypoint applies it post-install, mirroring ADR-0041's seed-account password handling."
  default     = "/staging-odoo/odoo-admin-password"
}

variable "seed_account_password_ssm_parameter_path" {
  type        = string
  description = <<-EOT
    SSM parameter path prefix under which every early-adopter/stakeholder seed account's own
    password SecureString parameter lives (e.g. "/staging-odoo/seed-accounts/priya"). Account
    provisioning and revocation is a repo change plus a deploy (ADR-0041) — the entrypoint/seed
    data (#339) enumerate the actual logins; this module only grants ssm:GetParameter/kms:Decrypt
    across this one path prefix, so adding or removing a named account never needs a Terraform
    change to the IAM grant itself.
  EOT
  default     = "/staging-odoo/seed-accounts"
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

variable "tags" {
  type        = map(string)
  description = "Common tags merged onto every resource this module creates."
  default = {
    Project   = "hosting-operations"
    ManagedBy = "opentofu"
  }
}
