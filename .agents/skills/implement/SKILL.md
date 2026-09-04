---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Before writing any view-layer code (Odoo views/QWeb/OWL), judge whether the ticket introduces a
new screen/flow/widget ("major") or only tweaks an already-reviewed screen ("minor"), and ask the
user whether to run a design-board pass first (`/design`, per `docs/agents/design-review.md`) —
never decide silently either way.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work. Apply fixes until both axes (Standards and Spec)
are settled — no open findings left dangling.

Commit your work to the current branch.

If this work is a ticket from a real issue tracker: open the PR only once the reviewed changes
are final — base branch per the stacked-PR convention in `docs/agents/issue-tracker.md` (the
ticket's blocker's branch, or the default branch if unblocked or once all its blockers are
merged). Then spawn a **separate** agent (fresh context, no memory of the implementation work) to
evaluate the finalized diff against the ticket's own acceptance criteria and check off (`- [x]`)
each box the diff actually satisfies, via the tracker's edit mechanism (`gh issue edit
--body-file` with the updated checklist, on GitHub). Leave any unmet criterion unchecked and say
why in a comment on the issue, rather than checking it optimistically. Running this as a separate
agent after the PR exists — grading the actual finalized diff, not the implementer's own account
of what it did — is what keeps the acceptance check honest.
