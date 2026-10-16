resource "aws_ecs_cluster" "staging_odoo" {
  name = var.ecs_cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Setting a cluster's capacity providers requires the AWS-managed AWSServiceRoleForECS
# service-linked role to already exist in the account — infra/platform/ecs.tf's identical comment
# (issue #271/#272's first real apply) applies here too: a one-time, per-account AWS setup step
# done manually by a human operator, not granted to any CI-assumed role.
resource "aws_ecs_cluster_capacity_providers" "staging_odoo" {
  cluster_name       = aws_ecs_cluster.staging_odoo.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "postgres" {
  name              = "/ecs/${var.ecs_cluster_name}/${local.postgres_container_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "odoo" {
  name              = "/ecs/${var.ecs_cluster_name}/${local.odoo_container_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "tailscale" {
  name              = "/ecs/${var.ecs_cluster_name}/${local.tailscale_container_name}"
  retention_in_days = var.log_retention_days
}

# No ingress rule at all (ADR-0040: no ALB, no WAFv2, no public Route53 record — every access
# tier reaches staging over the Tailscale sidecar instead, never through this security group).
# Outbound only: HTTPS for the ECR image pull, CloudWatch Logs delivery, SSM GetParameter calls,
# and Tailscale's own control-plane/DERP-relay traffic; UDP for Tailscale's direct WireGuard path
# when it's reachable (it falls back to DERP-over-443 otherwise). Postgres<->Odoo traffic never
# touches this security group at all — both containers share one task ENI (awsvpc network mode),
# so inter-container traffic is over loopback.
resource "aws_security_group" "staging_odoo" {
  name = "${var.environment}-ecs-task"
  # Confirmed live elsewhere in this repo (infra/platform/ecs.tf): EC2 rejects a GroupDescription
  # containing non-ASCII characters. Plain hyphens only here, matching that precedent.
  description = "Security group for the staging Odoo ECS task. No inbound rule - not reachable from the public internet or from within the VPC beyond what egress needs."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Outbound HTTPS to AWS APIs (ECR, CloudWatch Logs, SSM), Tailscales control plane/DERP relay, and any external endpoint the app calls."
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Outbound Tailscale WireGuard for direct (non-DERP-relayed) connections."
    from_port   = 41641
    to_port     = 41641
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.environment}-ecs-task" })
}
