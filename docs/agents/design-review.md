# UI/UX design-board review

Before writing view/QWeb/OWL code for a ticket that adds or reshapes a screen, consider a
**design-board pass**: an interactive Claude Design canvas (`/design`) prototyping the screen in
this project's own Odoo theme, so the direction can be agreed before real code exists.

## Judging major vs minor

Neither `/to-tickets` nor `/implement` decides this silently. A ticket is **major** (worth a
design-board pass) when it introduces a new screen, a new flow, or a new interactive widget;
**minor** when it only adds/removes fields on an already-reviewed screen. Whichever a ticket looks
like, ask the user before proceeding — the call is theirs, not a default to assume.

- `/to-tickets` adds a one-line suggestion to a new ticket's body
  (`Consider a design-board pass before implementing (see docs/agents/design-review.md).`) without
  pre-judging major/minor itself — it has less context than implementation time to make that call
  well.
- `/implement` makes the actual call, right after reading the ticket and before writing any
  view-layer code, and asks.

## `/design` vs `/prototype`

Distinct, complementary tools for different questions:

- **`/prototype`**: a quick, often code-level, throwaway sanity check — "does this state
  model/logic feel right." Discarded after use.
- **`/design`**: a kept, Odoo-themed, clickable design-board artifact meant to be pointed at and
  discussed as "here's the direction" — even when the discussion is solo (you + Claude).

Reach for `/design` when the open question is what a screen should look like or how it should
flow; reach for `/prototype` when the open question is whether a piece of logic behaves right.

## Building the board

Follow the `design` skill's own workflow. Matching the app's real Odoo theme tokens is the
default, not optional — Odoo's stock backend theme (brand `#71639e`, system-font stack, `4px`
border-radius, `16px` base spacer) is the baseline for any screen in `custom_addons/` that hasn't
defined its own override; pull exact values from `odoo/addons/web/static/src/scss/` rather than
approximating.

## Keeping the record

A design-board session that reaches an agreed direction is **kept**, not ephemeral:

1. Commit the working `.dc.html`/`canvas.json` files (and any images) under
   `docs/design/<issue-number>-<slug>/`, with a short `README.md` recording the live Artifact URL
   and a one-line note on the direction agreed. This is the exact drift
   [ADR-0007](../adr/0007-self-contained-teach-docs-served-from-static.md) already flagged for a
   "hand-authored Claude Artifact" with no committed source: the committed files are the source of
   truth, the Artifact is the live, clickable view of them.
2. Post the Artifact URL plus that one-line note as a comment on the ticket's issue, so the ticket
   itself carries a visible "what was reviewed and when" trail — the same gist+link pattern
   `docs/agents/issue-tracker.md`'s wayfinder resolution step uses.

A design-board pass still exploring options (no agreed direction yet) doesn't need either step —
commit and comment once a direction is actually settled.
