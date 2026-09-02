---
format: 1920x1080
duration: 100s
message: "A named sales methodology becomes enforcement Odoo actually applies — without touching your pipeline"
arc: concept-explainer with process
audience: "Sales reps and managers, R&D, and Odoo implementation consultants"
mode: collaborative
music: none
---

## Video direction

**Factual basis — load-bearing.** Every Requirement, checkpoint, enforcement level, playbook
question, client, opportunity and completion figure on screen is the addon's **own seeded
data**, not an illustration: MEDDIC's six Requirements and three Playbook Questions from
`custom_addons/crm_methodology/data/crm_methodology_data.xml`, and the opportunity *Nimbus
Robotics - Line 2 Expansion* from `demo/crm_methodology_demo.xml` — stage Qualified, with only
`meddic_champion` filled, hence 1 of 6. A stakeholder can sign into the demo instance and
reproduce every beat in this film. **Do not invent a value here.** In particular: MEDDIC's two
Block Requirements (Economic Buyer, Champion) are both at the **Marked Won** checkpoint, and no
seeded Requirement in any methodology blocks at quotation creation — which is why frame 6 warns
and frame 8 refuses, and not the other way round.

**Palette system** (from `frame.md`, never invented). `cream` `#F3F4EF` is the ground on every
frame; `ink` `#1B2430` is the voice, with `ink-700` / `ink-500` beneath it; `tile` /
`tile-strong` are the half-step card surfaces; hairlines are `ink@12%` (cards) / `ink@20%`
(rules and chips). `coral` `#B96A22` is the scarce voltage. The **semantic accents** are content
and are the one place a second hue is allowed: `block` `#A23B3B` on `#F3DBDB` = refusal / hard
blocker, `teal` `#2E6B60` on `#D9E8E3` = met / warn-level. Warm `navy` is unused — this video
has no code surface.

**The accent ration.** Coral appears **at most once per frame** as a real accent moment. Two
things do not count against it: the mono kicker's `✱` (chrome, on every frame) and a semantic
accent, which is carried by the content's own meaning.

**Type** by role only: Source Serif 4 400 sentence-case for every display moment (negative
tracked), Karla 400/500 for body and card text, IBM Plex Mono 500 uppercase for kickers, chips,
pills, labels and footlines. No uppercase serif, no sans headline, no serif label.

**Motion grammar and reveal model.** Long-tail decel settles — `power3` class, `expo.out` on a
fast arrival. No bouncy, no overshoot. Every frame is **VO-paced**: at t=0 only the mono chrome
and whatever the narration is saying then; each further piece reveals **on its own spoken cue**,
spread across the back half. Nothing front-loads. Hard cuts are the seam for enumerations.

**Rhythm — the held frames.** **Frame 8 holds dead still** after "Refused." lands — no jitter,
no drift; the stillness against the preceding motion is what makes the refusal land, and it is
the film's climax. **Frame 9 locks** after its single zoom-out and never moves the camera again.
**Frame 2** rests on the returned `MEDDIC` slot before the thesis builds. Elsewhere a settled
frame ends on a plain still hold.

**The two-gate spine.** Frames 6 and 8 are a deliberate matched pair on the same locked stage,
with the same cursor and the same button geometry: the quotation attempt **proceeds** with teal
warnings, and the Won attempt is **refused** in block red. That contrast is how the film teaches
Block-vs-Warn — by showing both outcomes, never by asserting the distinction. Keep them visually
parallel so the only thing that changes is the outcome.

**Framing.** Frames 1–2 are differentiated by scale and density rather than anchor: frame 1 is a
single near-full-bleed word, frame 2 a mid-scale line-plus-slot over a low rail. Then asymmetric
60/40 (3), two-station split (4), asymmetric 40/60 (5), left-anchored stack (6 and 8, the
matched pair), triptych (7), full-width strip (9).

**Captions are off** — the local Kokoro pass returned no word-level timings, so `captions.mjs`
skipped cleanly. The bottom band is not reserved, but bottom chrome stays inside the `slide-pad`
safe area: no load-bearing content below ~0.90 × height.

**No SFX.** Narration-only, by brief. Do not add an impact on the refusal or a tick on the
count-up — a doc-embedded teach video plays in a browser tab and bare narration is the register.

**Negative list.** No floating bokeh, no purple-blue "AI" gradients, no generic decorative
shapes standing in for a designed idea. No browser chrome, nav bars, footers or scrollbars —
frames 6, 8 and 9 reconstruct just enough Odoo surface to be legible, because the topic *is*
that surface. No pure `#000` / `#fff`, no cool grays. Both motion failure modes are banned:
**slideshow** (everything dumped in the first 25%, then frozen) and **screensaver** (elements
floating independently, lazy breathing, a slow back-half pan or push).

## Frame 1 — Never heard of it

- scene: "MEDDIC" sits alone on cream; three flat denials hard-cut in beneath it, one at a time
- voiceover: "Your team runs MEDDIC. Your CRM has never heard of it. No field. No stage. Nowhere to put it."
- duration: 6.912s
- transition_in: cut
- status: animated
- src: compositions/frames/01-never-heard-of-it.html
- type: hook
- persuasion: Pain validation + Common-belief vs reality
- beat: recognition + surprise
- blueprint: kinetic-type-beats (Adapt)
- focal: the word MEDDIC
- roles: MEDDIC = foreground subject · cream ground = background · kicker, footline, the three denials = supporting
- sfx: none

narrativeRole: Opens the gap between what the team says it does and what the tool knows, using the audience's own word (MEDDIC) rather than any addon vocabulary.
keyMessage: The methodology your team runs exists nowhere in stock Odoo CRM.

Scene 1 (0.0–0.6s): cream ground; mono chrome only — kicker top-left, provenance footline
bottom. Nothing else. Left-anchored stack.
Scene 2 (0.6–2.1s): "MEDDIC" arrives oversized (~1.12×) and **scales down to home** on a
long-tail settle, filling ~55% of the frame. The only content present.
Scene 3 (2.1–3.8s): on "has never heard of it", a coral **strike-through draws left→right**
across the word (`css-marker-patterns`) — the frame's one accent moment.
Scene 4 (3.8–6.4s): the three denials **hard-cut in, one per spoken cue** (~3.9s / ~4.7s /
~5.4s, `discrete-text-sequence`). Flat instant swaps, no fade.
Scene 5 (6.4–6.912s): **held still**.

## Frame 2 — So name it

- scene: A fixed line reads "Methodology: ___" and the slot hard-cuts through MEDDIC, Sandler, SPIN, "your own", then the thesis line lands under it
- voiceover: "So name it. One record: MEDDIC, Sandler, SPIN — or your own. Attach it to a client, and Odoo starts holding the deal to it."
- duration: 8.491s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-so-name-it.html
- type: product_intro
- persuasion: Concretization + Distillation
- beat: clarity + orientation
- blueprint: kinetic-type-beats (Reproduce — sub-shape A, fixed-line token swap)
- focal: the swap slot
- roles: the fixed line + slot = foreground subject · cream ground = background · inventory rail, hairline, thesis line = supporting
- sfx: none

narrativeRole: Names the protagonist — a Sales Methodology as a first-class record — and lands the video's value claim in beat 2, before any mechanism.
keyMessage: A methodology is one named record you attach to a client, and attaching it is what starts enforcement.

Scene 1 (0.0–1.0s): kicker settles. The fixed line "Methodology:" flashes in with its slot
**empty** over a hairline. The slot is the show.
Scene 2 (1.0–4.6s): **in-place token cycle**, one hard cut per spoken option — MEDDIC → Sandler
→ SPIN → "Your own" (`discrete-text-sequence`). Slot text in coral, the frame's one accent
moment; the inventory rail steps its dim state in lockstep.
Scene 3 (4.6–5.6s): the slot cuts back to **MEDDIC** and rests — the one the rest of the film
follows. A deliberate held beat.
Scene 4 (5.6–8.0s): the hairline draws left→right (`scaleX` from a left origin), then the thesis
line reveals **per-word** (`dynamic-content-sequencing`).
Scene 5 (8.0–8.491s): **held still**.

## Frame 3 — What a methodology owns

- scene: The methodology card holds left while Requirement rows cascade in, each carrying a checkpoint chip and a Block or Warn pill; a Playbook Questions card assembles last
- voiceover: "A methodology owns two things. Requirements — a qualification field, the moment it's checked, and what happens if it's missing: block the deal, or just warn. And Playbook Questions, tied to an activity."
- duration: 13.76s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-what-it-owns.html
- type: feature_showcase
- persuasion: Frame-then-fill + Progressive disclosure
- beat: comprehension
- blueprint: grid-card-assemble (Adapt)
- focal: the Requirements card
- roles: Requirements card = foreground subject · cream ground = background · Playbook Questions card, checkpoint chips, enforcement pills, footline = supporting
- sfx: none

narrativeRole: Installs the four terms the rest of the video leans on (Requirement, Checkpoint, Enforcement, Playbook Question) as one visible anatomy, so no later frame has to stop and define anything.
keyMessage: A Requirement is a field plus a moment plus a consequence; Block and Warn are the two consequences.

**The six rows are MEDDIC's seeded Requirements, verbatim:** Metrics (Continuous/Warn) · Economic
Buyer (**Won/Block**) · Decision Criteria (Quotation/Warn) · Decision Process (Quotation/Warn) ·
Identify Pain (Continuous/Warn) · Champion (Won/Block). The three questions are the seeded MEDDIC
Playbook Questions, verbatim, tied to the **Call** activity type. Never alter these to suit a beat.

Adapt: keep the staggered top-to-bottom cascade into resolved slots as the signature. What
changes is **what** cascades — the narration names a Requirement's three *columns*, not its six
rows, so the same stage takes **three cascade passes** (field names, then checkpoint chips, then
enforcement pills). That is the frame's teaching: a field, a moment, a consequence.

Scene 1 (0.0–2.0s): kicker settles; the Requirements card frame, mono head and serif title
reveal — the card is **empty**. Asymmetric 60/40; the Playbook card is not present yet.
Scene 2 (2.0–4.2s): on "a qualification field", the six field names **cascade top-to-bottom**
into their slots (`center-outward-expansion`, group stagger capped ≤0.5s).
Scene 3 (4.2–5.6s): on "the moment it's checked", the six checkpoint chips arrive in the **same
order** — second pass, same stage.
Scene 4 (5.6–9.6s): on "block the deal", the two `block`-red **Block** pills cascade in; on "or
just warn", the four `teal` **Warn** pills follow.
Scene 5 (9.6–12.6s): on "And Playbook Questions", the right card grows in and its three question
rows cascade; the "Tied to activity · Call" footline lands last.
Scene 6 (12.6–13.76s): the full anatomy resolved; **held still**.

## Frame 4 — Inherited, not chosen

- scene: First station of one long horizontal canvas — a client card carrying its default methodology, and the opportunity card beside it already stamped with the same name
- voiceover: "Watch one opportunity. The client carries the methodology by default, so every new opportunity inherits it on creation — inherited, not chosen. A rep can still change it."
- duration: 12.267s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-inherited-not-chosen.html
- type: feature_showcase
- persuasion: Causal chain (A to B)
- beat: momentum
- blueprint: spatial-pan-stations (Adapt)
- focal: the inheritance — the methodology value arriving on the opportunity card
- roles: the two station cards = foreground subject · cream ground = background · connector, "On create" label, note line = supporting
- sfx: none

narrativeRole: Starts the process spine — one opportunity's trip — and establishes the horizontal station canvas frames 5 to 8 continue travelling along.
keyMessage: Assignment is automatic and client-driven, not a per-deal decision, and it is not locked afterward.

**Seeded values:** the client is *Nimbus Robotics* (default methodology MEDDIC) and the
opportunity is *Line 2 Expansion* — both from `crm_methodology_demo.xml`. Nimbus has three other
seeded opportunities; this is the one the film follows because its properties leave Economic
Buyer empty, which is what makes frame 8's refusal real.

Adapt: the blueprint's signature **lateral pan between pre-placed stations** is kept and carried
inside this frame — the two stations are the client and the opportunity, and the pan travels the
connector between them. Both exist in world space from t=0; only the camera moves.

Scene 1 (0.0–1.6s): kicker settles. Camera opens **framed on the left station** — the client
card fills ~55% of frame, its serif title revealing. The world extends off-frame right.
Scene 2 (1.6–4.6s): on "carries the methodology by default", the client's "Default methodology /
MEDDIC" row reveals, the value in coral — the frame's one accent moment. Camera holds.
Scene 3 (4.6–7.6s): **the signature pan** — the camera travels right (`viewport-change`), the
connector hairline drawing as it goes, and centers the opportunity station; its serif title
reveals on arrival.
Scene 4 (7.6–9.2s): on "inherited, not chosen", the opportunity's Methodology row lands
**already reading MEDDIC** — the inheritance is the beat, not a copy animation.
Scene 5 (9.2–11.6s): camera eases out to the **settled two-station wide** while the note line
reveals per-word beneath.
Scene 6 (11.6–12.267s): **held still** on the wide.

## Frame 5 — The tab that already knows

- scene: The Qualification station — a completion figure counts up, then the four warn-level gaps and the single hard blocker resolve beside it
- voiceover: "The Qualification tab is live. One of six requirements filled. Four gaps that only warn. And one that blocks — the Economic Buyer, still unnamed."
- duration: 10.539s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-tab-already-knows.html
- type: feature_showcase
- persuasion: Demonstration (show the mechanism running) + Progressive disclosure
- beat: comprehension + foresight
- blueprint: dataviz-countup (Adapt)
- focal: the 17% completion figure and its meter
- roles: figure + meter = foreground subject · cream ground = background · the warnings row, the blocker row, the source footline = supporting
- sfx: none

narrativeRole: Turns frame 3's anatomy into live state on one real deal, and plants the Economic Buyer gap that frame 8 will refuse on.
keyMessage: Completion, warnings and blockers are computed live from fields the Sales Team already maintains.

**Seeded values:** *Line 2 Expansion* has only `meddic_champion` filled, so completion is **1 of
6 → 17%**. Its four warn-level gaps are Metrics, Decision Process, Decision Criteria and Identify
Pain; its one blocker is **Economic Buyer, at Marked Won**. The blocker row must say it will
refuse at *Marked Won* — not at quotation.

Adapt: the signature **count-up whose transform scale grows with the value, landing as one beat
with its paired graphic**, is kept exactly. The camera is dropped — locked frame, element-level
reveals — sanctioned by the blueprint's own camera-free variants, and right here because frame 4
just spent its budget on a pan.

Scene 1 (0.0–2.0s): kicker settles. The mono label and the **empty** meter track reveal. No
number yet. Asymmetric 40/60, right column empty.
Scene 2 (2.0–3.6s): **the signature beat** — the figure counts `0 → 17%` with its transform
scale growing (`counting-dynamic-scale`) while the coral meter fill sweeps to 17% on the **same
ease** (`stat-bars-and-fills`) so number and graphic land as one. The frame's one accent moment.
Scene 3 (4.3–6.6s): on "four gaps that only warn", the `teal` warnings row slides in and its tag
spring-pops, naming all four.
Scene 4 (6.6–9.0s): on "one that blocks", the `block`-red row arrives beneath it — Economic
Buyer, "Missing — will refuse at Marked Won".
Scene 5 (9.0–10.2s): a hairline draws left→right above the footline and the mono source line
reveals, tying the state back to the Sales Team's Properties.
Scene 6 (10.2–10.539s): **held still**.

## Frame 6 — Warned, not blocked

- scene: The quotation station — an oversized cursor presses Create Quotation and the action goes through, with the two missing quotation-checkpoint requirements flagged in teal
- voiceover: "So the rep raises a quotation. Two requirements are missing at that checkpoint — but both only warn. The quotation goes through: flagged, not stopped."
- duration: 10.411s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-warned-not-blocked.html
- type: feature_showcase
- persuasion: Comparison of two options (the control case for frame 8) + Demonstration
- beat: orientation + mild relief
- blueprint: cursor-ui-demo (Adapt — locked-stage form)
- focal: the teal warning card
- roles: warning card = foreground subject · cream ground = background · the Create Quotation button, the oversized cursor, the three outcome beats = supporting
- sfx: none

narrativeRole: The first half of the two-gate pair — establishes that a missing Requirement does not automatically stop anything, so frame 8's refusal reads as a deliberate difference in kind rather than the addon simply being obstructive.
keyMessage: At the quotation checkpoint MEDDIC's missing Requirements only warn, so the quotation is created and flagged.

**Seeded values:** the two quotation-checkpoint Requirements are **Decision Process** and
**Decision Criteria**, both `warn`, and both empty on this opportunity. No seeded Requirement
blocks at quotation creation, which is exactly why this frame exists.

Adapt: the signature — a visible cursor driving a reconstructed surface so its state changes —
is kept, in the blueprint's locked-stage form. **Keep this frame visually parallel to frame 8**:
same button geometry, same cursor entry, same card position. Only the hue and the outcome differ.

Scene 1 (0.0–1.3s): kicker settles. The "Create Quotation" button sits alone on cream; the
**oversized cursor** enters from off-frame lower-right and glides to it (`cursor-click-ripple`).
Camera locked all frame.
Scene 2 (1.3–2.4s): the cursor lands; cursor and button **co-depress** and a ripple expands.
Scene 3 (2.4–5.4s): the button dims and the `teal` warning card **grows in from behind it**
(`scaleY` from the button's bottom edge), carrying its mono tag "Warned by MEDDIC"; then the
serif line naming the two missing Requirements reveals per-word.
Scene 4 (5.4–6.9s): the mono reason line "Checkpoint: Quotation Created · Enforcement: Warn"
lands beneath it.
Scene 5 (6.9–10.0s): the three outcome beats **hard-cut in, one per spoken cue** — "Flagged."
~6.95s, "Not stopped." ~7.85s, "Quotation created." ~8.85s (`discrete-text-sequence`), the last
in `ink` at weight 500.
Scene 6 (10.0–10.411s): **held still**.

## Frame 7 — The questions it asks

- scene: A completed Call activity checks off and the three seeded Playbook Questions cascade out of it; the checkpoint rail sits beneath as a neutral reminder
- voiceover: "Mark the call done, and the Playbook Questions surface — the ones tied to that activity. Three questions, asked at exactly the moment they can still change the deal."
- duration: 10.752s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/07-questions-it-asks.html
- type: feature_showcase
- persuasion: Question-answer pairing + Callback (the checkpoint rail returns)
- beat: momentum + mastery
- blueprint: grid-card-assemble (Adapt)
- focal: the three Playbook Question cards
- roles: the three question cards = foreground subject · cream ground = background · the activity chip, the checkpoint rail = supporting
- sfx: none

narrativeRole: The coaching half of the addon — the half that helps rather than gates — placed between the two enforcement gates so the film is not two refusals in a row.
keyMessage: Playbook Questions surface off a completed activity, at the moment the answers can still change the outcome.

**Seeded values:** the activity type is **Call** (`mail.mail_activity_data_call`) and the three
questions are MEDDIC's seeded Playbook Questions verbatim. The checkpoint rail stays **unlit** —
lighting Marked Won here would pre-empt frame 8.

Adapt: the signature staggered cascade is kept but **caused** — the cards emerge from behind the
activity chip that just checked off. The emergence vector travels only ~34% of the way to the
chip so cards never fly across each other's text; the timing carries the causality.

Scene 1 (0.0–1.2s): kicker settles. The Call activity chip sits alone, checkbox **empty**;
triptych region empty.
Scene 2 (1.2–2.4s): on "done", the `teal` check **draws itself** in (`svg-path-draw`) and the
mono "Marked done" tag flashes in. The trigger beat.
Scene 3 (2.4–6.6s): the three question cards **cascade out from behind the chip** into the
triptych, left to right ~1.2s apart, each serif question revealing as it lands. Cards fill the
vertical slack between chip and rail.
Scene 4 (6.6–10.4s): the checkpoint rail resolves along the bottom — the four stops arriving
left to right, all hairline-only — a neutral reminder that two of these moments gate.
Scene 5 (10.4–10.752s): **held still**.

## Frame 8 — Refused

- scene: Same stage as frame 6, same cursor, same button geometry — the rep presses Mark Won and the action does not proceed; a block-red refusal with a named reason takes the frame
- voiceover: "Then the rep marks it Won. The Economic Buyer is still empty, and at this checkpoint it blocks. So Odoo refuses, and says exactly why. Not a nudge. Not a colored badge. Refused."
- duration: 12.715s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/08-refused.html
- type: feature_showcase
- persuasion: Demonstration + Contrast against frame 6 (same action shape, opposite outcome)
- beat: tension + conviction
- blueprint: cursor-ui-demo (Adapt — locked-stage form)
- focal: the block-red refusal card
- roles: refusal card = foreground subject · cream ground = background · the Mark Won button, the oversized cursor, the three closing beats = supporting
- sfx: none

narrativeRole: The hero beat, and the second half of the two-gate pair. Everything before it is setup for this single moment — the one place the video proves "enforcement" is literal.
keyMessage: An unmet Block Requirement refuses the action outright, at its own checkpoint, with a clear stated reason.

**Seeded values:** the blocker is **Economic Buyer** at the **Marked Won** checkpoint,
`enforcement = block`, empty on this opportunity. The refusal line and the reason line must both
say Marked Won.

Adapt: locked-stage form, chosen deliberately: the whole point is that the click produces **no**
progression. **Visually parallel to frame 6** — the difference in outcome is the entire teaching.

Scene 1 (0.0–1.4s): kicker settles. The "Mark Won" button sits alone; the **oversized cursor**
enters from off-frame lower-right and glides to it. Camera locked all frame.
Scene 2 (1.4–3.0s): the cursor lands; cursor and button **co-depress** and a ripple expands.
Then nothing — the click is spent and the screen **does not proceed**. That withheld progression
is the beat, and it is the visible difference from frame 6.
Scene 3 (3.0–6.0s): the button dims and the `block`-red refusal card **grows in from behind it**,
carrying its mono tag "Blocked by MEDDIC" first.
Scene 4 (6.0–9.0s): on "says exactly why", the serif refusal line reveals **per-word**, then the
mono reason line "Checkpoint: Marked Won · Enforcement: Block" lands. The card fills ~50% of the
frame.
Scene 5 (9.0–11.9s): the three closing beats **hard-cut in, one per spoken cue** — "Not a
nudge." / "Not a colored badge." / "Refused." — the last in `ink` at weight 500.
Scene 6 (11.9–12.715s): **held dead still — no jitter, no drift, nothing.** The cursor stays
parked where it clicked. The film's climax and its stillest frame. Do not add aliveness here.

## Frame 9 — Your pipeline never moved

- scene: One continuous decelerating pull-back from the gated card reveals the whole kanban board it was sitting on — stages, cards and automations all running untouched — and the closing lines land over the wide
- voiceover: "And pull back. Your pipeline never moved. No business logic in the addon reads or writes a stage — your kanban, your views, your automations, untouched. It gates two actions, never your pipeline. A coaching layer with teeth."
- duration: 15.659s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/09-pipeline-never-moved.html
- type: branding
- persuasion: Subtractive framing (define it by what it is not) + Distillation
- beat: clarity + resolve
- blueprint: zoom-out-workspace-reveal (Adapt — sub-shape B, close-up dwell then burst reveal)
- focal: at open, the single opportunity card and its stage chip; after the reveal, the whole board
- roles: the board = foreground subject (it becomes the subject at the reveal) · cream ground = background · the three "untouched" chips, the closing lines = supporting
- sfx: none

narrativeRole: Answers the single question a consultant carries into a client instance — "what will this break?" — by making the gate visibly small inside an untouched pipeline, then distils the whole video to one line.
keyMessage: The gating is orthogonal to the pipeline; it constrains two specific actions and nothing else.

**Seeded values:** the amber card is *Line 2 Expansion*, and it sits in **Qualified** because
that is its seeded `stage_id` (`crm.stage_lead2`). The board's four columns are Odoo's default
CRM stages. The card's stage chip is the field the whole frame is about — the one the addon never
writes.

Adapt: the signature — **one decelerating outward move, then a locked frame** — is kept exactly,
with the hard rule: no zoom-in anywhere, one zoom-out only, zero camera motion after the lock.
The whole board is authored at final layout in one `.world` from frame 0; nothing assembles.

Scene 1 (0.0–1.4s): **full-bleed close-up** — the camera opens at ~5–6× on the amber opportunity
card, counter-translated to center it; no column heads or neighbours visible. Micro-action: the
"Qualified" stage chip reveals and an ink hairline draws beneath it.
Scene 2 (1.4–3.4s): on "your pipeline never moved", the **pre-reveal dwell** — a gentle outward
ease of ≤15% travel; the neighbouring card's top edge just enters frame.
Scene 3 (3.4–5.0s): **the reveal.** ONE decelerating zoom-out burst (~1.6s, `expo.out`) on the
`.world` to `scale 1, translate 0` (`viewport-change`), landing the full four-column board with
the amber card exactly where it always was. The camera eases to a **full stop and LOCKS.**
Scene 4 (5.0–7.0s): locked wide, **held still** — the board reads.
Scene 5 (7.0–11.0s): on "your kanban, your views, your automations", the three `teal` "untouched"
chips arrive **one per spoken item**, left to right. Element motion only.
Scene 6 (11.0–13.4s): the serif closing line reveals as **two hard-cut beats** — "It gates two
actions." then "Never your pipeline."
Scene 7 (13.4–15.659s): on "A coaching layer with teeth", the final line reveals per-word in
`ink` (the amber card border is this frame's one accent moment), then **long held still** to the
end. The video ends here; no exit move.
