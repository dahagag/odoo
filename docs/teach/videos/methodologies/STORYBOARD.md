---
format: 1920x1080
duration: 50s
message: "Eight named B2B sales methodologies, one addon concept: Requirements, Checkpoints, Enforcement"
arc: concept-explainer
audience: "Sales reps and managers, R&D, and Odoo implementation consultants"
mode: automation
music: none
---

## Video direction

**Factual basis — load-bearing.** MEDDIC's six Requirements / three Playbook Questions,
Sandler's three Requirements / two Playbook Questions and SPIN's zero Requirements / four
Playbook Questions are `docs/teach/methodologies.md`'s own stated seeded-demo figures. The
other five methodologies (CustomerCentric Selling, Solution Selling, The Challenger Sale,
ValueSelling Framework, Consultative Selling) get no seeded numbers of any kind — only the
conceptual mapping the doc itself states. Do not invent a Requirement count for any of those
five, and do not open a demo record on screen (that is the sibling hero video's job — this
video never leaves the conceptual level).

**Relationship to the hero video.** `sales-methodology-vs-odoo-crm` walks one opportunity
through assignment → qualification → enforcement → Playbook Questions, ending on a live
refusal. This video is the doc's TL;DR: it never opens a record, never shows block-vs-warn
live, and stays at the map level — eight methodologies, three mechanisms, three seeded, five
conceptual. Same palette and type system so the two read as siblings, deliberately different
in scope, length and register (no single hero beat here; even pacing throughout).

**Palette system** (`docs/teach/DESIGN-TOKENS.md`, unchanged from the hero video). `paper-0`
`#F3F4EF` is the ground on every frame; `ink-900` `#1B2430` is the voice, `ink-700` `#3E4A59`
and `ink-500` `#6B7688` beneath it; hairlines are `ink@12%`. `amber` `#B96A22` is the scarce
accent (kicker glyph, one accent moment per frame). Semantic accents are content, not
decoration: `block` `#A23B3B` on `#F3DBDB` for anything the addon can refuse/block, `teal`
`#2E6B60` on `#D9E8E3` for anything it only warns on or has seeded/live today, `violet`
`#5B5285` on `#E5E2F0` for the conceptual/not-yet-configured set (frame 4's five methodologies)
— a fourth hue the hero video never needed, since it never had an "unconfigured" category.

**Type** by role only: Source Serif 4 400 sentence-case for display moments, Karla 400/500 for
body/card text, IBM Plex Mono 500 uppercase for kickers, chips, pills and footlines.

**Motion grammar.** Long-tail decel (`power2`/`power3` class), no bounce, no overshoot. VO-paced:
each frame opens with mono chrome only, then reveals cascade on their own spoken cue. Hard cuts
for enumerations (the three mechanisms in frame 2, the three seeded methodologies in frame 3,
the five conceptual ones in frame 4).

**Rhythm.** No single climax frame — this is a TL;DR, not a narrative arc with a refusal beat.
Frame 1 opens on the roll-call; frame 5 closes on a plain, unhurried resolve with no
button/CTA styling (a doc-embedded explainer, not an ad).

**Framing.** Frame 1: centered wordmark transition (methodology names → `crm.methodology`).
Frame 2: three-across horizontal band (Requirements / Checkpoints / Enforcement). Frame 3:
three-card row (MEDDIC / Sandler / SPIN), teal-accented ("seeded today"). Frame 4: five-row
list, violet-accented ("mapping only"). Frame 5: centered closing statement over a plain
ground, mirroring frame 1's centered composition to bookend the film.

**Captions are off** (Kokoro returns no word-level timings, same as the hero video). **No BGM**
(local MusicGen deps not installed, same as the hero video). **No SFX** — narration-only.

**Negative list.** No floating bokeh, no gradients, no browser chrome, no invented seeded
numbers for the five unconfigured methodologies, no demo record shown on screen.

## Frame 1 — Eight, one (0.0s–~7.7s)

Kicker: "✱ Eight methodologies". Three names roll in and cross-fade in place (MEDDIC → Sandler
→ SPIN → "five more"), then the whole stack collapses/settles into a single centered serif
wordmark: `crm.methodology`. Footline: "One addon, underneath all of them."

## Frame 2 — Three mechanisms (~7.7s–~17.4s)

Kicker: "✱ What every methodology owns". Three equal-weight column cards appear left-to-right
on their own cue: **Requirements** (what has to be known), **Checkpoints** (the moment it's
checked), **Enforcement** (a Block pill and a Warn pill, side by side — the pair the whole
video assumes from here on).

## Frame 3 — Three seeded today (~17.4s–~27.9s)

Kicker: "✱ Seeded in the demo". Three teal-accented cards in a row, each a name + two stat
chips: MEDDIC (6 Requirements · 3 Questions), Sandler (3 Requirements · 2 Questions), SPIN (0
Requirements · 4 Questions, with a small "playbook only, by design" tag distinguishing it from
looking like an oversight).

## Frame 4 — Five more, mapped (~27.9s–~43.3s)

Kicker: "✱ Supported, not yet configured". Five violet-accented rows cascade in top-to-bottom,
each a name + a short mapping fragment (no numbers): CustomerCentric Selling → Requirements,
Solution Selling → Requirements, The Challenger Sale → Playbook Question, ValueSelling
Framework → value-figure Requirement, Consultative Selling → no fixed set implied.

## Frame 5 — Configure it once (~43.3s–~50.5s)

Kicker: "✱ Same mechanism, any methodology". Centered closing line, mirroring frame 1's
composition: "Requirements. Checkpoints. Enforcement." resolving under the line "Configure it
once, and Odoo holds every deal to it." Held still, no exit animation — the film simply ends.
