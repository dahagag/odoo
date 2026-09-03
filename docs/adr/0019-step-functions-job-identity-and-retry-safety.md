# Step Functions job identity and retry safety

Part of the job-orchestration design in [ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md).
This ADR covers how `hosting_admin` triggers a Trial Org lifecycle action safely — a persisted job
identity, a bounded execution timeout, and the IAM scope `hosting_admin` itself holds — as opposed
to how the execution's own mutex works ([ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md))
or what OpenTofu does and doesn't own about the EC2 instance
([ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md)).

**Job identity.** Before calling `StartExecution`, `hosting_admin` generates a UUID and persists
it on the Trial Org record as that lifecycle action's **job id** — created once, reused verbatim
on every retry of that same request. The Step Functions execution name is derived from it (e.g.
`trial-<trial_org_id>-<job_id>`), and the same job id becomes the `ClientToken` passed to the ECS
`RunTask` call inside the execution. This closes two separate retry hazards with one value:
`StartExecution` only dedupes a Standard-workflow retry when the execution *name and input* both
match exactly, and `RunTask`'s own `ClientToken` (a distinct, ECS-level dedup mechanism, valid for
24 hours per AWS's own documented TTL) only dedupes when reused across retries with identical
parameters — a fresh UUID per attempt would defeat both. A retry that arrives more than 24 hours
after the original attempt is outside `RunTask`'s `ClientToken` window; `hosting_admin` treats
that as requiring a fresh job id (a new lifecycle request), not a transparent retry of the stale
one.

**Trigger.** `hosting_admin` calls `StartExecution` on a per-lifecycle-action state machine,
passing the Trial Org's id, the job id, and the requested action, then polls or receives a
callback for completion/failure — no subprocess, no local process to manage.

**`hosting_admin`'s IAM scope.** Its cross-account role (assumed from the Platform Account's
native role into the Hosting Account, per [ADR-0013](0013-aws-organizations-for-hosting-foundation.md))
is scoped narrowly to two separate IAM statements, since AWS's own Step Functions IAM reference
defines these two actions against different resource types: `states:StartExecution`, scoped to
the state-machine ARN (`arn:aws:states:<region>:<account>:stateMachine:<name>`), and
`states:DescribeExecution`, scoped to an execution ARN
(`arn:aws:states:<region>:<account>:execution:<name>:*`). It never holds EC2, OpenTofu-state, or
DynamoDB-lock permissions itself — those belong to the state machine's own execution role and its
ECS task role, both entirely within the Hosting Account, scoped by `aws:ResourceTag` ABAC
conditions to the specific Trial Org each execution targets. This keeps the Platform Account's own
blast radius small: a compromised `hosting_admin` credential could start or read executions, not
directly touch EC2/S3/DynamoDB resources in the Hosting Account.

**Bounded execution timeout.** `tofu plan`/`apply`/`destroy` runs as an ECS/Fargate task via the
`arn:aws:states:::ecs:runTask.sync` integration — chosen over Lambda specifically because it has
no service-imposed ceiling like Lambda's 900-second hard cap, not because this design wants an
unbounded process. The Task state itself sets an explicit `TimeoutSeconds` (30 minutes) as the
actual bound: generous for provisioning one EC2 instance and its supporting resources (a normal
`tofu apply` for this module completes in low single-digit minutes), while still satisfying the
bounded-timeout requirement ADR-0016 opened with — an unset/default `TimeoutSeconds` on a Task
state is not an acceptable substitute, since AWS's own Task-state page documents its default as
99,999,999 seconds (~3.17 years), effectively unbounded.

**Retry.** `Retry`/`Catch` fields on each Task state (`MaxAttempts`, `BackoffRate`,
`IntervalSeconds`), AWS-managed rather than an application-level retry loop. A Task-level retry
re-enters that Task only — it does not reacquire the mutex (already held for the whole execution,
see ADR-0020) and, for the ECS Task, is itself made safe by the same job-id-derived `ClientToken`
from Job identity above.
