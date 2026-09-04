# ECS/Fargate task definition that runs `tofu` against infra/modules/trial_org, invoked by the
# state machine via arn:aws:states:::ecs:runTask.sync (ADR-0016, ADR-0019). Actual
# action/trial_org_id/job_id inputs are passed per-invocation as container overrides from the
# state machine (state_machine.asl.json.tftpl), not baked in here.
resource "aws_ecs_task_definition" "tofu_runner" {
  family                   = "${var.environment}-tofu-runner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.tofu_runner_container_name
      image     = var.tofu_runner_image
      essential = true
      # TRIAL_ORG_ID, ACTION and JOB_ID are supplied per-invocation as container overrides by the
      # state machine; TF_STATE_* env vars here are static (same backend for every trial).
      environment = [
        { name = "TF_STATE_BUCKET", value = var.tofu_state_bucket },
        { name = "TF_STATE_LOCK_TABLE", value = var.tofu_state_lock_table },
        { name = "AWS_REGION", value = var.aws_region },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.tofu_runner.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "tofu-runner"
        }
      }
    }
  ])
}
