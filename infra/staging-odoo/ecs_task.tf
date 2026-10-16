# ECS/Fargate task definition and service running dev.domain.com's staging Odoo (#337, part of
# #203). Three containers share one task (awsvpc network mode, one ENI, so they reach each other
# over loopback): postgres (in-task database, no persistent volume — staging has no persistent
# data of any kind, #203's Out of Scope), odoo (the application, self-heals via the staging
# entrypoint's drop-and-recreate step, #338/ADR-0041), and tailscale (the only way any access
# tier reaches this task at all, ADR-0040 — there is no ALB, no WAFv2, no public Route53 record).
resource "aws_ecs_task_definition" "staging_odoo" {
  family                   = var.environment
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.odoo_cpu
  memory                   = var.odoo_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.postgres_container_name
      image     = var.postgres_image
      essential = true
      environment = [
        { name = "POSTGRES_USER", value = var.postgres_user },
        # Odoo creates/drops its own named database itself (ADR-0041's drop-and-recreate step) —
        # this is just the default maintenance DB the postgres image needs to boot.
        { name = "POSTGRES_DB", value = "postgres" },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.postgres_password_ssm_parameter_name}" },
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "pg_isready -U ${var.postgres_user}"]
        interval    = 10
        timeout     = 5
        retries     = 5
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.postgres.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.postgres_container_name
        }
      }
    },
    {
      name      = local.odoo_container_name
      image     = "${var.odoo_repository_url}:${var.odoo_image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.odoo_container_port, protocol = "tcp" }
      ]
      dependsOn = [
        { containerName = local.postgres_container_name, condition = "HEALTHY" },
      ]
      environment = [
        { name = "POSTGRES_USER", value = var.postgres_user },
        { name = "POSTGRES_HOST", value = "127.0.0.1" },
        { name = "POSTGRES_PORT", value = "5432" },
        { name = "ODOO_DB", value = var.odoo_db_name },
        { name = "AWS_REGION", value = var.aws_region },
        # Parameter NAMES only, never values — infra/foundation/lambda_src/log_forwarder's own
        # handler.py convention (env vars carry parameter names; the entrypoint resolves the
        # actual secret itself via the task role's ssm:GetParameter --with-decryption, iam.tf).
        { name = "ODOO_ADMIN_PASSWORD_SSM_PARAMETER", value = var.odoo_admin_password_ssm_parameter_name },
        { name = "SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH", value = var.seed_account_password_ssm_parameter_path },
        { name = "RELEASE_VERSION", value = var.odoo_image_tag },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.postgres_password_ssm_parameter_name}" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.odoo.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.odoo_container_name
        }
      }
    },
    {
      name      = local.tailscale_container_name
      image     = var.tailscale_image
      essential = true
      environment = [
        # Fargate has no TUN device and no NET_ADMIN (no privileged containers) — userspace
        # networking is the only mode that works here. TS_DEST_IP proxies tailnet traffic
        # straight to the odoo container over the shared task ENI's loopback, the documented
        # Tailscale "sidecar container" pattern for exactly this constraint.
        { name = "TS_USERSPACE", value = "true" },
        { name = "TS_DEST_IP", value = "127.0.0.1" },
        { name = "TS_HOSTNAME", value = var.tailscale_hostname },
        { name = "TS_STATE_DIR", value = "/var/lib/tailscale" },
        { name = "TS_ACCEPT_DNS", value = "false" },
        { name = "TS_EXTRA_ARGS", value = "--advertise-tags=${join(",", var.tailscale_advertise_tags)}" },
      ]
      secrets = [
        { name = "TS_AUTHKEY", valueFrom = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.tailscale_authkey_ssm_parameter_name}" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.tailscale.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.tailscale_container_name
        }
      }
    },
  ])

  tags = merge(local.tags, { Release = var.odoo_image_tag })
}

resource "aws_ecs_service" "staging_odoo" {
  name            = var.environment
  cluster         = aws_ecs_cluster.staging_odoo.id
  task_definition = aws_ecs_task_definition.staging_odoo.arn
  desired_count   = var.odoo_desired_count
  launch_type     = "FARGATE"

  # #342's post-deploy smoke check: ADR-0040 means there is no ALB, no public Route53 record,
  # and the GitHub-hosted CI runner is not on the tailnet, so there is no network path from the
  # deploy workflow to this task over HTTP the way a normal deploy's smoke check would reach it.
  # ECS Exec (`aws ecs execute-command`) runs entirely over the ECS/SSM control plane the
  # deploy role already calls through (ecs:*, sts:AssumeRole into this account) rather than a
  # network path into the private subnet, so it works under ADR-0040's "no public surface, no
  # exception" constraint without opening any inbound ingress. See iam.tf's ecs_task_exec policy
  # for the matching ssmmessages grant this requires on the task role.
  enable_execute_command = true

  # Same reasoning as infra/platform/ecs_task.tf's identical settings (issue #216): a task
  # definition revision that can't reach steady state (bad image, missing env, OOM) rolls back
  # instead of leaving staging half-deployed and silently broken.
  wait_for_steady_state = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.staging_odoo.id]
    assign_public_ip = false
  }

  tags = merge(local.tags, {
    Name    = "${var.environment}"
    Release = var.odoo_image_tag
  })
}
