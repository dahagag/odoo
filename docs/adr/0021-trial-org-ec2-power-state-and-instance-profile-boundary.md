# Trial Org EC2 power-state and instance-profile boundary

Part of the job-orchestration design in [ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md).
Two decisions about what OpenTofu deliberately does *not* own for a Trial Org's own EC2 instance,
separate from how the triggering/retry loop stays safe
([ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)) or how concurrent actions on
one Trial Org are serialized ([ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md)).

**Power state.** OpenTofu owns creating and destroying a Trial Org's infrastructure — `Issue
Trial` runs `tofu apply`, `Auto-Destroy` runs `tofu destroy` — but does not own its EC2 instance's
running/stopped state. Suspend and Wake call the EC2 API directly (via their own Task state in the
same state machine), not through OpenTofu: an idle-timeout suspend happening dozens of times over
a trial's life doesn't warrant a plan+apply cycle each time, and it also avoids a real correctness
hazard — if the per-trial module's desired state included `running`, a later unrelated `tofu
apply` (e.g. picking up a foundation change) could silently undo a Suspended instance. The
per-trial module's instance resource is declared without an explicit running/stopped assumption
for exactly this reason: OpenTofu must never contend with the runtime for power state.

Since `StartInstances`/`StopInstances` return while the instance is still `pending`/`stopping`
rather than at its target state, the Suspend/Wake Task state waits (an EC2 waiter:
`instance_stopped`/`instance_running`) before completing, so a Trial Org's Active/Suspended status
in Odoo always reflects the instance's actual power state rather than just that the API call was
accepted.

**Instance profile / `iam:PassRole` boundary.** A Trial Org's own EC2 instance is launched
**without an attached IAM instance profile** — it has no reason to call AWS APIs itself (it's a
demo Odoo instance for the customer, not an AWS-facing workload), so `RunInstances` doesn't
reference an instance profile and the ECS task role therefore doesn't need `iam:PassRole` for one.
This is a deliberate simplification, not an oversight: attaching a role would both need
`iam:PassRole` scoped to that specific role on the ECS task's own IAM policy (missing that
permission is a documented way for `RunInstances` to fail outright when a profile is requested)
and would put an AWS-scoped credential inside a customer-facing Trial Org instance, which is a
posture this design doesn't want. If a future feature needs the instance to reach AWS APIs (e.g.
an in-guest CloudWatch agent), that decision must explicitly add both the instance profile *and*
the matching `iam:PassRole` grant to the ECS task role together — never one without the other.
