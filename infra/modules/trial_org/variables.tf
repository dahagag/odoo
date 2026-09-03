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
}

variable "environment" {
  type        = string
  description = "Environment this trial belongs to: \"prod\" for *.<root_domain>, or \"dev\" for *.<dev_subdomain>."

  validation {
    condition     = contains(["prod", "dev"], var.environment)
    error_message = "environment must be \"prod\" or \"dev\"."
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

variable "log_forwarder_lambda_arn" {
  type        = string
  description = "ARN of the shared log-forwarding Lambda (foundation's log_forwarder_lambda_arn output) that this Trial Org's subscription filter targets. Declared once in the foundation, not created here (ADR-0023)."
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

variable "tags" {
  type        = map(string)
  description = "Common tags merged onto every resource this module creates, in addition to the TrialOrgId/ManagedBy tags this module always sets."
  default     = {}
}
