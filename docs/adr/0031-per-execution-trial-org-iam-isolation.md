# Per-execution Trial Org IAM isolation via AssumeRole + session tags

Issue [#125](https://github.com/dahagag/odoo/issues/125), closing a gap PR #124's CodeRabbit review
flagged and [ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)'s ECS task role
documented as a deliberate, accepted limitation: the shared `tofu-runner` ECS task role could
mutate *any* Trial Org's DNS record or tagged EC2 resources, not only the one its own invocation
targets, because `ecs:RunTask` has no session-tag propagation mechanism equivalent to
`sts:AssumeRole`'s `sts:TagSession` — the same mechanism `hosting_admin`'s own role already uses
(`infra/foundation/iam.tf`'s `ReadTrialOrgLogs` statement) to scope per-Trial-Org log reads.

## Decision: assume a per-invocation role from the state machine, not the container

Rather than changing the tofu-runner container image (owned by a separate CI pipeline, outside
this repo) to call `sts:AssumeRole` itself before running `tofu`, the state machine does it on the
container's behalf: a new `AssumeTrialOrgExecutionRole` Task state
(`arn:aws:states:::aws-sdk:sts:assumeRole`) runs immediately before `RunTofu`, tagging the
assumed session with that execution's own `TrialOrgId` and `DnsRecordName`. The resulting
temporary credentials are passed to the ECS `RunTask` call as `AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` container environment overrides — the AWS SDK and
Terraform/OpenTofu's own AWS provider both resolve credentials from explicit environment
variables ahead of a container's ECS task-role credentials, so every AWS call `tofu apply` makes
during that invocation runs under the scoped-down role without any change to the tofu-runner
image itself.

The former `ecs_task` role's entire inline policy moves to the new `trial_org_execution` role,
assumable only by `sfn_execution` (the state machine's own execution role, which gains a matching
`sts:AssumeRole`/`sts:TagSession` grant scoped to `trial_org_execution`'s ARN). `ecs_task` itself
is left with no inline policy at all: a compromised or buggy tofu-runner image that never
performs an AssumeRole (or that ignores the injected credentials and falls back to its own ECS
task-role credentials) has zero standing AWS access, rather than falling back to the shared
task-wide permissions it used to carry directly. This is a stronger backstop than the previous
design, not merely an equivalent restatement of it.

## Tightened conditions

- **EC2** (`ManageTrialOrgEc2Existing`): the `Null: aws:ResourceTag/TrialOrgId` check ("any tagged
  Trial Org resource") is replaced with `StringEquals: aws:ResourceTag/TrialOrgId ==
  ${aws:PrincipalTag/TrialOrgId}` — a genuine ABAC match between the resource's own tag and this
  session's tag, the same pattern `ReadTrialOrgLogs` already used for log groups.
- **DNS** (`ManageTrialOrgDnsRecords`): Route53 record sets carry no `aws:ResourceTag` of their
  own to condition on, and the per-trial hostname label (`dns_subdomain_label`, e.g.
  `acme-widgets`) is independent of the numeric `trial_org_id` by design (readability, per
  `infra/modules/trial_org/variables.tf`'s own `trial_org_subdomain_label` docstring), so no
  session tag built only from `trial_org_id` could pin the exact record name. Instead,
  `hosting_admin`'s `AwsProvisioner` computes the exact expected record name
  (`<dns_subdomain_label>.<dns_domain_suffix>`) and passes it as `dns_record_name` in the
  execution input; the state machine carries it forward as the `DnsRecordName` session tag; the
  IAM condition matches `route53:ChangeResourceRecordSetsNormalizedRecordNames` against
  `${aws:PrincipalTag/DnsRecordName}` via `ForAllValues:StringEquals`, replacing the previous
  `*.<root_domain>`/`*.<dev_subdomain>` wildcard pattern. One Trial Org's invocation can no longer
  touch another Trial Org's record even though every Trial Org shares one Route53 hosted zone.

## New Odoo-side plumbing

- `hosting.trial.org.dns_subdomain_label` (Char): the DNS label this Trial Org's instance is
  reachable under. Defaults to a slugified `name` on `create()` when left blank, validated against
  the same regex `infra/modules/trial_org`'s own `trial_org_subdomain_label` variable enforces, so
  a derived default can never fail `tofu`'s own variable validation.
- `hosting_admin.dns_domain_suffix` (`ir.config_parameter`): the domain suffix this Platform
  instance's configured foundation deployment issues Trial Orgs under — whichever of
  `infra/foundation`'s two wildcard domains (`var.root_domain`/`var.dev_subdomain`) this
  environment actually uses. `AwsProvisioner.issue()`/`destroy()` combine it with the Trial Org's
  own `dns_subdomain_label` to build `dns_record_name`, raising a clear `UserError` (the same
  pattern `base_ami_id`/`tofu_module_git_sha` already use) rather than starting an execution AWS
  would reject anyway if it's unconfigured.

## Scope not touched by this change

Suspend/Wake calls the `ec2_power_control` Lambda directly, not through `RunTofu`/`ecs_task` — its
own IAM role documents the identical class of gap ("any tagged Trial Org resource", no
execution-scoped identity to condition on) as a separately accepted limitation, since it has no
assumed-role session of its own to tag. Issue #125 named only `iam.tf`'s `ManageTrialOrgDnsRecords`
and `ManageTrialOrgEc2Existing` statements (both on the ECS task role `RunTofu` launches), so this
ADR and its implementation are scoped there; the Lambda's own gap is unchanged and remains tracked
by its existing inline comment, not by this ADR.
