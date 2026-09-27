---
status: accepted
---

# dev.domain.com staging Odoo: Platform Account, no public surface, Tailscale for every tier

Part of [#193](https://github.com/dahagag/odoo/issues/193) via
[#203](https://github.com/dahagag/odoo/issues/203). This is the first sub-issue in #203's own
tree ([#336](https://github.com/dahagag/odoo/issues/336)): it records the design decisions the
rest of that tree builds against, before any Terraform, entrypoint, or addon code lands.

`dev.domain.com` stands up agentic-erp's own Odoo — not a Trial/Client Org instance — as a
staging environment in the **Platform Account**, alongside production
([ADR-0013](0013-aws-organizations-for-hosting-foundation.md)'s "Update" already anticipated
this: "the Platform Account... hold[s] agentic-erp's own instances — production and staging").
It deploys from `dev/19.0` on every merge, resetting to a fresh demo database each time
(mechanism recorded separately, [ADR-0041](0041-staging-fresh-database-per-deploy-and-seeded-access-tiers.md)).
Staging has **no credential or network path into the Hosting Account** — it cannot reach
Trial/Client Org infrastructure or data, so a compromised staging instance is contained.

## No public surface at all

#203 was originally filed with a public, WAF-protected surface for named early-adopter clients,
deliberately unlike production's fully private Odoo ([ADR-0037](0037-odoo-has-no-public-ingress.md)).
That design changed during review, after pricing out the alternatives below. **Every access
tier — engineering staff, internal stakeholders, and named early-adopter clients — reaches
staging over Tailscale. There is no ALB, no WAFv2, and no public Route53 record for
`dev.domain.com`.**

This removes the asymmetry the original filing accepted as its main risk (staging's network
posture no longer diverges from production's own private-Odoo stance), and it means staging's
compute can reuse the private-only ECS shape `infra/platform` already established for the
administration-stack API (egress-only security group, no load balancer) instead of this repo
building its first public-ingress design from scratch.

## Why Tailscale, not an AWS-native VPN

[ADR-0017](0017-self-hosted-ci-runner-in-platform-account.md) already commits the self-hosted CI
runner to reaching Odoo "over Tailscale" once it exists — real precedent for the mechanism, just
not yet built anywhere in this repo's Terraform. Two AWS-native alternatives were priced against
it for this ticket, using AWS's own published rates:

- **AWS Client VPN**, certificate-only (mutual TLS, no SAML/IdP — this org has none). Its cost is
  dominated by a fixed per-subnet-association-hour fee that runs continuously regardless of
  usage: roughly $155/month for one shared endpoint with a self-managed CA, up to ~$1,655/month
  for three endpoints (one per access tier) each with its own ACM Private CA (~$400/month/CA).
  Pure certificate auth also carries no group claims, so distinguishing engineering from
  stakeholders from early-adopters at the network layer would need multiple endpoints, not
  authorization rules on one.
- **AWS SSO (IAM Identity Center) + SSM Session Manager port-forwarding**, reusing the identity
  system [ADR-0038](0038-migrate-container-registry-from-ghcr-to-ecr.md) already adopted for
  developer ECR pulls. Free of new recurring cost for engineering staff, but does not extend to
  named early-adopter clients at all — they have no AWS identity, and Identity Center's external-
  guest support is built for occasional cross-account access, not a named-client product-
  evaluation login.

**Tailscale Standard** is a flat $8/user/month and covers up to 3 ACL groups — exactly the three
tiers this design needs — cheaper than every AWS-native option compared, at the small headcounts
a "sized small, proving ground" environment expects (e.g. 13 total users across all tiers is
~$104/month, versus AWS Client VPN's fixed association cost that would exceed that regardless of
headcount). One shared endpoint's per-user pricing model also avoids the "one endpoint vs. three"
trade-off that dominates Client VPN's bill: a single tailnet with three ACL groups is both the
cheapest and the least infrastructure to operate.

## Access model: one tailnet, three ACL groups

- **`group:engineering`** — full access (Odoo backend plus any admin/debug tooling), paired with
  `base.group_user` on the Odoo side.
- **`group:stakeholders`** — narrower: Odoo UI only, no admin/ops surfaces, paired with a new
  restricted Odoo group (not full `base.group_user`).
- **`group:early-adopters`** — narrowest, scoped to the Odoo application itself, paired with a
  new Odoo group implied by `base.group_portal` (see ADR-0041 for the Odoo-side group and
  record-rule design).

Network-level ACL group membership and the matching Odoo-side group are enforced independently —
being on the tailnet gets a user to the instance, but what they can do once there is still gated
by Odoo's own permission model. This tiering is **staging-specific**: production's Tailscale
access (ADR-0037) is a single flat "staff" group, and non-engineering stakeholders reach
production concerns through the external Client App, never through Odoo directly, so there is no
production equivalent to share this design with.

## Consequences

- No WAFv2, no ALB, no public DNS record — the first Odoo AWS deployment in this repo is
  simpler to build than originally scoped, at the cost of early-adopter/stakeholder access
  requiring a Tailscale invite rather than a plain URL.
- Tailscale becomes a new operational dependency (inviting/removing named users as the
  early-adopter or stakeholder list changes), on top of the already-accepted "every account
  add/remove is a code change and a deploy" ceiling for the seeded Odoo logins themselves.
- If production ever builds its own Tailscale wiring (ADR-0037's still-unbuilt intent), it starts
  from a flat single-group model; this ADR's tiering does not need to be reconciled with it
  unless a future ticket explicitly extends tiering to production too.
