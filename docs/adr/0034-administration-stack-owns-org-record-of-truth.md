# The administration stack owns the Trial Org and Client Org record of truth

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)). This ADR **supersedes
[ADR-0018](0018-hosting-split-into-admin-and-org-facing-addons.md)**, which placed the cross-org
Trial Org model, the AWS integration, suspend/wake control, and the cost dashboard inside
`hosting_admin`.

A separate application — the **Administration Stack**, running in the Platform Account
([ADR-0015](0015-production-migrates-to-aws-platform-account.md)) — owns the record of truth for
every Trial Org and Client Org, stored in DynamoDB. It fronts AWS behind a single boundary and
serves two surfaces: a staff administration app and a public client app.

`hosting_admin` shrinks to a **CRM integration**: issue a Trial Org from an Opportunity, mirror
read-only state onto that Opportunity, hold the Opportunity link. Nothing else. Its lifecycle
logic, seat rules, provisioner, and cost models port to the stack with their behaviour
reproduced, and Odoo holds no AWS credential afterwards.

Two things ADR-0018 decided **still stand** and are not reopened here:

- The `hosting` thin addon survives, installed on each org's own instance, surfacing that org's
  own Org Registration and nothing else. It now reads that registration from a separate
  read-only, per-org-scoped stack endpoint instead of from Odoo-side data.
- ADR-0018's **no-dependency rule** between `hosting` and `hosting_admin` stands. It is why the
  org-facing read path gets its own minimal client (`OrgRegistrationClient`) rather than reusing
  `hosting_admin`'s stack client.

What ADR-0018 got right was that admin-only code must be *absent* from a customer-facing
instance, not merely inert on it. This ADR extends that same reasoning one boundary further out:
code that can destroy infrastructure and read across orgs should not be *in Odoo at all*, where
it sits behind the same web framework, the same session layer, and the same public surface as
everything else Odoo serves.

## Why ownership moves out of Odoo rather than staying in `hosting_admin`

**Odoo keeping ownership — rejected.** Odoo would remain the record of truth, with the stack (if
any) reduced to a proxy. This leaves the infrastructure plane dead during an Odoo outage: no
Wake, no suspend, no auto-destroy, no way for a prospect whose org is asleep to get it back,
because the only system that knows an org exists is the one that is down. Odoo is a commercial
application on an ordinary upgrade-and-restart cycle; the control plane for customer
infrastructure should not inherit its availability.

Two further consequences pushed the same way. Odoo is the system a staff member logs into all
day, and it holds the AWS credentials — so taking Odoo private
([ADR-0037](0037-odoo-has-no-public-ingress.md)) would otherwise take the client-facing surfaces
(Wake, invitations, the asleep page) with it. And a `hosting_admin`-owned record forces the
org-facing read path to be reachable at Odoo's own public ingress, which is precisely what we are
removing.

**A split record — rejected.** Odoo keeps the commercial facts (Opportunity link, qualification
state) as its own records while the stack keeps the infrastructure facts, with both claiming
ownership of the org's identity and lifecycle state. This is two records to keep consistent, with
no answer for which one is right when they disagree — the same "two systems of record for the
same facts, drifting apart the moment one write path is missed" objection
[ADR-0022](0022-live-aws-pulled-audit-view.md) already made against an Odoo-side audit log.
Mirroring is not a split record: `hosting_admin` holds a read-only projection it never authors,
and the Opportunity link is a CRM fact about a commercial decision, not a claim on the org's
lifecycle.

## What this moves, and what it retires

- **Ported to the stack, behaviour reproduced:** Trial Org lifecycle (issuance, seats,
  suspend/wake, extension, auto-destroy), the OpenTofu/AWS integration, and the cost dashboard.
  [ADR-0030-cost](0030-cost-dashboard-daily-snapshot-not-live-pull.md)'s
  snapshot-not-live-pull decision and [ADR-0022](0022-live-aws-pulled-audit-view.md)'s
  live-pulled audit decision both keep their reasoning; only their host changes.
- **Retired rather than moved:** [ADR-0023](0023-real-time-trial-org-log-viewer.md)'s Odoo-side
  log viewer. The forwarder retargets to the stack and the viewer is rebuilt in the staff app,
  rather than being left unreachable behind a private Odoo.
- **Unchanged:** account separation ([ADR-0013](0013-aws-organizations-for-hosting-foundation.md),
  ADR-0015), per-org EC2 with suspend/wake
  ([ADR-0014](0014-per-org-ec2-with-suspend-wake-for-trials.md)), OpenTofu as the provisioning
  tool ([ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md)), and the
  job-orchestration and IAM-isolation decisions built on them
  ([ADR-0019](0019-step-functions-job-identity-and-retry-safety.md),
  [ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md),
  [ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md),
  [ADR-0024](0024-per-trial-org-deployment-versioning.md),
  [ADR-0031](0031-per-execution-trial-org-iam-isolation.md),
  [ADR-0033](0033-extend-per-execution-iam-isolation-to-lifecycle-lambdas.md)). Trial and Client
  Org workloads still run in the Hosting Account; the stack reaches them through ADR-0019's
  narrow cross-account role.

## Where authority still sits in Odoo

Extension stays gated on sales-methodology qualification, which is Odoo's own concept and stays
there. The stack exposes the extension write; Odoo is the only actor permitted to invoke it. So
"the stack owns the record" is not "the stack owns the commercial decision" — CRM still decides
*whether* an org is issued or extended, and the stack decides nothing about a deal.
