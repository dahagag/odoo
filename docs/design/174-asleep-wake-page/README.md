# Design: Asleep / Wake-Up page (#174)

Live Artifact: https://claude.ai/code/artifact/dce1a0bd-ba7f-48f8-b89f-290252bf44e8

Direction proposed: a single centered card matching the Odoo stock backend theme (brand
`#71639e`, success `#28a745`, system-font stack, 4px/6px radius, 16px base spacer — pulled from
`addons/web/static/src/scss/primary_variables.scss`), consistent with the onboarding prompt
(#121) and expiry-countdown systray (#137) conventions already established for this addon. One
card, three phases, no page navigation between them (the real controller re-renders the same page
as the org's state actually changes):

1. **Idle ("asleep")** — crescent-moon icon in a tinted brand-color ring, the org's name, "This
   trial is taking a nap", one line of copy re-using the onboarding prompt's existing "idle
   instances suspend automatically to save cost" wording, and a full-width primary "Wake Up"
   button.
2. **Waking** — the button is replaced by a determinate progress bar ("Waking up… NN%") standing
   in for polling the real Wake Up job's status, with a note that it can take a minute or two.
   Headline/copy switch to "Waking up your trial" for this phase.
3. **Awake** — the icon ring switches to a green check on a tinted success background, headline
   becomes "You're all set!", and the button is replaced by a green "Go to your instance →" link
   pointing at the org's own URL.

A "Restart demo" link (awake phase only) replays the sequence for review purposes — cut once the
real controller replaces the simulated progress timer with an actual status poll.

Awaiting approval via an activated comment thread on the Artifact before writing the real
`hosting_admin` controller/QWeb template (per `docs/agents/design-review.md`).
