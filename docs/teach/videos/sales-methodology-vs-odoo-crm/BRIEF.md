---
workflow: faceless-explainer
flow: automation
storyboard: yes
message: "A named sales methodology becomes enforcement Odoo actually applies — without touching your pipeline"
destination: embed
aspect: 1920x1080
language: en
audience: "Sales reps and managers, R&D, and Odoo implementation consultants"
length: 100s
angle: narrative
---

## Intent

The hero walkthrough video embedded at the top of the generated
`sales-methodology-vs-odoo-crm.html` teach page — a watchable alternative to
reading the full doc for a stakeholder who won't read 12 sections. It traces the
doc's §3–§6 narrative arc: why the addon exists (OOTB Odoo 19 CRM has no concept
of a named B2B sales methodology at all), the five terms you need, one
opportunity's trip through assignment → qualification → enforcement → Playbook
Questions, and the reassurance that closes it — the kanban pipeline is
completely untouched.

Tone: calm, precise, consultant-to-consultant. This is a teach doc's hero, not
a product ad — no hype, no superlatives, no "revolutionary". The single beat
that should land hardest is the refusal: a rep clicks *Create Quotation* and
Odoo says no, with a clear reason.

Authored per ADR 0008 (`docs/adr/0008-hyperframes-for-teach-doc-video.md`) as a
live Claude Code session task; re-rendering is the separate mechanical
`docs-build:video` step.

## Notes

- Project directory name is load-bearing: `docs-build:video` renders
  `docs/teach/videos/<name>/` to `<name>.mp4`, and that stem must equal the
  teach doc's own stem so `docs-build:doc`'s sibling-video lookup finds it.
  Do not rename this directory.
- Bind the palette to `docs/teach/DESIGN-TOKENS.md` (ink / paper / amber / teal
  / violet / block) and its three fonts (Source Serif 4 display, Karla body,
  IBM Plex Mono labels) so the video reads as part of the page it is embedded
  in. Treatment, layout and motion are otherwise free rein (user's call).
- Deliberately scoped shorter and narrower than the doc: §7's model-by-model
  appendix, §9's demo personas, §10's market comparison and §11's non-goals are
  all out — they are reading material, not watching material.
- Distinct in scope and length from the sibling TL;DR video for
  `methodologies.md` (issue #73), which summarizes the eight methodologies.
- Keep the §9 demo-instance credentials off screen entirely.
- Narration is local Kokoro (offline, no API key) per ADR 0008. No BGM: local
  MusicGen deps are not installed, and a narration-only track suits a
  page-embedded explainer. Captions are absent: Kokoro returns no word-level
  timings, so `captions.mjs` skips cleanly. Adding them would need a local
  `whisper-cpp` build — tracked separately, not in this ticket.
- **Every value on screen is the addon's own seeded data, not an illustration.**
  MEDDIC's six Requirements and three Playbook Questions come from
  `data/crm_methodology_data.xml`; the opportunity followed through frames 4-9 is
  *Nimbus Robotics - Line 2 Expansion* from `demo/crm_methodology_demo.xml`
  (stage Qualified, only `meddic_champion` filled, hence 1 of 6). A stakeholder
  can sign into the demo instance and reproduce every beat.
- The film runs **two gates**, in that order, because that is what the seed does:
  MEDDIC's Block Requirements are both at **Marked Won**, and nothing blocks at
  quotation creation. So frame 6 shows the quotation *warning and proceeding*,
  and frame 8 shows Marked Won *refused* on Economic Buyer. Showing both
  outcomes is what teaches Block-vs-Warn; an earlier cut asserted a quotation
  refusal the addon does not perform, which code review caught.
