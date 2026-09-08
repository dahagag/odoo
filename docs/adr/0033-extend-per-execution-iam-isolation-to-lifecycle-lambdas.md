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
ABAC pattern — but ADR-0031 explicitly scoped itself out of these two Lambdas ("the Lambda's own
gap is unchanged and remains tracked by its existing inline comment, not by this ADR"), since
`ecs:RunTask` and `lambda:InvokeFunction` are different integrations with different credential-
delivery mechanics. This ADR closes that deferred gap by applying the same, already-proven
pattern to both Lambdas.

## Why this is narrower than the issue's original "IDOR" framing

Issue #177's finding characterized this as an IDOR (CWE-639) reachable by "anyone holding
`states:StartExecution` IAM permission." Investigation for this ADR (recorded in #177's own
`/to-spec` spec comment) confirmed `hosting.trial.org`'s four lifecycle actions
(`action_issue`/`action_suspend`/`action_wake`/`action_destroy`) carry no `sudo()` bypass and are
gated by ordinary Odoo ACL — `group_hosting_admin_administrator`-only
(`custom_addons/hosting_admin/security/ir.model.access.csv`) — so `trial_org_id` reaching
`AwsProvisioner` is already derived from an ACL-checked recordset, not raw caller input. This is
structurally different from the `action_join_open_invite`/`action_invite` gap
([ADR-0032](0032-defer-invite-reachability-and-identity-hardening.md), issues #161/#110/#162),
which deliberately carries its own `sudo()` boundary reachable by any authenticated internal
user — that gap remains deferred until the org-facing login layer's design begins, unaffected by
this decision.

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

- `ec2:CreateSnapshot`/`ec2:CreateTags`, tag-scoped via `aws:ResourceTag/TrialOrgId ==
  ${aws:PrincipalTag/TrialOrgId}` (the same ABAC condition `ManageTrialOrgEc2Existing` already
  uses), for `snapshot_manager`'s use.
- `ec2:StartInstances`/`ec2:StopInstances`, same condition shape, for `ec2_power_control`'s use.

One scoped role for "acts on this Trial Org's EC2/EBS resources" across every Task state that
needs it, rather than a differently-shaped isolation mechanism per Lambda.

A new `AssumeTrialOrgExecutionRole`-shaped Task state (tagging the assumed session with
`TrialOrgId`, mirroring the one already in place before `RunTofu`) is inserted immediately before
`SnapshotBeforeDestroy`, `SuspendInstance`, and `WakeInstance`.

**Credential delivery differs from the ECS path.** `ecs:RunTask` accepts container environment
overrides, which is how `RunTofu` receives `trial_org_execution`'s temporary credentials
(ADR-0031). A Lambda function's execution role cannot be swapped per-invocation the same way, so
the assumed session's temporary credentials are instead passed as fields in the `Payload` each
Task state already sends its Lambda, alongside the existing `trial_org_id`/`retention_days` (for
`snapshot_manager`) or `instance_id`/`action` (for `ec2_power_control`) fields. Both Lambdas'
handler code is updated to construct their boto3 EC2 client from these explicit payload-supplied
credentials when present, in preference to their own implicit execution-role credential chain —
the same "explicit credentials win" precedence the AWS SDK/Terraform AWS provider already give
`RunTofu`'s injected environment variables over ECS task-role credentials.

**Both Lambdas' own static execution roles are stripped to the minimum.** Once their mutating EC2
permissions move to `trial_org_execution`, `snapshot_manager`'s and `ec2_power_control`'s own IAM
roles keep only `AWSLambdaBasicExecutionRole` plus the describe-only reads AWS doesn't support
tag-conditioning on (`ec2:DescribeInstances` for `snapshot_manager`'s volume lookup;
`ec2:DescribeInstances`/`ec2:DescribeInstanceStatus` for `ec2_power_control`'s waiter). A Lambda
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
- **The #161/#110/#162 invite-reachability/identity-binding gap** (ADR-0032) is unaffected by this
  decision and remains deferred until the org-facing login/controller layer's design begins.
- `snapshot_cleanup`'s own IAM role is a separate Lambda, not named in CodeRabbit's finding or
  issue #177, and is out of scope here unless a later pass finds it shares the identical pattern.
