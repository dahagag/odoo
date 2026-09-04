resource "aws_ecs_cluster" "hosting" {
  name = var.ecs_cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "hosting" {
  cluster_name       = aws_ecs_cluster.hosting.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "tofu_runner" {
  name              = "/ecs/${var.ecs_cluster_name}/tofu-runner"
  retention_in_days = var.log_retention_days
}

resource "aws_security_group" "tofu_runner" {
  name        = "${var.environment}-tofu-runner"
  description = "Security group for the ECS task that runs tofu against modules/trial_org."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Outbound HTTPS to AWS APIs and the OpenTofu state backend."
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.environment}-tofu-runner" })
}
