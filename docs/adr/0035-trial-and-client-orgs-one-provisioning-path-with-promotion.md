# Trial Org and Client Org are distinct concepts sharing one provisioning path

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)), alongside
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md), which makes the administration
stack the record of truth for both.

**Trial Org** and **Client Org** are two distinct concepts, not one record with a boolean.

- A **Trial Org** is the low-cost, ephemeral evaluation offering issued to a lead so they and
  their colleagues evaluate our addons. It is anchored to a CRM Opportunity, it is
  seat-capped and domain-guarded, and **Auto-Destroy is its default outcome** — the thing that
  happens unless something interrupts it.
- A **Client Org** is a stable hosted instance for a paying client. It is anchored to a won deal
  rather than an Opportunity, and it has no expiry clock and no auto-destroy.
- **Promotion** is a Trial Org becoming a Client Org *without moving its data*. It is the one
  thing that pre-empts Auto-Destroy, which is why Auto-Destroy can no longer be described as
  unconditional: expiry is still the date, Auto-Destroy is still the action, but Promotion is the
  event that means the action never fires.

They are distinct because almost everything around them differs — what they are anchored to
(Opportunity vs won deal), whether they expire, whether they are seat-capped and domain-guarded,
and who may act on them. Modelling them as one record with a mode flag would put every one of
those rules behind a conditional, which is the same objection ADR-0018 raised against a
mode-gated addon and [ADR-0003](0003-standardize-local-development-on-containers.md) raised
against one Dockerfile branching on its environment.

**But both cold-provision through the same per-instance path**: per-org EC2, per-org database,
per-org DNS record, per-org log group, provisioned by the same OpenTofu module
([ADR-0014](0014-per-org-ec2-with-suspend-wake-for-trials.md),
[ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md)). One provisioning path, two
concepts on top of it.

## Why not a shared multi-database tier for trials

The obvious cost saving is to run evaluations as databases on one shared multi-tenant Odoo
server (Odoo's native multi-database routing) and reserve dedicated instances for paying
clients. ADR-0014 already rejected that on isolation and suspend/wake grounds. Two further
reasons rule it out now that Client Orgs and Promotion exist:

- **Per-org audit logs become impossible.** A shared server writes one interleaved application
  log for every org on it. There is no per-org log group to subscribe to, no per-org log stream
  to scope a viewer to, and no way to hand a prospect or a compliance reviewer an answer about
  who touched *their* data — which is the whole point of the log plane
  ([ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md)'s narrow instance
  profile, and the compliance posture the epic commits to). Retro-fitting per-org separation onto
  shared logging is not a filtering problem; the isolation was never there to filter.
- **Promotion becomes a cross-architecture migration on the happy path of a won deal.** If
  trials live on shared infrastructure and clients live on dedicated instances, then *winning*
  means a database extraction, a filestore move, a DNS cutover, and a downtime window — executed
  at the single moment in the relationship where we can least afford to look unreliable. A shared
  tier makes the success case the expensive case. Sharing one provisioning path means Promotion
  can be a change of record and of policy, not a change of architecture.

We accept the cost this implies, and it is a known one: cold-provisioning every Trial Org means
issuing one takes minutes of OpenTofu apply, so trials are issued ahead of a meeting rather than
during it. Suspend/wake (ADR-0014) is what keeps the running cost of an idle evaluation near
zero, and that mechanism is what a shared tier would otherwise have been buying.

## Open design items

Two things are deliberately unsettled and are named here so they are visibly open rather than
silently missing:

- **Promotion mechanics.** What actually changes when a Trial Org is promoted — the record
  transition, whether the URL and DNS label are retained, what happens to seat caps and the
  domain guard, who may invoke it, and what the retained snapshot policy becomes — is deferred
  to a `/wayfinder` design pass. One constraint is already fixed and binds that pass: **Org
  Region is immutable**, so Promotion stays in-region. It moves no data between regions, ever.
- **Per-org region selection.** Deferred with its requirement set captured in
  [#207](https://github.com/dahagag/odoo/issues/207), not built. Every org today lands in the
  single region the Hosting Account's foundation defines, and `Org Region` exists as vocabulary
  and as an immutable fact on the record so that the deferred design has something to attach to.

Child specs downstream of Promotion were written before that design pass, and are expected to
need revision once it lands.
