# Two trial invitation paths, both guarded by a rep-provided expected domain

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
