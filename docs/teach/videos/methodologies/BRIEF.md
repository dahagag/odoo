---
workflow: faceless-explainer
flow: automation
storyboard: yes
message: "Eight named B2B sales methodologies, one addon concept: Requirements, Checkpoints, Enforcement"
destination: embed
aspect: 1920x1080
language: en
audience: "Sales reps and managers, R&D, and Odoo implementation consultants"
length: 50s
angle: narrative
---

## Intent

A TL;DR video embedded at the top of the generated `methodologies.html` teach
page — a condensed narrated summary for a stakeholder who won't read all eight
method write-ups. It does not walk one opportunity through a workflow (that is
the sibling hero video's job); it takes the doc's shape — eight named
methodologies, one addon underneath — and compresses it: the three mechanisms
every methodology is expressed through (Requirements, Checkpoints,
Enforcement), the three that are seeded and demonstrable today (MEDDIC,
Sandler, SPIN), and the five that are supported by architecture but not yet
configured (CustomerCentric Selling, Solution Selling, The Challenger Sale,
ValueSelling Framework, Consultative Selling).

Tone: calm, precise, consultant-to-consultant — the same register as the hero
video. No hype, no "revolutionary" language. This is a TL;DR, not a trailer.

Authored per ADR 0008 (`docs/adr/0008-hyperframes-for-teach-doc-video.md`) as a
live Claude Code session task, per issue #73 (part of #70); re-rendering is the
separate mechanical `docs-build:video` step.

## Notes

- Project directory name is load-bearing: `docs-build:video` renders
  `docs/teach/videos/<name>/` to `<name>.mp4`, and that stem must equal the
  teach doc's own stem (`methodologies`) so `docs-build:doc`'s sibling-video
  lookup finds it. Do not rename this directory.
- Bind the palette to `docs/teach/DESIGN-TOKENS.md` (ink / paper / amber / teal
  / violet / block) and its three fonts (Source Serif 4 display, Karla body,
  IBM Plex Mono labels) — same as the hero video, so both read as part of the
  same page family.
- Deliberately shorter and narrower than the hero video (100s, one narrated
  opportunity walkthrough): this video never opens a record, never shows a
  refusal, never demonstrates block-vs-warn live. It stays at the conceptual
  map level the doc itself uses for the five unconfigured methodologies.
- Content accuracy: only MEDDIC, Sandler, and SPIN's Requirement/Playbook
  counts are stated as concrete seeded numbers — sourced from
  `docs/teach/methodologies.md`'s own "Seeded in the demo as" lines, which in
  turn trace to `custom_addons/crm_methodology/data/crm_methodology_data.xml`
  and `demo/crm_methodology_demo.xml`. The other five methodologies are
  described only at the mapping level methodologies.md itself uses — no
  invented Requirement counts or seeded data for them.
- Narration is local Kokoro (offline, no API key), voice `am_michael` — same
  voice as the hero video, per ADR 0008. No BGM (local MusicGen deps are not
  installed) and no captions (Kokoro returns no word-level timings) — same
  reasoning as the hero video.
