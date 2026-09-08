# Extend per-execution Trial Org IAM isolation to the snapshot and power-control Lambdas

Issue [#177](https://github.com/dahagag/odoo/issues/177), raised from a CodeRabbit review on
PR #175 (thread on `state_machine.asl.json.tftpl:171`), flagging that `snapshot_manager`
(invoked by the `SnapshotBeforeDestroy` Task state) and `ec2_power_control` (invoked by the
Suspend/Wake Task states) each authorize their EC2 mutations against *any* AWS resource tagged
with *any* `TrialOrgId`, not the one Trial Org the invoking execution actually targets. Both
Lambdas' own inline comments in `infra/foundation/lambda.tf` already name this precisely: "this
Lambda has no execution-scoped identity to condition on beyond the `TrialOrgId` tag its own
payload names."

This is the identical class of gap [ADR-0031](0031-per-execution-trial-org-iam-isolation.md)
(issue #125) closed for the `RunTofu`/ECS path via a per-invocation `AssumeRole` + session-tag
ABAC pattern. ADR-0031 explicitly scoped itself out of `ec2_power_control` ("the Lambda's own gap
is unchanged and remains tracked by its existing inline comment, not by this ADR"), since
`ecs:RunTask` and `lambda:InvokeFunction` are different integrations with different
credential-delivery mechanics. `snapshot_manager` didn't exist yet at that time — it was added
later, under issue #174's Auto-Destroy work — so ADR-0031 never addressed it at all, but its own
inline comment documents the identical "any tagged Trial Org resource" shape of gap, citing
`ec2_power_control`'s as precedent. This ADR closes both Lambdas' gaps by applying the same,
already-proven pattern to each.

## Why this is narrower than the issue's original "IDOR" framing

Issue #177's finding characterized this as an IDOR (CWE-639) reachable by "anyone holding
`states:StartExecution` IAM permission." Investigation for this ADR (recorded in #177's own
`/to-spec` spec comment) confirmed `hosting.trial.org`'s four lifecycle actions
(`action_issue`/`action_suspend`/`action_wake`/`action_destroy`) carry no `sudo()` bypass and are
gated by ordinary Odoo ACL — `group_hosting_admin_administrator`-only
(`custom_addons/hosting_admin/security/ir.model.access.csv`) — so `trial_org_id` reaching
`AwsProvisioner` is already derived from an ACL-checked recordset, not raw caller input. This is
structurally different from the `action_join_open_invite`/`action_invite` gap
([ADR-0032](0032-defer-invite-proof-of-receipt-guard.md), issues #161/#110), which deliberately
carries its own `sudo()` boundary reachable by any authenticated internal user — that gap remains
deferred until the org-facing login layer's design begins, unaffected by this decision.

The residual risk this ADR actually addresses is narrower: an over-privileged or compromised
Hosting Admin operator (or a compromised `hosting_admin` AWS credential — a risk
[ADR-0019](0019-step-functions-job-identity-and-retry-safety.md) already names and accepts:
"a compromised `hosting_admin` credential could start or read executions, not directly touch
EC2/S3/DynamoDB resources") submitting a wrong or malicious `trial_org_id`. Today, that mistake or
compromise's blast radius at the Lambda layer extends to *any* Trial Org's tagged EC2/EBS
resources; this ADR caps it to the one Trial Org the execution actually names.

## Decision: reuse `trial_org_execution`, extend it to both Lambdas

Rather than minting a separate scoped role per Lambda, `trial_org_execution`'s existing IAM
policy (ADR-0031) is broadened to also grant:

- `ec2:CreateSnapshot`, tag-scoped via `aws:ResourceTag/TrialOrgId ==
  ${aws:PrincipalTag/TrialOrgId}` (the same ABAC condition `ManageTrialOrgEc2Existing` already
  uses) — this matches the *source EBS volume* being snapshotted, an existing resource already
  carrying the `TrialOrgId` tag OpenTofu set on it at provisioning time, the same tag
  `ManageTrialOrgEc2Existing` already keys off.
- `ec2:CreateTags`, scoped to creation time only (`ec2:CreateAction == CreateSnapshot`) and
  conditioned on `aws:RequestTag/TrialOrgId == ${aws:PrincipalTag/TrialOrgId}` — a newly created
  snapshot carries no tags of its own yet, so `aws:ResourceTag` (which reads an *existing*
  resource's tags) cannot gate it; only `aws:RequestTag` (the tags this call is asking to apply)
  can. `snapshot_manager`'s current policy already draws exactly this ResourceTag/CreateSnapshot
  vs. RequestTag/CreateTags-on-create distinction (`infra/foundation/lambda.tf`'s
  `SnapshotTrialOrgVolumes`/`TagSnapshotOnCreate` statements) — today only checking the tag is
  *present*, not that it *matches the session's own `TrialOrgId`*; this decision tightens that
  existing split to an exact match rather than replacing its shape.
- `ec2:StartInstances`/`ec2:StopInstances`, `aws:ResourceTag/TrialOrgId ==
  ${aws:PrincipalTag/TrialOrgId}`, for `ec2_power_control`'s use — a plain existing-resource ABAC
  match, no creation-time nuance since no new resource is created.

One scoped role for "acts on this Trial Org's EC2/EBS resources" across every caller that needs
it, rather than a differently-shaped isolation mechanism per Lambda.

**Each Lambda assumes `trial_org_execution` itself — no credentials travel through Step
Functions state data.** Unlike `RunTofu` (ADR-0031), where the state machine assumes the scoped
role on the ECS task's behalf and injects the resulting temporary credentials as container
environment overrides, `snapshot_manager` and `ec2_power_control` each perform their own
`sts:AssumeRole`/`sts:TagSession` call against `trial_org_execution` — tagging the session with
the `TrialOrgId` value already present in their own invocation payload (`trial_org_id`/
`instance_id`'s owning Trial Org) — before making any EC2 call. This needs each Lambda's own
static execution role to hold only an `sts:AssumeRole`/`sts:TagSession` grant on
`trial_org_execution`'s ARN, nothing else standing.

This design was chosen over having the state machine assume the role and forward the resulting
temporary credentials through the Lambda's invocation `Payload` (the pattern this ADR originally
proposed, mirroring `RunTofu` more literally): Step Functions persists a Task state's input in its
own execution history, and `hosting_admin` already holds `states:GetExecutionHistory` (tag-scoped
to its own Trial Org, per [ADR-0022](0022-live-aws-pulled-audit-view.md)) — so credentials placed
in that payload would be readable by exactly the principal ADR-0019 already promises can only
"start or read executions, not directly touch EC2/S3/DynamoDB resources." Having each Lambda
assume the role itself means only the plain, non-secret `trial_org_id`/`instance_id` ever appears
in Step Functions state data (as today), and no `AssumeTrialOrgExecutionRole`-shaped Task state is
needed before either Lambda's invocation — `RunTofu`'s own Task-state assume is unaffected, since
ECS's credential-injection mechanics are what forced that design in the first place.

This does move which code is trusted to derive the correct `TrialOrgId` session tag from the
trusted, already-authorized `trial_org_id` the execution input carries: from the state machine's
own fixed ASL definition (`RunTofu`'s and, previously, this proposal's Task-state `Parameters`) to
each Lambda's own handler code. Both are equally reviewed, deployed infrastructure code, not
caller-supplied input, so this is the same class of trust this state machine already places in
`sfn_execution`'s ASL logic (ADR-0031) — not a new one — but it's worth naming explicitly: a
`snapshot_manager`/`ec2_power_control` code change that mis-derives or hardcodes the session tag
would silently regain the "any Trial Org" blast radius this ADR closes, the same way a bug in
`sfn_execution`'s own Task-state definition would for `RunTofu`.

**Both Lambdas' own static execution roles are stripped to the minimum.** `snapshot_manager`'s and
`ec2_power_control`'s own IAM roles keep only `AWSLambdaBasicExecutionRole`, the new
`sts:AssumeRole`/`sts:TagSession` grant on `trial_org_execution` described above, and the
describe-only reads AWS doesn't support tag-conditioning on (`ec2:DescribeInstances` for
`snapshot_manager`'s volume lookup; `ec2:DescribeInstances`/`ec2:DescribeInstanceStatus` for
`ec2_power_control`'s waiter). Neither role holds any mutating EC2 permission directly. A Lambda
that never performs the assume therefore has zero standing mutate access — the same backstop
property ADR-0031 established for `ecs_task`'s now-empty policy, rather than merely an equivalent
restatement of the old "any tagged Trial Org resource" condition.

## Scope not touched by this decision

- **`states:StartExecution`'s own IAM scope** stays as ADR-0019 already accepted it: scoped to
  the whole state machine via the single shared `hosting_admin` cross-account role, not
  per-Trial-Org. Building genuine per-Trial-Org scoping of who may call `StartExecution` itself
  would require threading a real per-request/per-caller identity from Odoo through to AWS IAM at
  call time — infrastructure this repo doesn't have today (no verified-prospect-identity concept,
  no per-lifecycle-action session-tagging of `hosting_admin`'s role) — and is a materially larger
  design question than the Lambda-side ABAC gap this ADR closes. Revisit only if `hosting_admin`'s
  role becomes reachable by more than its current single trusted principal.
- **Odoo-side per-record authorization** (e.g. restricting which specific Hosting Admin operator
  may act on which specific Trial Org, beyond today's all-or-nothing
  `group_hosting_admin_administrator` grant) is a separate commercial-ownership question, not
  implied by CodeRabbit's finding, and not addressed here.
- **The #161/#110 invite proof-of-receipt gap** (ADR-0032) is unaffected by this decision and
  remains deferred until the org-facing login/controller layer's design begins.
- `snapshot_cleanup`'s own IAM role is a separate Lambda, not named in CodeRabbit's finding or
  issue #177, and is out of scope here unless a later pass finds it shares the identical pattern.
