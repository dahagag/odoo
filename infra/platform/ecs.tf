resource "aws_ecs_cluster" "platform" {
  name = var.ecs_cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "platform" {
  cluster_name       = aws_ecs_cluster.platform.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "administration_stack_api" {
  name              = "/ecs/${var.ecs_cluster_name}/${local.administration_stack_api_container_name}"
  retention_in_days = var.log_retention_days
}

# No ingress rule at all — the administration-stack API has no ALB/public listener in front of it
# (issue #216's scope; epic #193 story 18: "the administration surface unreachable from the
# public internet"). Outbound HTTPS only, for the ECR image pull and CloudWatch Logs delivery.
resource "aws_security_group" "administration_stack_api" {
  name        = "${var.environment}-administration-stack-api"
  description = "Security group for the administration-stack API ECS task. No inbound rule — not reachable from the public internet or from within the VPC beyond what egress needs."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Outbound HTTPS to AWS APIs (ECR, CloudWatch Logs) and any external endpoint the app calls."
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.environment}-administration-stack-api" })
}
