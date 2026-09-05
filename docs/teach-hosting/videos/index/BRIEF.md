---
workflow: faceless-explainer
flow: automation
storyboard: yes
message: "Your trial has four mechanics worth knowing before you dive in: Seats, Expiry & extension, Invites, Suspend & Wake"
destination: embed
aspect: 1920x1080
language: en
audience: "Prospects and customers evaluating a Trial Org, on first login"
length: 35s
angle: narrative
---

## Intent

A short walkthrough embedded at the top of the generated `index.html` Trial
Onboarding Guide (docs/teach-hosting/index.md, issue #122) — a condensed,
narrated companion to the doc's four sections, for a trial user who wants the
30-second version before reading. It covers exactly the same four mechanics
the doc covers, in the same order: Seats, Org Registration (expiry &
extension), Invites (Open vs. Targeted), and Suspended/Active/Wake. It does
not touch the CRM product itself — that's crm_methodology's separate
teach-doc content, out of scope here (docs/contexts/hosting/CONTEXT.md's
Onboarding Guide entry).

Tone: calm, orientation-not-sales — the same register the first-login prompt
itself uses ("not a product tour"). No hype.

Authored per ADR 0008 (`docs/adr/0008-hyperframes-for-teach-doc-video.md`) as
a live Claude Code session task, per issue #122; re-rendering is the separate
mechanical `docs-build:video` step.

## Notes

- Project directory name is load-bearing: `docs-build:video` renders
  `docs/teach-hosting/videos/<name>/` to `<name>.mp4` under
  `custom_addons/hosting/static/docs/`, and that stem must equal the teach
  doc's own stem (`index`) so `docs-build:doc`'s sibling-video lookup finds
  it. Do not rename this directory.
- Palette: bound to the same purple/violet the actual `hosting` UI uses in
  the doc's own embedded screenshots (Odoo's default brand purple,
  `#714B67`), plus an amber accent for the Expiry & extension beat (matching
  the first-login prompt's own amber clock icon) — so the video reads as
  part of the same product family the screenshots show, not a generic
  explainer palette.
- Four scenes, one per mechanic, same order the doc uses: Seats -> Org
  Registration / Expiry & extension -> Invites -> Suspended & Wake. No
  invented data or product screenshots inside the video itself (those are
  Puppeteer captures embedded directly in the doc, not composited into the
  video) — this stays at the conceptual/typographic level, matching the
  precedent set by `docs/teach/videos/methodologies/`.
- Narration is local Kokoro (offline, no API key), voice `am_michael` — same
  voice already used for both existing teach-doc videos, for a consistent
  narrator identity across every teach doc. No BGM (local MusicGen deps are
  not installed) and no captions (Kokoro returns no word-level timings) —
  same reasoning as the existing videos.
