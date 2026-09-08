# Odoo has no public ingress; public surfaces move to static hosting and the client app

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)). This is the decision that forces several
earlier ones to move: it **amends [ADR-0011](0011-public-landing-page-overrides-root-route.md)**,
[ADR-0026](0026-two-trial-invitation-paths-with-domain-guard.md) and
[ADR-0030-asleep](0030-asleep-page-served-via-route53-failover-to-platform.md), and together with
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md) it **supersedes
[ADR-0023](0023-real-time-trial-org-log-viewer.md)**.

Our own Odoo instance — the one holding cross-org data, the CRM pipeline, and (today) the AWS
credentials — **has no public listener**. Staff reach it over Tailscale. The staff administration
app is inside Tailscale too, with no public listener of its own.

The reasoning is short: a system that can destroy customer infrastructure and read across every
org should not be reachable by anyone who can resolve a DNS name. Every other decision here
follows from Odoo having no public surface to serve from, so anything that genuinely must be
public has to live somewhere else.

## What moves out, and where to

- **The public landing page and the teach docs** move to static hosting in the Platform Account.
  ADR-0011's `/`-overriding controller in `crm_methodology` was the right call while Odoo *was*
  the public deploy surface; it stops being reachable the moment Odoo goes private. ADR-0007's
  original reasoning — teach docs are self-contained static output and need no application to
  serve them — now applies to the landing page as well, and the "second deploy surface" objection
  ADR-0011 raised against static hosting is answered: the epic builds that surface anyway, so it
  is no longer a second one.
- **Trial Org status, invitations, Wake, and the asleep page** move to the **public client app**,
  one of the administration stack's two surfaces (ADR-0034), with magic-link auth. ADR-0026's two
  invitation paths and its rep-provided domain guard are unchanged as *rules* — a Targeted Invite
  and an Open Invite Link still behave exactly as that ADR decided, and the first login through
  an Open Invite Link still confirms a company email against the rep-fixed domain. Only the
  surface that hosts them changes.
- **The asleep page's Route53 failover target** becomes the client app rather than the Platform
  Odoo instance. ADR-0030-asleep's mechanism — a Route53 failover record so a stopped instance
  serves an explanatory page instead of a connection error — stands exactly as designed; its
  secondary target is simply a surface that will still be answering.
- **The Trial Org log viewer** is rebuilt in the staff app, and the CloudWatch forwarder
  retargets from Odoo's webhook controller to the stack. This is why ADR-0023 is superseded
  rather than amended: its delivery mechanism was an HMAC-signed POST into an Odoo controller
  plus Odoo's own bus for live tailing, and neither survives Odoo losing its public listener —
  a Lambda in the Hosting Account cannot POST to a Tailscale-only host.

## What stays in Odoo

Everything commercial. The CRM pipeline, sales-methodology qualification, the Opportunity link,
and `hosting_admin`'s issue-and-mirror integration all stay exactly where they are — reached by
staff over Tailscale, which is how staff already reach every other internal system. Going private
removes a public attack surface; it does not move a single business concept.

The `hosting` addon on each org's own instance is unaffected: those instances keep their own
public listeners, because they are the product. Their per-org read path talks to the stack
([ADR-0036](0036-odoo-to-stack-contract-is-rest-with-generated-openapi.md)), never to our Odoo.

## Sequencing consequence

This makes the client app a hard prerequisite for taking Odoo private, not a parallel nicety:
until [#200](https://github.com/dahagag/odoo/issues/200) ships, removing Odoo's public listener
would take Wake, invitations, and the asleep page down with it. The production cutover
([#204](https://github.com/dahagag/odoo/issues/204)) is gated on it for exactly that reason.
