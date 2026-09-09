---
status: amended by ADR-0037
---

# Asleep/Wake-Up page served via Route53 failover to the Platform instance

**Amended:** the failover record's secondary target becomes the **client app** — one of the
administration stack's two surfaces — rather than the Platform Odoo instance, because Odoo loses
its public listener. See [ADR-0037](0037-odoo-has-no-public-ingress.md) and
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md), under epic
[#193](https://github.com/dahagag/odoo/issues/193); built in
[#200](https://github.com/dahagag/odoo/issues/200).

**The mechanism below is unchanged.** A suspended Trial Org's EC2 instance is fully stopped, so
its own instance cannot serve the page; a Route53 failover record is still what puts an
explanatory page and a Wake affordance at the org's own URL instead of a connection error, and
the health-check-driven failover and back are as designed. Only the always-on target the record
fails over *to* changes — and it has to, since a private Odoo would not answer the health check
in the first place.

This is also a better fit than the original target: the client app already owns Wake, org status,
and invitations (ADR-0026 as amended), so the asleep page's "Wake Up" button now lives on the
same surface as the action it triggers rather than crossing into a staff-facing system.

**Everything below is the original decision, since amended — read it with the note above.**

Closes one of the two functional gaps tracked by [#174](https://github.com/dahagag/odoo/issues/174)
(carried over from [#106](https://github.com/dahagag/odoo/issues/106) user stories 10/11).
[ADR-0014](0014-per-org-ec2-with-suspend-wake-for-trials.md) already committed to a real, bounded
wait on Wake and to a **static waiting page** shown while suspended, but never decided where that
page is served from. This ADR resolves that.

## The constraint that rules out the obvious answer

The ticket's own implementation note suggested a controller in `custom_addons/hosting/` (the
org-facing addon installed on every Trial Org's own instance). That doesn't work: a suspended
Trial Org's EC2 instance is fully **stopped**
([ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md) — `StopInstances`,
not a paused Odoo process). Nothing installed on that instance, `hosting` included, is running to
answer any request while it's asleep. Whatever serves the asleep page has to live somewhere that
stays up independent of the Trial Org's own compute.

## Decision

The asleep page and the Wake Up action are served by a new controller in
**`custom_addons/hosting_admin/controllers/`** — the addon already installed on the Platform
instance (per [ADR-0018](0018-hosting-split-into-admin-and-org-facing-addons.md)), the only thing
in this architecture guaranteed reachable while a given Trial Org sleeps. The controller resolves
the target `hosting.trial.org` record from the request's `Host` header, renders the asleep page
(with a Wake Up form) when that org is `suspended`, and its POST endpoint calls the org's own
`action_wake()` directly — no new AWS-facing code, no credentials, just the same
`hosting.trial.org` model `hosting_admin` already owns.

Traffic reaches it via **Route53 failover routing**, added to
`infra/modules/trial_org`'s existing DNS record: the current plain `A` record pointing at the
Trial Org's Elastic IP becomes the **PRIMARY** record in a failover pair, guarded by a Route53
health check against that same IP. A new **SECONDARY** record (same name, same `A` type, failover
routing policy) points at the Platform instance's own public ingress — same record type as the
primary, not a `CNAME`, since Route53 only associates records into one failover group when their
name *and* type match, and the primary's type is fixed to `A` by needing to hold the Trial Org's
own IP. `infra/modules/trial_org`'s new `asleep_page_failover_ips` input is therefore an IP list,
not the Platform's hostname; it's optional and unset by default, since the Platform Account's own
ingress is still undecided (ADR-0015) — a Trial Org gets today's plain, non-failover record until
a real value exists. When the health check fails — which it does by design whenever the instance
is stopped — Route53 answers the Trial Org's own domain with the Platform instance instead, and
`hosting_admin`'s controller takes it from there by Host header.

The Platform instance's own ingress (compute, load balancer/CDN, and how it terminates TLS for the
wildcard `*.<root_domain>`/`*.<dev_subdomain>` certificate already issued in
`infra/foundation/dns.tf`) is **out of scope here** — ADR-0015 explicitly deferred designing the
Platform Account's own compute and networking, and nothing in this repo's Terraform models it yet.
This ADR's Hosting-side change is limited to: the failover DNS wiring, and a new
`asleep_page_failover_ips` input declared directly on `infra/modules/trial_org` (not threaded
through `infra/foundation` — nothing in the foundation module needs to know about it), standing in
for that ingress until it exists. Wiring that variable to a real value is follow-up work tracked
against whichever ticket stands up the Platform Account's ingress.

## Why not a new Lambda/CloudFront fallback (the ticket's other suggested option)

A self-contained Lambda+CloudFront static-page fallback, wholly inside `infra/foundation`, was the
other option the ticket flagged and was seriously considered — it avoids any dependency on the
not-yet-built Platform ingress. It loses on two counts that matter more here:

- The ticket's own testing decision expects an **`HttpCase`-level test asserting the page renders
  and the Wake Up control posts to the right endpoint** — i.e., it expects the page to be an Odoo
  controller under test, not a Lambda handler. `HttpCase` boots the addon under test and hits its
  routes directly; it says nothing about the real DNS/CDN path in front of it in production, so
  this works identically whichever front door design wins, but only if the actual rendering logic
  is an Odoo controller in the first place.
- The Wake Up action needs to call `action_wake()` on a real `hosting.trial.org` record. A Lambda
  has no direct model access; it would need its own authenticated callback into an
  `hosting_admin` HTTP endpoint anyway (mirroring the existing `log_webhook.py` HMAC pattern) —
  at which point the "self-contained" option has just re-invented a second hop into
  `hosting_admin` on top of the CloudFront/Lambda infra it was trying to avoid, for no benefit.

Failing over straight to the Platform instance skips that redundant hop: one controller, one
network path, testable the way the ticket already expects.

## Consequences

- `custom_addons/hosting` gains no new code for this gap — it stays exactly what
  ADR-0018 says it should be: thin, org-facing, with zero dependency on `hosting_admin` or AWS.
- `hosting_admin`'s new controller must resolve a Trial Org from an arbitrary customer-facing
  `Host` header it does not otherwise control — it looks up by the org's own recorded domain
  (`hosting.trial.org`'s DNS label, matching `infra/modules/trial_org/locals.tf`'s `local.domain`
  convention) and returns a plain 404 for anything that doesn't resolve to a known, currently
  `suspended` Trial Org, rather than assuming the Host header is trustworthy in any stronger sense.
- The Route53 health check adds a small, ongoing per-Trial-Org AWS cost (one health check per
  active Trial Org) and one more moving part in `infra/modules/trial_org`, accepted as the "small
  piece of infra" the ticket already anticipated.
- A currently-`active` Trial Org whose instance becomes unreachable for a reason *other* than a
  deliberate Suspend (e.g. a real outage) will also fail over to the Platform instance and see the
  asleep page instead of an error — treated as acceptable degraded behavior, not a design goal in
  itself: the controller's `suspended`-state check is what makes the page ever say "asleep", and
  every other case just returns 404, closest in spirit to "no clear page instead of nothing" that
  ADR-0014's UX goal already asks for.
