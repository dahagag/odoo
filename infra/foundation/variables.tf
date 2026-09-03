variable "aws_region" {
  type        = string
  description = "AWS region the Hosting Account foundation is deployed into."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Short environment name used in resource names/tags (e.g. \"hosting\")."
  default     = "hosting"
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the Hosting Account VPC."
  default     = "10.42.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones to spread subnets across."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets (one per AZ), used by NAT and any internet-facing resources."
  default     = ["10.42.0.0/24", "10.42.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = <<-EOT
    CIDR blocks for private subnets (one per AZ). Trial Org EC2 instances, the state machine's
    ECS `tofu`-runner task, and the shared log-forwarding Lambda all run here.
  EOT
  default     = ["10.42.10.0/24", "10.42.11.0/24"]
}

# ---------------------------------------------------------------------------
# DNS / certificates
# ---------------------------------------------------------------------------

variable "root_domain" {
  type        = string
  description = "Root domain for the Route53 hosted zone Trial Org DNS records live under, e.g. \"method.factory1.io\"."
  default     = "method.factory1.io"
}

variable "dev_subdomain" {
  type        = string
  description = "Dev subdomain (under root_domain) that also needs wildcard DNS/TLS coverage, e.g. \"dev.method.factory1.io\"."
  default     = "dev.method.factory1.io"
}

# ---------------------------------------------------------------------------
# Base AMI
# ---------------------------------------------------------------------------

variable "base_ami_owner_account_id" {
  type        = string
  description = "AWS account id that owns the baked base AMI (OS + Odoo + hosting/hosting_admin addons, per ADR-0018/ADR-0024)."
}

variable "base_ami_name_pattern" {
  type        = string
  description = "Name filter pattern used to look up the most recent base AMI, e.g. \"agentic-erp-trial-org-*\"."
  default     = "agentic-erp-trial-org-*"
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

variable "ecs_cluster_name" {
  type        = string
  description = "Name of the ECS cluster the tofu-runner task (and any future Hosting Account ECS workloads) runs in."
  default     = "hosting-operations"
}

variable "tofu_runner_image" {
  type        = string
  description = <<-EOT
    Container image URI (ECR) for the task that runs `tofu` against `modules/trial_org` inside
    the state machine's runTask.sync step. Built and pushed by a separate CI pipeline, not part
    of this ticket.
  EOT
}

variable "tofu_state_bucket" {
  type        = string
  description = "S3 bucket holding OpenTofu remote state (from `infra/bootstrap` outputs) — the tofu-runner task reads/writes trial-orgs/<trial_org_id>/terraform.tfstate here."
}

variable "tofu_state_lock_table" {
  type        = string
  description = "DynamoDB table backing OpenTofu's own S3-backend state locking (from `infra/bootstrap` outputs). Distinct from the Trial-Org orchestration lock table this module declares."
}

# ---------------------------------------------------------------------------
# Cross-account IAM (hosting_admin, Platform Account)
# ---------------------------------------------------------------------------

variable "hosting_admin_trusted_role_arn" {
  type        = string
  description = "ARN of the IAM role/principal in the Platform Account that hosting_admin runs as and that is allowed to assume this account's narrow hosting_admin-facing role."
}

# ---------------------------------------------------------------------------
# Step Functions / state machine
# ---------------------------------------------------------------------------

variable "state_machine_name" {
  type        = string
  description = "Name of the Trial Org lifecycle Step Functions state machine."
  default     = "trial-org-lifecycle"
}

variable "sfn_task_timeout_seconds" {
  type        = number
  description = "TimeoutSeconds set explicitly on every ecs:runTask.sync Task state (ADR-0019 — AWS's own default is effectively unbounded, ~3.17 years, and must never be left unset)."
  default     = 1800
}

variable "sfn_retry_max_attempts" {
  type        = number
  description = "MaxAttempts for the Retry field on each Task state."
  default     = 2
}

variable "sfn_retry_backoff_rate" {
  type        = number
  description = "BackoffRate for the Retry field on each Task state."
  default     = 2.0
}

variable "sfn_retry_interval_seconds" {
  type        = number
  description = "IntervalSeconds for the Retry field on each Task state."
  default     = 5
}

variable "ec2_power_timeout_seconds" {
  type        = number
  description = "TimeoutSeconds on the Suspend/Wake Task state that invokes the ec2_power_control Lambda (which itself waits, via a boto3 EC2 waiter, for the instance to reach its target power state before returning)."
  default     = 600
}

variable "lambda_invoke_timeout_seconds" {
  type        = number
  description = "TimeoutSeconds on the AcquireLock Task state that invokes the lock_acquire Lambda."
  default     = 60
}

variable "lock_retry_max_attempts" {
  type        = number
  description = "MaxAttempts for AcquireLock's own Retry entry when the lock is already held (distinct from sfn_retry_max_attempts, which covers unexpected/transient errors on every Task state)."
  default     = 5
}

variable "lock_retry_interval_seconds" {
  type        = number
  description = "IntervalSeconds for AcquireLock's lock-already-held Retry entry."
  default     = 3
}

# ---------------------------------------------------------------------------
# DynamoDB orchestration lock table (ADR-0020)
# ---------------------------------------------------------------------------

variable "lock_table_name" {
  type        = string
  description = "DynamoDB table name for the per-Trial-Org conditional-write lifecycle lock (ADR-0020). Distinct from var.tofu_state_lock_table."
  default     = "trial-org-lifecycle-locks"
}

variable "lock_ttl_hours" {
  type        = number
  description = "Hours out the lock item's TTL attribute is set to, as a stale-lock backstop (ADR-0020)."
  default     = 4
}

# ---------------------------------------------------------------------------
# Log forwarding (ADR-0023)
# ---------------------------------------------------------------------------

variable "log_forwarder_webhook_url_ssm_parameter" {
  type        = string
  description = "SSM Parameter Store name holding the Odoo webhook URL the shared log-forwarding Lambda POSTs new log lines to."
  default     = "/hosting/log-forwarder/webhook-url"
}

variable "log_forwarder_hmac_secret_ssm_parameter" {
  type        = string
  description = "SSM Parameter Store (SecureString) name holding the HMAC signing secret the shared log-forwarding Lambda uses to sign webhook requests."
  default     = "/hosting/log-forwarder/hmac-secret"
}

variable "log_forwarder_hmac_secret_kms_key_arn" {
  type        = string
  description = "ARN of the KMS key the log_forwarder_hmac_secret_ssm_parameter SecureString is encrypted under (e.g. the account's aws/ssm managed key, or a customer-managed key), so the shared log-forwarding Lambda can decrypt it."
}

variable "log_retention_days" {
  type        = number
  description = <<-EOT
    CloudWatch Logs retention (days) applied to every log group this module creates directly:
    the Lambda functions' own log groups, the ECS tofu-runner task's log group, and the state
    machine's execution-history log group. Distinct from the per-Trial-Org application log
    group's own retention, which is `log_group_retention_days` in infra/modules/trial_org.
  EOT
  default     = 30
}

variable "trial_org_log_group_prefix" {
  type        = string
  description = <<-EOT
    CloudWatch log group name prefix every Trial Org's own log group is created under (see
    infra/modules/trial_org). Shared here so this module's IAM policies and the trial_org
    module's log group naming can never drift apart from hardcoding the same string twice.
  EOT
  default     = "/hosting/trial-orgs/"
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
