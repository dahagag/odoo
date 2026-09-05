---
format: 1920x1080
duration: 54s
message: "Your trial has four mechanics worth knowing before you dive in: Seats, Expiry & extension, Invites, Suspend & Wake"
arc: Orient → Seats → Expiry & extension → Invites → Suspend & Wake
audience: "Prospects and customers evaluating a Trial Org, on first login"
mode: autonomous
---

## Video direction

- **Palette** (from `frame.md`, remixed onto hosting's own UI colors): `primary` (brand purple #714B67) for hero elements and emphasis; `accent`/warm tone (amber #F0AD4E) reserved for the Expiry & extension frame's clock motif, matching the first-login prompt's own amber clock icon; warm cream `bg` and near-black `text` for the reading ramp, all from the pack — nothing invented outside it.
- **Motion grammar**: `power3` long-tail eases throughout (smooth, never bouncy). Every frame's reveal is paced to its voiceover line — each visual piece (an avatar, a diagram node, a state label) appears exactly when the VO names it, never all at once at t=0. Idle budget: at most a subtle jitter during a hold; no lazy breathing, no forced camera drift.
- **Rhythm**: Frame 1 (Orient) and Frame 5 (Suspend & Wake) are the video's held beats — Orient holds on the title after its one reveal (a calm open), Suspend & Wake holds on the lit "Active" state after the Wake beat (a settled close). Frames 2-4 stay in continuous build across their full duration — no other frame is allowed to sit static.
- **Framing variety** (≥3 distinct framings, never repeated back-to-back): Frame 1 centered · Frame 2 full-width strip · Frame 3 asymmetric 60/40 · Frame 4 split-screen (two paths) · Frame 5 centered.
- **Negative list**: no nav bars, browser chrome, or fake cursors; no generic bokeh/gradient "AI" clichés; no interface mockups (this is mechanics-as-diagram, not a UI recreation — the doc's own Puppeteer screenshots already show the real UI); no slideshow (front-load-then-freeze) and no screensaver (independently floating elements with no shared composition).

## Frame 1 — Orient

- scene: Title card — "Welcome to your trial" over a calm purple field, four mechanic icons arranged below
- duration: 6.059s
- transition_in: cut
- status: animated
- voiceover: "Welcome to your trial. Here's a 30-second orientation to how it works - not a product tour."
- src: compositions/frames/01-orient.html
- blueprint: titlecard-reveal (Adapt)
- focal: the title wordmark "Welcome to your trial"
- roles: title = foreground subject, centered · four mechanic icons (seats/clock/mail/wake) = supporting, arranged in a row beneath · purple field = background, dim ambient radial swell
- sfx: soft-swell

Adapt: keep titlecard-reveal's one-restrained-move-then-hold signature; the "one move" becomes a two-part reveal (title settles, then the icon row layers in beneath it) rather than a single line, since this card carries a supporting row the blueprint's plain variant doesn't.
Scene 1 (0.0–2.0s): purple field fades in with a slow dual-radial ambient swell (background layer only). Nothing else on screen yet — matches "Welcome to your trial" not having landed.
Scene 2 (2.0–4.0s): title wordmark "Welcome to your trial" fades and settles centered (per-word reveal, power3), landing as the VO says the line. Centered, ~45% of frame.
Scene 3 (4.0–6.0s): the four mechanic icons (seats, clock, mail, wake-arrow) fade in left-to-right beneath the title, one every ~0.4s (layer-reveal), as the VO says "orientation to how it works." Full-width strip beneath the centered title. Hold on the assembled title+icons for the last ~1s — no further motion, subtle jitter only.

## Frame 2 — Seats

- scene: A row of avatar seats fills in one by one against the seat cap
- duration: 10.581s
- transition_in: crossfade
- status: animated
- voiceover: "Your trial has a fixed seat cap, set when it was issued. Every teammate who joins takes one of those seats - and every invite has to match your trial's own domain."
- src: compositions/frames/02-seats.html
- blueprint: dataviz-countup (Adapt)
- focal: the seat-cap counter and its row of avatar slots
- roles: seat row = foreground subject, full-width strip · counter ("X / 10 seats") = supporting, upper-third · domain tag = supporting, lower-third
- sfx: tick

Adapt: keep the count-up-ring signature, but the "ring" becomes a horizontal row of ten seat slots that fill left-to-right instead of a single number ticking.
Scene 1 (0.0–2.3s): ten empty seat outlines lay out in a full-width strip, counter reads "0 / 10 seats" upper-third. Nothing filled yet — matches "fixed seat cap" not yet demonstrated.
Scene 2 (2.3–6.8s): as the VO says "every teammate who joins takes one of those seats," three seat outlines fill solid purple in sequence (one per ~1.5s, count-up ticking 1…2…3 in the counter) — layer-reveal, power3.
Scene 3 (6.8–10.6s): a small domain tag ("@yourdomain.com") slides in beneath the row and locks in place (per the "must match your trial's own domain" line) — supporting element, lower-third. Hold on the filled-3-of-10 row + domain tag for the final ~1.5s.

## Frame 3 — Expiry & extension

- scene: A countdown clock ticks down toward an expiry date, then an "Extension" arrow pushes it back out
- duration: 12.651s
- transition_in: crossfade
- status: animated
- voiceover: "Your trial expires on a set date - shown right in the systray. Past that date, it's automatically torn down. Need more time? Ask your sales contact for an extension before it lapses."
- src: compositions/frames/03-expiry.html
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the countdown clock, pinned dead-center-left as the anchor
- roles: clock = foreground subject (the pinned anchor), asymmetric 60% side · expiry date label = supporting, anchored to the clock · extension arrow = supporting, enters late from the caption-clear margin
- sfx: tick, whoosh-soft

Adapt: keep fixed-anchor-cycle's pinned-anchor signature — the clock itself never moves position, only the world/state around it cycles (countdown → dimmed/expired → re-lit) — restaged as a two-state cycle (not the blueprint's multi-state carousel) since there are only two states here (expiring, extended).
Scene 1 (0.0–4.0s): amber clock face fades in on the 60% side (asymmetric 60/40, clock large enough to read), a date label ("Expiry: Sep 19") appears beside it as the VO says "expires on a set date." Caption-clear 40% margin stays empty (reserved for the next beat, not decoration).
Scene 2 (4.0–7.9s): the clock hand sweeps down toward the date (count-down motion, power3) as the VO says "torn down" — lands on a dimmed/greyed clock state for a beat, reading as the Auto-Destroy moment.
Scene 3 (7.9–12.65s): an "Extension" arrow slides in from the 40% margin and pushes the date label rightward (layer-reveal + slide), re-lighting the clock back to full amber, as the VO says "ask your sales contact for an extension." Holds on the re-lit clock + pushed-out date for the final ~1.5s.

## Frame 4 — Invites

- scene: Two paths split from one "Invite" node — Targeted (direct to one email) and Open (a shared link a newcomer confirms into)
- duration: 13.504s
- transition_in: crossfade
- status: animated
- voiceover: "You can invite teammates two ways: a Targeted Invite straight to one email, or an Open Invite Link anyone on your domain can join through - confirmed automatically, no extra routing needed."
- src: compositions/frames/04-invites.html
- blueprint: comparison-split (Adapt)
- focal: the single "Invite" node splitting into two labeled paths
- roles: invite node = foreground subject, top-center · Targeted path = left half, split-screen · Open path = right half, split-screen
- sfx: whoosh-soft

Adapt: keep comparison-split's mirrored two-card opposite-wing signature; instead of two cards arriving simultaneously from opposite wings, one shared "Invite" node forks into two paths that draw outward left/right in sequence (Targeted first, Open second) since the two invite types share one origin rather than being independent peers.
Scene 1 (0.0–3.9s): a single "Invite" node fades in top-center as the VO says "invite teammates two ways" — nothing split yet.
Scene 2 (3.9–8.7s): the node forks — a line draws left labeled "Targeted" landing on one email icon (split-screen left half), timed to "straight to one email."
Scene 3 (8.7–13.5s): a second line draws right labeled "Open" landing on a link icon with a small checkmark confirming (split-screen right half), timed to "anyone on your domain can join through - confirmed automatically." Holds on the completed two-path split for the final ~1.5s.

## Frame 5 — Suspend & Wake

- scene: An instance icon dims to "Suspended" after an idle beat, then a "Wake Up" button lights it back to "Active"
- duration: 11.2s
- transition_in: crossfade
- status: animated
- voiceover: "Idle instances suspend automatically to save cost - nothing is lost. Visiting the URL won't restart it; a Wake Up action brings it back in a minute or two."
- src: compositions/frames/05-suspend-wake.html
- blueprint: cta-morph-press (Adapt)
- focal: the instance icon and its Active/Suspended state label
- roles: instance icon = foreground subject, centered · state label = supporting, directly beneath · Wake Up button = supporting, enters late, lower-third (above caption band)

Adapt: keep cta-morph-press's press-triggers-transform signature (a click is what causes the morph, not an automatic timer) — a cursor lands a click on the "Wake Up" button and THAT press is what relights the icon, same causality as the blueprint's CTA click, restaged around a dim→relight state swap instead of a brand-mark→CTA condense.
Scene 1 (0.0–4.0s): instance icon sits centered, glowing "Active," as the VO opens on "idle instances." Centered, ~45% of frame.
Scene 2 (4.0–7.2s): icon dims to grey, label swaps to "Suspended" (state-swap, power3) as the VO says "suspend automatically to save cost - nothing is lost."
Scene 3 (7.2–11.2s): a "Wake Up" button fades in lower-third (above the caption band); a cursor arrives and lands a click on it exactly as the VO says "brings it back" — the click is what triggers the icon to relight to full "Active" purple glow. Settles and holds still for the final ~2s, the video's closing beat.
