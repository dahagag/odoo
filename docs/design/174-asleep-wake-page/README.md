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
2. **Waking** — the button is replaced by a determinate progress bar with a user-friendly,
   per-step message rather than a bare "Waking up… NN%": four milestones ("Preparing to wake
   your trial…" → "Starting your trial's server…" → "Getting your workspace ready…" → "Almost
   there…"), each with a one-line note on what's actually happening. The milestones and their
   rough percentage bands stand in for `AwsProvisioner.get_audit_trail()`'s existing per-step
   Step Functions execution history (ADR-0022) — a real Wake Up has no smooth, continuously
   reported percentage to poll, only discrete state transitions, so the progress bar should
   advance step-by-step against that real data rather than a fake linear timer. Headline/copy
   switch to "Waking up your trial" for the whole phase; the step message is the specific one.
3. **Awake** — the icon ring switches to a green check on a tinted success background, headline
   becomes "You're all set!", and the button is replaced by a green "Go to your instance →" link
   pointing at the org's own URL.

A "Restart demo" link (awake phase only) replays the sequence for review purposes — cut once the
real controller replaces the simulated progress timer with an actual status poll. A top-right
theme toggle (also review-only, not part of the shipped page — Odoo picks light/dark globally)
switches the card and page background to an approximate reading of Odoo's dark webclient palette;
brand/success hues stay the same, only surface/text tokens shift.

Approved via an activated comment thread on the Artifact (2026-09-07T17:26). The shipped
`hosting_admin` controller (`controllers/asleep.py`) implements the idle/waking/awake phases and
the brand/success tokens above; it uses a plain indeterminate progress animation for "waking"
rather than this mockup's fabricated multi-step milestone timer, since the milestones stood in
for a future `get_audit_trail()`-backed status endpoint this ticket didn't build — the real page
polls a small JSON status endpoint instead. The dark-mode toggle was review-only and isn't part
of the shipped page (Odoo picks light/dark globally).
