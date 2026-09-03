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
