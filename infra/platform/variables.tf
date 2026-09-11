variable "aws_region" {
  type        = string
  description = "AWS region this module's Platform Account resources are created in (ADR-0015)."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Short environment name used in resource names/tags (e.g. \"platform\")."
  default     = "platform"
}

variable "platform_assume_role_arn" {
  type        = string
  description = <<-EOT
    Platform Account role ARN this module's own AWS provider assumes into before creating/reading
    any resource (issue #271/#272) — infra/registry's platform_administration_stack_deploy_role_arn
    output for the staging-deploy apply job, or its platform_ci_plan_role_arn output for the
    PR-time plan job. Supplied at apply time, same no-remote-state convention as
    administration_stack_api_repository_url.
  EOT
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------
#
# A dedicated VPC, not a reuse of infra/foundation's (that VPC is Hosting-Account-scoped —
# infra/foundation/network.tf, infra/foundation/variables.tf's aws_region description — a
# different AWS account entirely from this module's Platform Account). Private subnets + a single
# NAT gateway, the same shape infra/foundation/network.tf uses, sized down to one NAT (this
# module's only egress-needing workload is one small ECS service, not a per-Trial-Org fleet).
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the Platform Account's administration-stack VPC. Distinct range from infra/foundation's Hosting Account VPC (10.42.0.0/16) — the two are never peered, but keeping the ranges disjoint avoids confusion if that ever changes."
  default     = "10.60.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones to spread subnets across."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets (one per AZ) — hold only the NAT gateway; the administration-stack service itself has no public listener (epic #193 story 18: \"unreachable from the public internet\")."
  default     = ["10.60.0.0/24", "10.60.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets (one per AZ). The administration-stack API's ECS task runs here, with no assigned public IP and no inbound ingress rule."
  default     = ["10.60.10.0/24", "10.60.11.0/24"]
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

variable "ecs_cluster_name" {
  type        = string
  description = "Name of the Platform Account ECS cluster the administration-stack API (and any future Platform Account ECS workload) runs in."
  default     = "platform"
}

variable "administration_stack_api_repository_url" {
  type        = string
  description = "Repository URL of the agentic-erp/administration-stack-api ECR repository (infra/registry's administration_stack_api_repository_url output). Supplied at apply time, same no-remote-state convention as infra/cicd's platform_account_id (ADR-0038's repository names are already fixed, so no cross-module data dependency is needed)."
}

variable "administration_stack_image_tag" {
  type        = string
  description = <<-EOT
    Image tag this apply deploys — the current release's derived version (issue #216), e.g.
    "v1.2.3". CI resolves this once per push to var.staging_branch (the same latest-v*-tag
    resolution ci.yml's manifest-version-check job already uses) and retags the PR-time,
    content-hash-tagged image already pushed to ECR with it, before this apply runs — so this
    variable both names the task definition's image and *is* "which release is currently
    running in staging" (ADR-0039's deploy-permission placeholder this ticket fills in).
  EOT
}

variable "container_port" {
  type        = number
  description = "Port the administration-stack API listens on inside the container (stack/apps/api/Dockerfile's EXPOSE, and its PORT env var default)."
  default     = 3000
}

variable "administration_stack_cpu" {
  type        = string
  description = "Fargate task-level vCPU units for the administration-stack API task (AWS's cpu/memory combination table)."
  default     = "256"
}

variable "administration_stack_memory" {
  type        = string
  description = "Fargate task-level memory (MiB) for the administration-stack API task."
  default     = "512"
}

variable "administration_stack_desired_count" {
  type        = number
  description = "Desired ECS service task count. Kept at 1 — this is a staff-only, low-traffic administration surface with no load balancer in front of it yet (issue #216's scope; a reachable, load-balanced deployment is a later ticket)."
  default     = 1
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs retention (days) for the administration-stack API's log group."
  default     = 30
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
