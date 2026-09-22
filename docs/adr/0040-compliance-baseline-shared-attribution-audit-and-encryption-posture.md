---
status: accepted
---

# Compliance baseline: shared attribution record, single-role auditing, encryption posture, and break-glass

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)), settling architecture decisions embedded in
[#205](https://github.com/dahagag/odoo/issues/205) (compliance baseline) that
[#199](https://github.com/dahagag/odoo/issues/199) (staff administration app) also depends on,
decided on [#219](https://github.com/dahagag/odoo/issues/219).

## Problem

#205 needs a per-org staff access audit trail so "who read my data" is answerable. #199 needs the
same fact — every state-changing staff action attributed to who performed it, when, against which
org — to satisfy its own acceptance criteria (action attribution, one staff role made defensible
by auditing rather than split). Both tickets described the same record from two different angles
and left "agree the shape across both tickets" as an open item. Left unresolved, the two
implementations would drift into two competing attribution stores for the same fact, which is the
exact "two systems of record, drifting the moment one write path is missed" failure the
administration stack was built to avoid elsewhere (see
[ADR-0022](0022-live-aws-pulled-audit-view.md)'s reasoning against a second execution-history
log).

Three other decisions from #205 are architectural rather than merely operational and belong in the
same settled record: keeping the single all-permissions staff role rather than splitting it,
directional intent on encryption-at-rest key management, and where break-glass access sits
relative to ordinary access.

## Decision

### One attribution record, shared by #205 and #199

There is exactly one staff-action attribution record, owned by the administration stack, written
by every state-changing staff action regardless of which surface performed it. #199's staff app
and #205's access audit trail are two consumers of the same record, not two producers of two
records. Shape:

| Field | Meaning |
| --- | --- |
| `actor` | The authenticated staff identity that performed the action (#199's authentication, not network reachability — Tailscale reachability is not authorization). |
| `action` | What was done, named the same as the staff app's own operation (e.g. `suspend`, `wake`, `destroy`, `view_org_record`). |
| `org_id` | The org the action targeted. The record's own partition key for per-org queries. |
| `timestamp` | When. |
| `break_glass` | Boolean. See below — never a separate table or code path. |

Read access — the audit trail #205's client-facing question ("is my access logged") answers, and
#199's own "see this org's access history" user story — is a query over this one record filtered
by `org_id`, returning nothing belonging to another org. There is no second, Odoo-side or
stack-side, duplicate log to keep in sync.

This mirrors ADR-0022/[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md)'s existing
pattern for the *lifecycle* audit trail (pulled live from Step Functions rather than duplicated):
the *staff-access* audit trail gets the same discipline, a single source, but here the source is a
record the stack itself writes (there is no external system of record for "which staff member
clicked what" the way Step Functions is one for "what did this execution do"), so the shared
discipline is "one writer, one store" rather than "no writer, pull live."

### The single staff role stays, made defensible by auditing

#199 already decided one role with all permissions, structured so a second role can be introduced
later without rewriting authorization checks. #205 asked the same question from the compliance
side — is an undifferentiated staff role a problem when we host other organizations' data — and
the answer is the same: **the role stays singular; splitting it is out of scope for both
tickets.** What #205 adds is the reason this is defensible rather than merely convenient: every
action that role can take is attributed in the shared record above, so "who could touch my data"
has a fixed answer (anyone with the one role) and "who did touch my data" has an audited one (the
record, queryable per org). Accountability substitutes for narrower permissions; the epic revisits
splitting the role only if a second role's *product* need appears (per #199's own out-of-scope
framing), not because compliance demanded it.

### Encryption at rest: encrypted today, per-region customer-managed keys deferred

Every place org data lands — the org's own EBS volume and database, EBS snapshots retained after
destroy, the record store, and log groups — is encrypted at rest today, using the account's
existing AWS-managed keys. This ticket's deliverable is the enumeration and verification that
nothing was missed, not a change in key management.

**Direction, not yet built:** per-region customer-managed keys (CMKs) are the agreed next step,
but they are region-coupled by construction — a CMK's replication and access policy only make
sense once an org can choose the region its data lives in — and that capability is itself deferred
to the multi-region milestone (per #193's stated scope). Building per-region CMKs before
multi-region exists would mean guessing at a key topology the actual milestone might invalidate.
Stated now so a future region decision is made with this exception already on the table, rather
than discovered during a deal (per #205's own framing).

### Break-glass: friction-bearing, logged in the same trail, never a separate path

Emergency access to an org outside the ordinary staff flow (break-glass) is:

- **Deliberately friction-bearing** — it must cost more effort than ordinary access, so it is never
  reached for by convenience.
- **Recorded in the exact same attribution record above**, with `break_glass: true` and the same
  required fields (actor, action, org, timestamp) as any other action. There is no separate
  unaudited emergency path, and no separate audited-but-different-shape one either — the same
  query that answers "what did staff do to my org" surfaces break-glass use without a second query
  or a second store to remember to check.

This makes the compliance property ("emergency access must be possible; unlogged emergency access
must not be") a consequence of the shared record's design rather than a second mechanism that has
to be kept consistent with the first.

## Consequences

- #199's implementation writes to and reads from the one attribution record described here; it
  does not invent its own action log.
- #205's implementation queries the same record for its per-org access audit trail and for
  break-glass reporting; it does not add a parallel table.
- Whichever ticket lands first, this ADR documents the record's ownership (the administration
  stack) and shape so the second ticket implements against an already-settled contract instead of
  re-deriving it or negotiating it mid-implementation.
- The single-staff-role decision is not re-litigated by either ticket; a future second role is a
  product decision tracked separately from compliance.
- Per-region CMKs are explicitly out of scope here and tracked against the multi-region milestone,
  not silently dropped.
