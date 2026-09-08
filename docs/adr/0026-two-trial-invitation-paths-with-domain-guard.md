---
status: amended by ADR-0037 (paths move to the client app — #200; the domain guard is unchanged)
---

# Two trial invitation paths, both guarded by a rep-provided expected domain

**Amended:** both invitation paths move to the public **client app** — one of the administration
stack's two surfaces — because Odoo loses its public listener. See
[ADR-0037](0037-odoo-has-no-public-ingress.md) and
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md), under epic
[#193](https://github.com/dahagag/odoo/issues/193); built in
[#200](https://github.com/dahagag/odoo/issues/200).

**Every rule below is unchanged.** A Targeted Invite still goes to a specific known email; an
Open Invite Link is still shared when the rep knows the domain but not the person; the expected
domain is still fixed by the rep at issuance; and the first login through an Open Invite Link
still has to confirm a company email matching that domain, with a mismatch rejected rather than
silently accepted. Magic-link auth on the client app is the mechanism that carries the
confirmation step, and it honours the same guard.

The one thing to carry forward carefully: the deferred invite proof-of-receipt gap
([ADR-0032](0032-defer-invite-proof-of-receipt-guard.md), issues
[#161](https://github.com/dahagag/odoo/issues/161)/[#110](https://github.com/dahagag/odoo/issues/110))
was deferred "until the org-facing login layer's design begins". That layer is the client app, so
#200 is where that gap comes due rather than being inherited silently.

Trial Orgs can be started two ways: a **Targeted Invite** to a specific known email, or an
**Open Invite Link** shared when the sales rep knows the prospect's domain but not yet who
specifically will join. In both cases the domain is fixed by the rep at issuance — this is not a
change to how domain-lock already worked (`Trial Org`, `docs/contexts/hosting/CONTEXT.md`); an
Open Invite Link doesn't defer *that* decision, it just defers which specific person confirms it.

We considered letting the first person to complete login through an Open Invite Link freely
supply whatever email they like and have that silently become the locked domain. Rejected: an
Open Invite Link, unlike a Targeted Invite, has no built-in guarantee about who clicks it first —
it can leak or get forwarded — so an unguarded first-login would let a stranger's domain hijack a
trial meant for a specific company, with no signal to anyone that it happened. We also considered
requiring a factory1 admin to approve the bound domain before the first login completes, which
would close the gap completely but adds a manual step and a wait to what's supposed to be a fast,
frictionless trial start, for a risk the simpler guard already addresses.

The chosen guard: the rep still names the expected domain when issuing an Open Invite Link (the
same domain field a Targeted Invite already required, just without a specific email attached to
it), and the first login's supplied company email is checked against it — a mismatch is rejected
rather than silently accepted. This keeps the same safety property the Targeted Invite path always
had, while still supporting "I know the company, not yet the specific person."
