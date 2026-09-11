# ECS/Fargate task definition and service running the administration-stack API (issue #216,
# #195's stack/apps/api). This is deliberately the "first end-to-end proof" of the deploy
# pipeline (#202), not a production-shaped deployment: no load balancer, no public ingress
# (variables.tf/ecs.tf), and the app runs with STACK_AWS_MODE=fake (no real DynamoDB org-record
# table exists yet — that table's key schema and GSIs are designed in
# stack/docs/dynamodb-access-patterns.md but its actual creation is explicitly left to #196, the
# lifecycle-port ticket, not this one).
resource "aws_ecs_task_definition" "administration_stack_api" {
  family                   = "${var.environment}-administration-stack-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.administration_stack_cpu
  memory                   = var.administration_stack_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.administration_stack_api_container_name
      image     = "${var.administration_stack_api_repository_url}:${var.administration_stack_image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.container_port, protocol = "tcp" }
      ]
      environment = [
        # NODE_ENV is deliberately not "production": stack/apps/api/src/config/env.ts refuses to
        # start with NODE_ENV=production unless STACK_AWS_MODE=real, which needs the org-record
        # DynamoDB table #196 hasn't created yet (see this file's module comment above).
        { name = "NODE_ENV", value = "development" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "HOST", value = "0.0.0.0" },
        { name = "STACK_AWS_MODE", value = "fake" },
        { name = "AWS_REGION", value = var.aws_region },
        # Not baked into the image at build time: the image is built and pushed at PR time (by
        # content-hash tag), before a release tag naming it exists (ci.yml's build-stack-image
        # job). Injected here instead, from the same value this apply's own image tag uses, so
        # /healthz can answer "what's running" without cross-referencing ECR or ECS directly.
        { name = "RELEASE_VERSION", value = var.administration_stack_image_tag },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.administration_stack_api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.administration_stack_api_container_name
        }
      }
    }
  ])

  tags = merge(local.tags, { Release = var.administration_stack_image_tag })
}

resource "aws_ecs_service" "administration_stack_api" {
  name            = "${var.environment}-administration-stack-api"
  cluster         = aws_ecs_cluster.platform.id
  task_definition = aws_ecs_task_definition.administration_stack_api.arn
  desired_count   = var.administration_stack_desired_count
  launch_type     = "FARGATE"

  # Issue #216's own acceptance criteria ("a failed step stops the workflow rather than leaving a
  # partial deploy") extends to the ECS rollout itself, not just the workflow's own steps: without
  # these, a task definition revision that can't reach steady state (bad image, missing env, OOM)
  # just keeps failing and retrying with no rollback, while `tofu apply` reports success anyway.
  wait_for_steady_state = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.administration_stack_api.id]
    assign_public_ip = false
  }

  # Every apply that changes the task definition (i.e. every deploy) rolls the service onto the
  # new revision — this is what "deploys the administration stack's image" (issue #216's
  # acceptance criteria) actually means in Terraform terms: the image tag lives in the task
  # definition, and a new revision's ARN here is what ECS rolls out.
  tags = merge(local.tags, {
    Name    = "${var.environment}-administration-stack-api"
    Release = var.administration_stack_image_tag
  })
}
