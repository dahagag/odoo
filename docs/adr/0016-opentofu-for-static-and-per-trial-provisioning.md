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
deviation from each tool's grain, not something either recommends. The new `hosting_admin` addon
(see [ADR-0018](0018-hosting-split-into-admin-and-org-facing-addons.md)) shells out to the `tofu`
CLI as a subprocess per Trial Org (module + per-org tfvars), triggered by a thin "Issue Trial" /
"Extend" action `crm_methodology` adds to the Opportunity record, against state stored remotely
(S3 bucket + DynamoDB lock table) rather than local files,
since Odoo's own compute may restart or redeploy independently of any given trial's lifecycle. We
accepted that this makes each provisioning step a plan+apply cycle rather than a single API call
(slower than the raw-boto3 alternative considered and rejected) in exchange for one tool
governing both the static foundation and every trial's infrastructure, instead of splitting that
responsibility between OpenTofu and hand-written boto3 call sites that would drift from it over
time.

**Power-state boundary:** OpenTofu owns creating and destroying a Trial Org's infrastructure —
`Issue Trial` runs `tofu apply`, `Auto-Destroy` runs `tofu destroy` — but does not own its EC2
instance's running/stopped state. Suspend and Wake call the EC2 API (`stop_instances` /
`start_instances`) directly from `hosting_admin`, not through OpenTofu: an idle-timeout suspend
happening dozens of times over a trial's life doesn't warrant a plan+apply cycle each time it's
the cheaper, faster path, and it also avoids a real correctness hazard — if the per-trial module's
desired state included `running`, a later unrelated `tofu apply` (e.g. picking up a foundation
change) could silently undo a Suspended instance. The per-trial module's instance resource is
declared without an explicit running/stopped assumption for exactly this reason: OpenTofu must
never contend with the runtime for power state.

**Serialization:** every lifecycle action (Wake, idle-stop, Extend, Auto-Destroy, and any
`tofu apply`) on a given Trial Org acquires that org's row-level lock in Odoo (a `SELECT ... FOR
UPDATE`-style lock on the Trial Org record, which Odoo's ORM already provides for record writes)
before acting, and releases it after. This is enough to prevent two lifecycle actions racing on
the *same* Trial Org — it says nothing about cross-org concurrency, which is unconstrained by
design (separate Trial Orgs must be able to provision in parallel).

**State-key/workspace boundary:** the per-trial-org OpenTofu module is invoked against a
deterministic remote-state key derived from the Trial Org's own database id — e.g. state key
`trial-orgs/<trial_org_id>/terraform.tfstate` in the shared S3 backend, where `<trial_org_id>` is
that Odoo record's immutable numeric id (never regenerated, never derived from mutable fields like
the prospect domain). A retried `tofu apply` after a failed or interrupted attempt reuses the same
key by construction — it cannot target another Trial Org's state, because the key is a pure
function of an id that doesn't change across retries.
