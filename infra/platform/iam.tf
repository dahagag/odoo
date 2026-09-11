# ---------------------------------------------------------------------------
# ECS task execution role (standard: pull the administration-stack-api image, write task logs).
# Mirrors infra/foundation/iam.tf's ecs_task_execution role.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_task_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.environment}-administration-stack-api-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---------------------------------------------------------------------------
# ECS task role: the identity the administration-stack API container's own instance-metadata
# credential chain resolves to. Carries no inline policy yet — this ticket runs the app with
# STACK_AWS_MODE=fake (ecs_task.tf), so nothing in the running container makes a real AWS call.
# The lifecycle port (#196) is expected to extend this with ADR-0019's narrowly-scoped
# cross-account role assumption into the Hosting Account once STACK_AWS_MODE=real is wired up,
# the same "empty until a real caller needs it" shape infra/foundation/iam.tf's own ecs_task role
# uses.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name               = "${var.environment}-administration-stack-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json
}
