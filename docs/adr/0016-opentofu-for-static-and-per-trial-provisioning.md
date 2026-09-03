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

- **Trigger**: `hosting_admin` calls `StartExecution` on a per-lifecycle-action state machine,
  passing the Trial Org's id and the requested action, then polls or receives a callback for
  completion/failure — no subprocess, no local process to manage.
- **Mutex**: the state machine's first state acquires a DynamoDB item keyed by the Trial Org id
  via a conditional `PutItem` (`attribute_not_exists`), and a `Catch`-guarded final state releases
  it — this serializes actions on the *same* Trial Org while leaving separate Trial Orgs
  unconstrained, without relying on Odoo's own record locking.
- **Execution**: `tofu plan`/`apply`/`destroy` runs as an ECS/Fargate task via the
  `arn:aws:states:::ecs:runTask.sync` integration (open-ended task duration, unlike Lambda's
  900-second hard cap — a real risk for a `tofu apply` of unknown duration); Suspend/Wake are a
  separate, fast Task state calling the EC2 API (`stop_instances`/`start_instances`) directly —
  see Power-state boundary below.
- **Retry**: `Retry`/`Catch` fields on each Task state (`MaxAttempts`, `BackoffRate`,
  `IntervalSeconds`), AWS-managed rather than an application-level retry loop.
- **Deployment**: the state machine (Amazon States Language), its IAM role, the ECS task
  definition, and the DynamoDB lock table are declared in the same OpenTofu foundation as
  everything else in this ADR (`aws_sfn_state_machine` is a normal Terraform/OpenTofu-provider
  resource) — no separate deployment pipeline for the orchestration layer itself.

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

**State-key/workspace boundary:** the per-trial-org OpenTofu module is invoked (by the ECS/Fargate
task, not by Odoo) against a deterministic remote-state key derived from the Trial Org's own
database id — e.g. state key `trial-orgs/<trial_org_id>/terraform.tfstate` in the shared S3
backend, where `<trial_org_id>` is that Odoo record's immutable numeric id (never regenerated,
never derived from mutable fields like the prospect domain). A retried `tofu apply` after a
failed or interrupted attempt reuses the same key by construction — it cannot target another
Trial Org's state, because the key is a pure function of an id that doesn't change across
retries.
