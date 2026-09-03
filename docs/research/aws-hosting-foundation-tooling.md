# AWS hosting-foundation tooling

Research date: 2026-09-03. Scope: reference material for choosing IaC/provisioning
tooling for the Hosting Operations capability (see
[`docs/contexts/hosting/CONTEXT.md`](../contexts/hosting/CONTEXT.md),
[ADR-0013](../adr/0013-aws-organizations-for-hosting-foundation.md), and
[ADR-0014](../adr/0014-per-org-ec2-with-suspend-wake-for-trials.md)). At the time
this research ran, the working assumption was that Odoo (running on Render,
outside AWS) would call AWS APIs directly via boto3 from a server action on the
CRM Opportunity record to provision one EC2 instance per 14-day Trial Org, no
separate provisioning microservice — that assumption is what section 1 below
compares tools against. This note compares tool licensing, programmatic/
per-tenant provisioning patterns, IAM models for an external caller, and Cost
Explorer/Budgets tag-based attribution. It does not recommend a choice — it
exists to inform a follow-up interview.

**Superseded premise:** the interview this note fed into settled on a different
path than the boto3-direct assumption above — see
[ADR-0016](../adr/0016-opentofu-for-static-and-per-trial-provisioning.md).
`hosting_admin` invokes the OpenTofu CLI (not boto3 directly) per Trial Org
lifecycle action, against remote S3 state with DynamoDB locking, running inside
AWS (the Platform Account, per ADR-0015) rather than on Render. Section 1's tool
comparison and section 3's external-caller IAM research remain accurate
background for *why* that choice was made; treat direct boto3 provisioning as
the rejected alternative it became, not the current implementation.

Every claim below is tied to the primary source it came from. Where a claim
could not be pinned to primary-source text, it is listed under
[Unverified / could not confirm](#unverified--could-not-confirm) instead of
being stated as fact.

## 1. IaC tool choice for per-tenant dynamic stack instantiation

### Licensing (verified from each project's own source/announcement)

| Tool | License | Source |
|---|---|---|
| Terraform (HashiCorp) | Business Source License v1.1 (BSL/BUSL), for all releases from August 10, 2023 onward. HashiCorp's own APIs/SDKs/most libraries remain MPL 2.0; the BSL text sets a four-year "Change Date" after which each release converts to MPL 2.0. | [HashiCorp — "HashiCorp adopts Business Source License"](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license) |
| OpenTofu | Mozilla Public License 2.0 (MPL 2.0), confirmed by the `LICENSE` file text at the head of the repo. Forked from the last MPL-2.0 Terraform release (1.5.x); governed by the Linux Foundation. | [`opentofu/opentofu` LICENSE](https://raw.githubusercontent.com/opentofu/opentofu/main/LICENSE) |
| AWS CDK | Apache License, Version 2.0, confirmed by the `LICENSE` file text at the head of the repo. | [`aws/aws-cdk` LICENSE](https://raw.githubusercontent.com/aws/aws-cdk/main/LICENSE) |
| AWS CloudFormation / SAM | Not a licensed software artifact — CloudFormation is an AWS service (no separate license to evaluate); SAM's CLI/transform tooling is separately open source but was not evaluated here since it is a thin layer over CloudFormation. | — |

HashiCorp's BSL text: "HashiCorp is changing its source code license from
Mozilla Public License v2.0 (MPL 2.0) to the Business Source License (BSL,
also known as BUSL) v1.1 on all future releases of HashiCorp products." The
same page states the license permits internal use (including running
Terraform in CI to provision infrastructure) and prohibits only "providing a
competitive offering to HashiCorp products and services."
Source: [HashiCorp — "HashiCorp adopts Business Source License"](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license).

### Documented patterns for provisioning multiple resource sets

**CDK.** The `App`/`Stack` construct model is documented generically — an
`App` is "a collection of one or more CDK stacks," and "you can deploy any or
all of the stacks within an app with a single `cdk deploy` command." The
guide's `App`/`Stack` walkthrough does not describe a named "one stack per
tenant, created on demand" pattern; it documents the tree/scope mechanics
(`App` → `Stack` → constructs) that such a pattern would be built from, not
the pattern itself.
Source: [AWS CDK Developer Guide — AWS CDK apps](https://docs.aws.amazon.com/cdk/v2/guide/apps.html).

**Terraform.** The `for_each` meta-argument's own documentation frames it as
a way to "manage several similar objects, such as a fixed pool of compute
instances, without writing a separate block for each object" — its examples
use static maps/sets known at plan time, not a documented pattern for
provisioning a new resource set in response to a runtime application event.
Source: [Terraform docs — The `for_each` Meta-Argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each).

Neither tool's primary documentation, as fetched in this session, states a
named pattern for "provision N nearly-identical resource sets on demand,
triggered by application code" as a first-class documented workflow — the
building blocks exist in each (CDK's construct tree; Terraform's `for_each`
plus its workspace/module system) but the on-demand-per-business-event shape
described for Hosting Operations was not found spelled out as such in either
tool's own docs.

### Programmatic invocation from a boto3/Python caller at runtime

**CDK.** AWS now documents a separate **CDK Toolkit Library**
(`@aws-cdk/toolkit-lib`) that exposes synth/deploy/destroy/etc.
programmatically "through code instead of using CLI commands." Per its own
docs and npm listing, it is a **Node.js library** (`npm i
@aws-cdk/toolkit-lib`), and its worked example is TypeScript. No Python
package equivalent to `@aws-cdk/toolkit-lib` was found in this session — the
CDK's Python bindings (`aws-cdk-lib`) let a Python app construct `App`/`Stack`
objects and call `app.synth()` to produce CloudFormation templates in-process
(no CLI needed for synthesis itself, per the jsii-generated Python bindings
used in the standard `App`/`Stack` example), but the documented path to
actually **deploy** those templates — the CDK Toolkit Library — is Node.js
only as of this session's research. In practice this means a Python/boto3
caller wanting `cdk deploy`-equivalent behavior either shells out to the
Node.js CDK CLI, or bypasses CDK's deploy orchestration and calls the
CloudFormation API directly via boto3 against CDK-synthesized templates.
Sources: [AWS CDK Developer Guide — Perform programmatic actions using the CDK Toolkit Library](https://docs.aws.amazon.com/cdk/v2/guide/toolkit-library.html), [`@aws-cdk/toolkit-lib` on npm](https://www.npmjs.com/package/@aws-cdk/toolkit-lib), [AWS — "AWS CDK Toolkit Library is now generally available"](https://aws.amazon.com/about-aws/whats-new/2025/05/aws-cdk-toolkit-library-available/).

**Terraform.** HashiCorp does not publish an official Python SDK for driving
the **local/open-source Terraform CLI** in-process. `python-terraform`
(`beelit94/python-terraform` on GitHub) is a community-maintained wrapper
around the `terraform` CLI binary, MIT-licensed, unofficial, and is the only
Python option for that local-CLI path. For the separate **HCP Terraform API**
path, HashiCorp does publish and maintain an official Python client,
`python-tfe` (`hashicorp/python-tfe` on GitHub, published as `pytfe` on PyPI) —
distinct from, and not a substitute for, `python-terraform`'s local-CLI
wrapping. HCP Terraform (formerly Terraform Cloud) also documents an
official, API-driven run workflow independent of any client library:
`POST /runs` "performs a plan and apply, using a configuration version and the
workspace's current variables," and a paused run can be confirmed via
`POST /runs/:run_id/actions/apply`; these endpoints require a user or team
token (not an organization token). Both the `python-tfe` client and the raw
`POST /runs` workflow are HashiCorp's own documented paths for triggering a
Terraform run programmatically without shelling out to the CLI directly — but
both are scoped to HCP Terraform's hosted run architecture, not local/
open-source Terraform invoked in-process, which is what this repo uses via
OpenTofu (ADR-0016) — so neither is directly relevant to this decision.
Sources: [`hashicorp/python-tfe` on GitHub](https://github.com/hashicorp/python-tfe), [`pytfe` on PyPI](https://pypi.org/project/pytfe/).
Sources: [`beelit94/python-terraform` on GitHub](https://github.com/beelit94/python-terraform), [HCP Terraform API docs — Runs](https://developer.hashicorp.com/terraform/cloud-docs/api-docs/run).

## 2. AWS-native alternative: no IaC tool at all

**AWS Service Catalog.** AWS's own introduction frames it around
end-user self-service from an admin-curated, constrained catalog: "Users
browse listings of products... that they have access to, locate the product
that they want to use, and launch it all on their own as a provisioned
product," with the value proposition being standardization and governance
("achieve consistent governance and meet compliance requirements... following
the constraints set by your organization"). The same page does note "The
Service Catalog API provides programmatic control over all end-user actions
as an alternative to using the AWS Management Console" — so it can in
principle be driven by application code rather than a human clicking through
the console, but its documented framing throughout is end-user self-service
against a governed catalog, not an application-code-driven per-tenant
automation pattern.
Source: [AWS Service Catalog Administrator Guide — What Is Service Catalog?](https://docs.aws.amazon.com/servicecatalog/latest/adminguide/introduction.html).

**Plain boto3 calls (`ec2.run_instances`, `stop_instances`/`start_instances`,
etc.) triggered directly from application code on a business event.** No AWS
primary-source page was found in this session that documents this shape of
workload — "provision on business-event (a button click on a CRM record), not
on deploy" — as a named, recommended pattern. `run_instances`, `stop_instances`
and `start_instances` are documented individually as boto3/EC2 API operations
(request/response shape, parameters, tagging on create via
`TagSpecifications`), but AWS's own docs, as searched and fetched here, do not
editorialize about when calling them directly from application code (versus
routing through Service Catalog, CloudFormation, or an IaC tool) is the
recommended approach for this shape of on-demand, business-event-triggered
provisioning. This is a documentation gap rather than a confirmed absence of
the pattern — see the Unverified section.
Source (API surface only, not a recommendation): [boto3 EC2 client — `run_instances`](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ec2/client/run_instances.html).

**CloudFormation StackSets.** Not independently fetched from a primary page
in this session — see Unverified.

## 3. IAM least-privilege model for an external caller

### Roles vs. long-lived access keys

AWS's current IAM best-practices page leads with role-based, temporary
credentials for both humans and workloads, and frames long-term IAM user
access keys as an exception, not a default:

> "Require workloads to use temporary credentials with IAM roles to access
> AWS." ... "there is no need to distribute long lived credentials for an IAM
> user to your workloads running on AWS."

For long-term credentials specifically: "Where possible, we recommend
relying on temporary credentials instead of creating long-term credentials
such as access keys," listing narrow exceptions (workloads that structurally
cannot use IAM roles, some third-party AWS clients, CodeCommit, Keyspaces
compatibility testing) rather than treating access keys as a normal choice.
Source: [IAM User Guide — Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

### Authenticating from outside AWS (Odoo on Render)

The same best-practices page documents multiple ways a workload running
**outside** AWS can still obtain temporary role credentials rather than a
long-lived key: IAM Roles Anywhere (X.509 certificate from an organization's
own PKI), `sts:AssumeRoleWithSAML` (SAML assertion from an external IdP), and
`sts:AssumeRoleWithWebIdentity` (JWT from an external IdP) — the last being
the OIDC-federation path.
Source: [IAM User Guide — Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

**`sts:AssumeRole` with an external ID** is documented separately as the
mechanism for a specific, known third-party account assuming a role in your
account: the account owner creates a role scoped to the third party's AWS
account ID as principal, with a trust-policy `Condition` on `sts:ExternalId`
to guard against the confused-deputy problem — e.g.
`"Condition": {"StringEquals": {"sts:ExternalId": "..."}}`. This pattern
presumes the caller already has an AWS account/principal of its own that
calls `AssumeRole`; it is a same-caller-different-account mechanism, not
itself a way for a non-AWS application to get an initial AWS identity.
Source: [IAM User Guide — Access to AWS accounts owned by third parties](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html).

**OIDC federation** is documented as the mechanism for an application with no
AWS-native identity of its own (a "mobile app or web application that
requires access to AWS resources" where you "don't want to create custom
sign-in code or manage your own user identities") to authenticate into AWS:
create an IAM OIDC identity provider pointing at the external IdP's discovery
document, then create a role trusting that provider; the app then calls
`AssumeRoleWithWebIdentity` with a JWT from the IdP to obtain temporary
credentials.
Source: [IAM User Guide — Create an OpenID Connect (OIDC) identity provider in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html).

### Tag-based (ABAC) scoping

AWS's ABAC documentation describes tag-matching between principal and
resource as the authorization mechanism ("You can design ABAC policies that
allow operations when the principal's tag matches the resource tag") and
states its advantage for a growing set of like-shaped resources: "It's no
longer necessary for an administrator to update existing policies to allow
access to new resources" as new tagged resources are created.
Source: [IAM User Guide — Define permissions based on attributes with ABAC authorization](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html).

The specific condition key is `aws:ResourceTag/<tag-key>`. AWS's own EC2
example-policy page uses this key repeatedly to scope EC2 actions to
tagged resources, e.g.:

```json
{
  "Effect": "Allow",
  "Action": "ec2:TerminateInstances",
  "Resource": "arn:aws:ec2:us-east-1:{{111122223333}}:instance/*",
  "Condition": {
    "StringEquals": { "aws:ResourceTag/purpose": "test" }
  }
}
```

and for `RunInstances` against a launch template — **shown here as AWS documents it, a
fragment covering only the launch-template resource**, not the complete permission set a real
`RunInstances` call needs:

```json
{
  "Effect": "Allow",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:{{us-east-1}}:{{111122223333}}:launch-template/*",
  "Condition": {
    "StringEquals": { "aws:ResourceTag/Purpose": "Webservers" }
  }
}
```

`RunInstances` requires permission on every resource it references, not just the launch
template: AWS's own EC2 permissions documentation states the caller needs access to each AMI,
subnet, network interface, security group, key pair, and volume involved, plus the resulting
`instance` resource itself; if the instance is tagged on creation, `ec2:CreateTags` is required
too (commonly granted alongside `ec2:CreateLaunchTemplate` when tagging happens at template
creation instead). A production policy for the per-trial-org `RunInstances` call in ADR-0016
needs `Resource` entries (or a wildcard scoped by `aws:ResourceTag`/`aws:RequestTag` conditions)
covering all of these, not just the launch template shown above.
Sources: [Amazon EC2 User Guide — Example policies to control access to the Amazon EC2 API](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html), [Amazon EC2 User Guide — Example: Launch instances with permissions for launch templates](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/permissions-for-launch-templates.html).

Whether Route53 and Cost Explorer support the same `aws:ResourceTag`-style
condition keys for the specific actions Hosting Operations would need
(e.g. scoping a Route53 record change or a Cost Explorer query to a
trial-org tag) was not separately confirmed against each service's own
Service Authorization Reference page in this session — see Unverified.

## 4. Cost Explorer / Budgets API for per-resource-tag cost attribution

This section originally documented only the Cost Explorer `GetCostAndUsage` path; the Budgets
subsection below fills the gap the heading implied.

### `GroupBy` on cost allocation tags

`GetCostAndUsage`'s `GroupBy` parameter accepts a `TAG`-typed group
alongside (or instead of) `DIMENSION`-typed groups, up to two groups per
request: "You can group AWS costs using up to two different groups, either
dimensions, tag keys, cost categories, or any two group by types," and "When
you group by the `TAG` type and include a valid tag key, you get all tag
values, including empty strings." AWS's own request example groups by
`SERVICE` (dimension) and `Environment` (tag) together, returning result keys
like `"Environment$Prod"`.
Source: [AWS Billing and Cost Management API Reference — `GetCostAndUsage`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html).

### Activation requirement before tags appear in Cost Explorer

AWS documents cost allocation tags as two separate types — AWS-generated and
user-defined — and states explicitly: "You must activate both types of tags
separately before they can appear in Cost Explorer or on a cost allocation
report." Only the management account (or a standalone non-Organizations
account) can access the cost allocation tags manager to do this activation.
Source: [AWS Billing and Cost Management User Guide — Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html).

### Propagation delay

The same page states a specific, primary-sourced number: "All tags can take
up to 24 hours to appear in the Billing and Cost Management console." This
is the activation-visibility delay for the tag itself, stated on AWS's own
cost-allocation-tags overview page — a search-engine synthesis (not
independently fetched as primary text in this session) additionally
characterized the full pipeline as "up to 24 hours" per step, "about 48
hours" end-to-end before a newly-activated tag's cost data is filterable in
Cost Explorer; that 48-hour compound figure is **not** confirmed against
primary AWS text in this session and should be treated as unverified pending
a direct read of AWS's own "Understanding dates for cost allocation tags"
page (linked from, but not itself fetched from, the page above).
Source: [AWS Billing and Cost Management User Guide — Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html).

### AWS Budgets tag-filter behavior

Budgets shares the same cost-allocation-tag activation requirement and up-to-24-hour delay
documented above — a tag unusable in Cost Explorer before activation is equally unusable as a
Budgets filter. Beyond that shared constraint, AWS's `CreateBudget`/`UpdateBudget` API documents
two mutually exclusive ways to express a tag filter: the legacy `CostFilters`/`CostTypes` fields,
and the newer `FilterExpression`/`Metrics` fields (which AWS recommends for their more flexible
exclusion support) — a single API call must use one pair or the other, not both. Two behaviors
worth noting for a runway dashboard built on this API: updating an existing budget resets its
calculated spend to zero until AWS refreshes usage data for forecasting (so an edit briefly blanks
out the figure rather than updating it in place), and tags applied to the Budget resource itself
(via `TagResource`, for governance/access control) are unrelated to and do not filter the cost and
usage data a budget reports on — only cost-allocation tags on the underlying billed resources do
that.
Sources: [AWS Cost Management User Guide — Managing your costs with AWS Budgets filters](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create-filters.html), [AWS Billing and Cost Management API Reference — `CreateBudget`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_CreateBudget.html), [AWS Cost Management User Guide — AWS Budgets best practices](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html).

## Unverified / could not confirm

- **A named AWS pattern (or explicit AWS recommendation) for "provision
  on business-event via plain boto3 calls, not on deploy."** No AWS
  primary-source page was found or fetched in this session that
  editorializes on when calling `ec2.run_instances`/`stop_instances`/
  `start_instances` directly from application code is the recommended
  approach versus routing through Service Catalog, CloudFormation, or an
  IaC tool — the individual API operations are documented, but not this
  architectural judgment call.
- **CloudFormation StackSets' fit for per-tenant on-demand provisioning.**
  Not fetched from a primary AWS page in this session; StackSets' primary
  documented use case (deploying one template across many
  accounts/regions) was not verified against Hosting Operations' shape
  (many near-identical stacks within one account, triggered by application
  code) in this session.
- **Whether Route53 and Cost Explorer support `aws:ResourceTag`-style ABAC
  condition keys for the specific actions Hosting Operations would use**
  (e.g. a Route53 record-set change scoped to a trial-org tag, or a Cost
  Explorer query scoped by caller identity). Confirmed for EC2 via AWS's own
  example-policy page; not separately checked against Route53's or Cost
  Explorer's own Service Authorization Reference entries in this session.
- **The compound "~48 hours end-to-end" figure for a newly-activated cost
  allocation tag's data becoming queryable in Cost Explorer.** AWS's own
  cost-allocation-tags overview page states "up to 24 hours to appear in the
  Billing and Cost Management console" for tag activation; a secondary
  (non-AWS) source doubled this to ~48 hours as a compound estimate across
  tagging and Cost Explorer indexing steps. That doubled figure was not
  independently confirmed against AWS's own "Understanding dates for cost
  allocation tags" page (linked from the primary source used above, but not
  fetched in this session) or any other AWS primary text.
- **Whether the AWS CDK Toolkit Library (`@aws-cdk/toolkit-lib`) has, or has
  announced, a Python release.** As fetched in this session, both the AWS
  docs page and the npm listing describe it as a Node.js package
  (`npm i @aws-cdk/toolkit-lib`) with a TypeScript example; no Python
  package name or roadmap statement for a Python equivalent was found. This
  reflects the state of AWS's own documentation as retrieved in this
  session and could change.
- **Whether `cdk synth` truly requires zero Node.js tooling when using CDK's
  Python bindings**, versus the Python bindings themselves being jsii
  shims over a Node.js runtime under the hood. The AWS CDK apps guide shows
  `app.synth()` called directly from Python code, but this session did not
  fetch a primary-source page explaining jsii's runtime architecture (i.e.,
  whether a Node.js process is still spawned transparently underneath the
  Python `aws-cdk-lib` package during synthesis).

## Sources

- [HashiCorp — "HashiCorp adopts Business Source License"](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [`opentofu/opentofu` — LICENSE](https://raw.githubusercontent.com/opentofu/opentofu/main/LICENSE)
- [`aws/aws-cdk` — LICENSE](https://raw.githubusercontent.com/aws/aws-cdk/main/LICENSE)
- [AWS CDK Developer Guide — AWS CDK apps](https://docs.aws.amazon.com/cdk/v2/guide/apps.html)
- [AWS CDK Developer Guide — Perform programmatic actions using the CDK Toolkit Library](https://docs.aws.amazon.com/cdk/v2/guide/toolkit-library.html)
- [`@aws-cdk/toolkit-lib` on npm](https://www.npmjs.com/package/@aws-cdk/toolkit-lib)
- [AWS — "AWS CDK Toolkit Library is now generally available"](https://aws.amazon.com/about-aws/whats-new/2025/05/aws-cdk-toolkit-library-available/)
- [Terraform docs — The `for_each` Meta-Argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [`beelit94/python-terraform` on GitHub](https://github.com/beelit94/python-terraform)
- [HCP Terraform API docs — Runs](https://developer.hashicorp.com/terraform/cloud-docs/api-docs/run)
- [AWS Service Catalog Administrator Guide — What Is Service Catalog?](https://docs.aws.amazon.com/servicecatalog/latest/adminguide/introduction.html)
- [boto3 EC2 client — `run_instances`](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ec2/client/run_instances.html)
- [IAM User Guide — Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [IAM User Guide — Access to AWS accounts owned by third parties](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html)
- [IAM User Guide — Create an OpenID Connect (OIDC) identity provider in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [IAM User Guide — Define permissions based on attributes with ABAC authorization](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html)
- [Amazon EC2 User Guide — Example policies to control access to the Amazon EC2 API](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html)
- [AWS Billing and Cost Management API Reference — `GetCostAndUsage`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)
- [AWS Billing and Cost Management User Guide — Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
