# Design: Asleep / Wake-Up page (#174)

Live Artifact: https://claude.ai/code/artifact/dce1a0bd-ba7f-48f8-b89f-290252bf44e8

Direction proposed: a single centered card matching the Odoo stock backend theme (brand
`#71639e`, system-font stack, 4px/6px radius, 16px base spacer — pulled from
`addons/web/static/src/scss/primary_variables.scss`), consistent with the onboarding prompt
(#121) and expiry-countdown systray (#137) conventions already established for this addon. A
crescent-moon icon in a tinted brand-color ring, the org's name, a "This trial is taking a nap"
headline, one line of copy re-using the onboarding prompt's existing "idle instances suspend
automatically to save cost" wording, and a single full-width primary "Wake Up" button. Clicking
Wake Up swaps the button into a spinner + "Waking up…" state with a note that it can take a
minute or two — no separate screen, since the real controller re-renders this same page once the
org is active again rather than navigating anywhere.

Awaiting approval via an activated comment thread on the Artifact before writing the real
`hosting_admin` controller/QWeb template (per `docs/agents/design-review.md`).
