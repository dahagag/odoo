variable "trial_org_id" {
  type        = string
  description = <<-EOT
    The Trial Org's immutable Odoo record id. Used as the resource-naming/tagging key for
    everything this module creates and (by whatever invokes this module — see ../../README.md)
    as the OpenTofu remote-state key segment `trial-orgs/<trial_org_id>/terraform.tfstate`
    (ADR-0016). Never derived from a mutable field like the prospect domain.
  EOT

  validation {
    condition     = can(regex("^[0-9]+$", var.trial_org_id))
    error_message = "trial_org_id must be the Trial Org's numeric Odoo record id."
  }
}

variable "trial_org_subdomain_label" {
  type        = string
  description = "DNS label for this Trial Org, e.g. \"acme-widgets\" to produce acme-widgets.<root_domain>. Distinct from trial_org_id since it may derive from the prospect's name for readability."

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.trial_org_subdomain_label))
    error_message = "trial_org_subdomain_label must be one lowercase DNS label of at most 63 characters (letters, digits, and internal hyphens only — no dots, no leading/trailing hyphen)."
  }
}

variable "dns_environment" {
  type        = string
  description = <<-EOT
    Which of the zone's two wildcard domains this trial's DNS record is created under: "prod"
    for *.<root_domain>, or "dev" for *.<dev_subdomain>. Deliberately not named `environment` —
    that name is used elsewhere (e.g. the foundation module's `environment` input) for a broader,
    differently-valued concept (a short deployment-name label like "hosting"), and reusing it
    here for this narrower prod/dev choice caused exactly the kind of mix-up this comment now
    prevents.
  EOT

  validation {
    condition     = contains(["prod", "dev"], var.dns_environment)
    error_message = "dns_environment must be \"prod\" or \"dev\"."
  }
}

# ---------------------------------------------------------------------------
# Networking (supplied by whatever invokes this module, typically the foundation's outputs)
# ---------------------------------------------------------------------------

variable "vpc_id" {
  type        = string
  description = "VPC id the instance and its security group are created in (foundation's vpc_id output)."
}

variable "subnet_id" {
  type        = string
  description = "Subnet id the instance launches into. A public subnet (one of the foundation's public_subnet_ids outputs), since each Trial Org's demo instance is reached directly over HTTPS from the internet."
}

variable "allowed_ingress_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to reach the instance on ports 80/443 (HTTP/HTTPS to the trial's Odoo instance)."
  default     = ["0.0.0.0/0"]
}

# ---------------------------------------------------------------------------
# EC2 instance
# ---------------------------------------------------------------------------

variable "ami_id" {
  type        = string
  description = "Base AMI id to launch the instance from (foundation's base_ami_id output, ADR-0024)."
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for this Trial Org's instance."
  default     = "t3.small"
}

# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone id to create this Trial Org's DNS record in (foundation's route53_zone_id output)."
}

variable "root_domain" {
  type        = string
  description = "Root domain the zone covers, e.g. \"method.factory1.io\" (used only for prod records; must match the foundation's root_domain input)."
}

variable "dev_subdomain" {
  type        = string
  description = "Dev subdomain the zone also covers, e.g. \"dev.method.factory1.io\" (used only for dev records; must match the foundation's dev_subdomain input)."
}

# ---------------------------------------------------------------------------
# Logging (ADR-0021, ADR-0023)
# ---------------------------------------------------------------------------

variable "log_group_retention_days" {
  type        = number
  description = "CloudWatch Logs retention for this Trial Org's own log group."
  default     = 14
}

variable "log_group_prefix" {
  type        = string
  description = "CloudWatch log group name prefix (foundation's trial_org_log_group_prefix output) this Trial Org's own log group is created under — kept as an input rather than hardcoded here so it can never drift from the foundation IAM policies that reference the same convention."
  default     = "/hosting/trial-orgs/"
}

variable "log_forwarder_lambda_arn" {
  type        = string
  description = "ARN of the shared log-forwarding Lambda (foundation's log_forwarder_lambda_arn output) that this Trial Org's subscription filter targets. Declared once in the foundation, not created here (ADR-0023)."
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

variable "instance_role_permissions_boundary_arn" {
  type        = string
  description = "Permissions boundary ARN (foundation's trial_org_instance_permissions_boundary_arn output) attached to this Trial Org's instance role — an IAM-enforced backstop on ADR-0021's narrow, logs-only guarantee, required by the foundation ECS task role's own iam:CreateRole grant."
}

# ---------------------------------------------------------------------------
# Deployment versioning (ADR-0024)
# ---------------------------------------------------------------------------

variable "module_git_sha" {
  type        = string
  description = <<-EOT
    Git SHA of this module's own source tree at apply time, supplied by whatever invokes this
    module (the ECS tofu-runner task/CI knows its own checkout SHA). Recorded as a tag and
    exposed as an output so the caller can persist it as the Trial Org's audit trail of "what
    infra code actually provisioned this" (ADR-0024) — this module has no way to determine its
    own git SHA from inside itself.
  EOT
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

variable "tags" {
  type        = map(string)
  description = "Common tags merged onto every resource this module creates, in addition to the TrialOrgId/ManagedBy tags this module always sets."
  default     = {}
}
