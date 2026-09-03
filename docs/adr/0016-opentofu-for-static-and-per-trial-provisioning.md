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
history, at the cost of AWS not documenting a built-in mutex for standard workflows. How that gap
gets closed, how the trigger/retry loop stays safe, and what OpenTofu deliberately does *not* own
about a Trial Org's EC2 instance are each their own decision:

- [ADR-0019](0019-step-functions-job-identity-and-retry-safety.md) — job identity, `ClientToken`
  reuse, the bounded ECS execution timeout, and `hosting_admin`'s own IAM scoping for triggering
  and observing executions.
- [ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md) — the DynamoDB
  conditional-write mutex and its stale-lock recovery path.
- [ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md) — why OpenTofu
  doesn't own the EC2 instance's power state or carry an instance profile.

**Deployment:** the state machine (Amazon States Language), its IAM role, the ECS task
definition, the DynamoDB lock table, and the EventBridge stale-lock-cleanup rule from those three
ADRs are all declared in the same OpenTofu foundation as everything else in this ADR
(`aws_sfn_state_machine` is a normal Terraform/OpenTofu-provider resource) — no separate
deployment pipeline for the orchestration layer itself.

**State-key/workspace boundary (state isolation, not execution idempotency):** the per-trial-org
OpenTofu module is invoked (by the ECS/Fargate task, not by Odoo) against a deterministic remote-
state key derived from the Trial Org's own database id — e.g. state key
`trial-orgs/<trial_org_id>/terraform.tfstate` in the shared S3 backend, where `<trial_org_id>` is
that Odoo record's immutable numeric id (never regenerated, never derived from mutable fields like
the prospect domain). This guarantees only that every invocation for a given Trial Org — first
attempt or retry — reads and writes the *same* state location, so a retry can never cross-target
another Trial Org's infrastructure. It says nothing about whether *running `tofu` twice is itself
safe* (execution-level idempotency/dedup) — that property comes from
[ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)'s job-identity design and
[ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md)'s lock, not from the state
key.
