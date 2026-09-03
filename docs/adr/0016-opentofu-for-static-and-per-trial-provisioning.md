# OpenTofu for both the static AWS foundation and per-trial-org provisioning

OpenTofu defines both the durable shared foundation (VPC, the three Organizations accounts'
baseline setup, base AMI, ECS cluster, Route53 zone, IAM roles) and each Trial Org's
infrastructure, via a shared reusable module instantiated once per trial. We picked OpenTofu
over Terraform for the same infrastructure specifically because it's MPL 2.0 (true open source,
Linux Foundation-governed) rather than Terraform's BSL — see the licensing comparison in
[`docs/research/aws-hosting-foundation-tooling.md`](../research/aws-hosting-foundation-tooling.md#1-iac-tool-choice-for-per-tenant-dynamic-stack-instantiation).
We picked it over AWS CDK to avoid a mixed Python/Node.js toolchain, since CDK's Python bindings
still depend on a Node.js-based deploy path under the hood.

Neither OpenTofu nor CDK documents an on-demand "provision triggered by a business event, not a
deploy" pattern as first-class (same research note, same section) — this is a deliberate
deviation from each tool's grain, not something either recommends.

**Job orchestration lives in infrastructure, not in Odoo.** `hosting_admin` (see
[ADR-0018](0018-hosting-split-into-admin-and-org-facing-addons.md)) is an integration layer: for
every Trial Org lifecycle action (Issue, Extend, Suspend, Wake, Auto-Destroy) it starts an AWS
Step Functions execution and reads back status — it does not itself run `tofu` as a subprocess,
hold a lock, or implement retry logic. This was a deliberate choice over hand-rolling that
machinery in Python: two research passes
([`docs/research/step-functions-for-provisioning-jobs.md`](../research/step-functions-for-provisioning-jobs.md),
[`docs/research/provisioning-job-orchestration-alternatives.md`](../research/provisioning-job-orchestration-alternatives.md))
compared five options against the requirement (a mutex so two actions never race on one Trial
Org, a bounded timeout on the `tofu` process, and retry/idempotency); Step Functions was chosen
for keeping execution semantics entirely in managed infrastructure with a visible execution
history, at the cost of AWS not documenting a built-in mutex for standard workflows — closed here
with an explicit DynamoDB conditional-write lock as the first and last step of every execution,
rather than an Odoo-side lock, so Odoo never becomes a required participant in serialization:

- **Job identity**: before calling `StartExecution`, `hosting_admin` generates a UUID and
  persists it on the Trial Org record as that lifecycle action's **job id** — created once,
  reused verbatim on every retry of that same request. The Step Functions execution name is
  derived from it (e.g. `trial-<trial_org_id>-<job_id>`), and the same job id becomes the
  `ClientToken` passed to the ECS `RunTask` call inside the execution. This closes two separate
  retry hazards with one value: `StartExecution` only dedupes a Standard-workflow retry when the
  execution *name and input* both match exactly, and `RunTask`'s own `ClientToken` (a distinct,
  ECS-level dedup mechanism, valid for 24 hours per AWS's own documented TTL) only dedupes when
  reused across retries with identical parameters — a fresh UUID per attempt would defeat both. A
  retry that arrives more than 24 hours after the original attempt is outside `RunTask`'s
  `ClientToken` window; `hosting_admin` treats that as requiring a fresh job id (a new lifecycle
  request), not a transparent retry of the stale one.
- **Trigger**: `hosting_admin` calls `StartExecution` on a per-lifecycle-action state machine,
  passing the Trial Org's id, the job id, and the requested action, then polls or receives a
  callback for completion/failure — no subprocess, no local process to manage.
- **Mutex**: the state machine's first state acquires a DynamoDB item keyed by the Trial Org id
  via a conditional `PutItem` (`attribute_not_exists`), storing the current execution's own ARN as
  an **owner token** in the item. The release step conditionally deletes the item only when its
  owner token still matches this execution's ARN — so an execution that never actually held the
  lock (e.g. one that failed *before* acquiring it) can never delete a different execution's live
  lock by reaching a shared, unconditional release step. This serializes actions on the *same*
  Trial Org while leaving separate Trial Orgs unconstrained, without relying on Odoo's own record
  locking.
  - **Stale-lock recovery**: a `Catch` block only handles errors *within* the state machine's own
    states — it does not run when an execution is stopped externally (`StopExecution`) or fails at
    the top level, so a lock can outlive its execution. An EventBridge rule on that state
    machine's execution status changing to `FAILED`/`ABORTED`/`TIMED_OUT` invokes a small cleanup
    step that releases the matching lock (same owner-token-conditional delete) promptly. As a
    backstop for whatever gap EventBridge doesn't catch, the DynamoDB lock item also carries a TTL
    attribute (a few hours out) so a stuck lock self-expires via DynamoDB's native TTL rather than
    blocking that Trial Org indefinitely. Both mechanisms are infrastructure-level; Odoo is not a
    required participant in lock recovery any more than it is in acquiring the lock.
- **Execution**: `tofu plan`/`apply`/`destroy` runs as an ECS/Fargate task via the
  `arn:aws:states:::ecs:runTask.sync` integration — chosen over Lambda specifically because it has
  no service-imposed ceiling like Lambda's 900-second hard cap, not because this ADR wants an
  unbounded process. The Task state itself sets an explicit `TimeoutSeconds` (30 minutes) as the
  actual bound: generous for provisioning one EC2 instance and its supporting resources (a normal
  `tofu apply` for this module completes in low single-digit minutes), while still satisfying the
  bounded-timeout requirement this section opened with — an unset/default `TimeoutSeconds` on a
  Task state is not an acceptable substitute, since AWS's own Task-state page documents its
  default as 99,999,999 seconds (~3.17 years), effectively unbounded. `RunTask`'s `ClientToken` is
  passed per Job identity above. Suspend/Wake are a separate, fast Task state
  calling the EC2 API (`stop_instances`/`start_instances`) directly — see Power-state boundary
  below — and, since both calls return while the instance is still `stopping`/`pending` rather
  than at its target state, that Task state waits (an EC2 waiter: `instance_stopped` /
  `instance_running`) before completing, so a Trial Org's Active/Suspended status in Odoo always
  reflects the instance's actual power state rather than just that the API call was accepted.
- **Retry**: `Retry`/`Catch` fields on each Task state (`MaxAttempts`, `BackoffRate`,
  `IntervalSeconds`), AWS-managed rather than an application-level retry loop. A Task-level retry
  re-enters that Task only — it does not reacquire the mutex (already held for the whole
  execution) and, for the ECS Task, is itself made safe by the same job-id-derived `ClientToken`
  from Job identity above.
- **Deployment**: the state machine (Amazon States Language), its IAM role, the ECS task
  definition, the DynamoDB lock table (with its TTL attribute enabled), and the EventBridge
  stale-lock-cleanup rule are declared in the same OpenTofu foundation as everything else in this
  ADR (`aws_sfn_state_machine` is a normal Terraform/OpenTofu-provider resource) — no separate
  deployment pipeline for the orchestration layer itself.

**Power-state boundary:** OpenTofu owns creating and destroying a Trial Org's infrastructure —
`Issue Trial` runs `tofu apply`, `Auto-Destroy` runs `tofu destroy` — but does not own its EC2
instance's running/stopped state. Suspend and Wake call the EC2 API directly (via their own Task
state in the same state machine, per above), not through OpenTofu: an idle-timeout suspend
happening dozens of times over a trial's life doesn't warrant a plan+apply cycle each time, and it
also avoids a real correctness hazard — if the per-trial module's desired state included
`running`, a later unrelated `tofu apply` (e.g. picking up a foundation change) could silently
undo a Suspended instance. The per-trial module's instance resource is declared without an
explicit running/stopped assumption for exactly this reason: OpenTofu must never contend with the
runtime for power state.

**Instance profile / `iam:PassRole` boundary:** a Trial Org's own EC2 instance is launched
**without an attached IAM instance profile** — it has no reason to call AWS APIs itself (it's a
demo Odoo instance for the customer, not an AWS-facing workload), so `RunInstances` doesn't
reference an instance profile and the ECS task role therefore doesn't need `iam:PassRole` for
one. This is a deliberate simplification, not an oversight: attaching a role would both need
`iam:PassRole` scoped to that specific role on the ECS task's own IAM policy (missing that
permission is a documented way for `RunInstances` to fail outright when a profile is requested)
and would put an AWS-scoped credential inside a customer-facing Trial Org instance, which is a
posture this ADR doesn't want. If a future feature needs the instance to reach AWS APIs (e.g. an
in-guest CloudWatch agent), that decision must explicitly add both the instance profile *and* the
matching `iam:PassRole` grant to the ECS task role together — never one without the other.

**State-key/workspace boundary (state isolation, not execution idempotency):** the per-trial-org
OpenTofu module is invoked (by the ECS/Fargate task, not by Odoo) against a deterministic remote-
state key derived from the Trial Org's own database id — e.g. state key
`trial-orgs/<trial_org_id>/terraform.tfstate` in the shared S3 backend, where `<trial_org_id>` is
that Odoo record's immutable numeric id (never regenerated, never derived from mutable fields like
the prospect domain). This guarantees only that every invocation for a given Trial Org — first
attempt or retry — reads and writes the *same* state location, so a retry can never cross-target
another Trial Org's infrastructure. It says nothing about whether *running `tofu` twice is itself
safe* (execution-level idempotency/dedup) — that property comes from the Job identity and Mutex
mechanisms above (the ClientToken-guarded `RunTask` call and the DynamoDB lock), not from the
state key.
