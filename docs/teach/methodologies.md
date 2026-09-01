# The Eight B2B Sales Methodologies

*A deep-dive teaching branch of [Sales Methodology, Explained](sales-methodology-vs-odoo-crm.md). Every claim below is sourced from [`docs/research/b2b-sales-methodologies-odoo.md`](../research/b2b-sales-methodologies-odoo.md), which cites primary sources (the trademark holder or originating author's own site) for each methodology — this page distills that research for a reader who wants to understand the methodologies themselves and how the `crm.methodology` addon's Requirements/Checkpoints/Enforcement map onto each one.*

## Intended Learning Outcomes

After reading this page, you should be able to:

- Name the core framework of each of the eight methodologies the addon can model, in the originating organization's own terms.
- Explain what problem each methodology claims to solve, so you can match a prospective client's stated pain to the right one.
- Identify which three methodologies are pre-seeded in the demo data (MEDDIC, Sandler, SPIN) and which five are supported by the addon's architecture but not yet configured (CustomerCentric Selling, Solution Selling, Challenger, ValueSelling, Consultative Selling).
- Translate a methodology's own named elements (e.g. MEDDIC's "Economic Buyer") into what it would look like as a `crm.methodology.requirement` in this addon.

---

## MEDDIC / MEDDPICC 🟢 *used in our demo*

**Origin.** Developed inside PTC in the early 1990s; MEDDIC Academy and the MEDDICC platform both host primary material, though they attribute the framework's authorship slightly differently (a PTC sales-management team vs. Dick Dunkel personally).

**The framework.** Six elements, per MEDDIC Academy's own definition: **M**etrics (the measurable economic benefit vs. competition or no-decision), **E**conomic Buyer (who can actually release funds), **D**ecision Process, **D**ecision Criteria, **I**dentify Pain, **C**hampion. MEDDPICC adds **P**aper Process and **C**ompetition.

**Problem it addresses.** More accurate deal qualification and forecasting — MEDDIC Academy states it directly: "if you execute the above in any complex B-to-B sales campaign, you win the sale."

**Seeded in the demo as:** 6 Requirements (Metrics, Economic Buyer, Decision Process, Decision Criteria, Identify Pain, Champion) and 3 Playbook Questions (Metrics, Identify Pain, Economic Buyer), assigned to demo client Nimbus Robotics.

**Mapping to the addon.** This is the most directly CRM-field-shaped methodology of the eight — each named element is already something to "identify," "know," or "measure" per deal, which is exactly what a `crm.methodology.requirement` is for.

---

## Sandler Selling System 🟢 *used in our demo*

**Origin.** Created by David H. Sandler, founder of Sandler Training, "with a clinical psychologist," positioned explicitly against manipulative, pressure-based sales tactics.

**The framework.** Seven steps, per Sandler's own page: Establishing Bonding & Rapport, Setting an Up-Front Contract, Identify the Prospect's Pain, Uncover the Prospect's Budget, Identify the Decision Making Process, Present Your Fulfillment of the Agreement, Confirm the Post-Sell Process.

**Problem it addresses.** Preventing "games" — pressure tactics and manipulation — from ever entering the sales conversation, by putting the rep in control of a structured discovery process instead.

**Seeded in the demo as:** 3 Requirements (Pain, Budget, Decision-Making Process) and 2 Playbook Questions (Up-Front Contract, Confirm Post-Sell), assigned to demo client Falcon Logistics.

**Mapping to the addon.** The three Requirements cover the steps most naturally captured as data (Pain, Budget, Decision Process); the two conversational steps (Up-Front Contract, Post-Sell Confirmation) are Playbook Questions instead, since they're about *what to ask*, not a field to fill in.

---

## SPIN Selling 🟢 *used in our demo*

**Origin.** Created by Neil Rackham, founder of Huthwaite International, first documented in his 1988 book of the same name. Huthwaite's own site also credits Rackham as a pioneer of the broader "consultative selling" approach (see below).

**The framework.** Four question types asked in sequence: **S**ituation, **P**roblem, **I**mplication, **N**eed-payoff — used within a four-stage conversation (Preliminaries, Investigating, Demonstrating capability, Obtaining commitment).

**Problem it addresses.** Big, complex transactions, where uncovering a buyer's latent problems and their business implications — rather than pitching features — is what actually creates the buyer's own sense of need and urgency.

**Seeded in the demo as:** 0 Requirements (deliberately) and 4 Playbook Questions (Situation, Problem, Implication, Need-payoff), assigned to demo client Comet Analytics.

**Mapping to the addon.** SPIN is playbook-only by design in the demo data: its value is entirely in the sequence and content of the questions asked during discovery, not in a qualification field to fill afterward — a clean illustration that a `crm.methodology` doesn't have to define any Requirements at all.

---

## CustomerCentric Selling

**Origin.** Created by Michael T. Bosworth with John R. Holland; now trained via customercentric.com.

**The framework.** Built around Targeted Conversation Lists™ (pairing decision-maker titles with the business outcomes they care about), diagnostic questions, and "Sales Ready Messaging®." The guiding principle, in the methodology's own words: "people would rather buy than be sold to."

**Problem it addresses.** Losing deals to "no decision," trouble reaching real decision-makers, inconsistent rep performance, unreliable forecasts, excessive discounting, and sales/marketing message misalignment.

**Mapping to the addon.** Would need a Requirement recording each targeted decision-maker's title/role per opportunity, plus a milestone/grading Checkpoint a sales manager reviews against — not yet configured in the demo, but architecturally straightforward to add as a new `crm.methodology` record.

---

## Solution Selling

**Origin.** Michael T. Bosworth's 1995 book, now marketed by Richardson Sales Performance.

**The framework.** Five components (A Map for Sales Success, Building Sales Pipelines, Establishing Buyer Consensus, Collaborating with Buyers, Negotiating the Win) and a diagnostic model Richardson calls **PPVVC**: Pain, Power, Vision, Value, Consensus.

**Problem it addresses.** Long sales cycles, complex buying groups, and inconsistent pipelines in a "consensus-driven" B2B environment.

**Mapping to the addon.** PPVVC's five dimensions translate directly to five Requirements — a close analog to how MEDDIC's six elements were configured.

---

## The Challenger Sale

**Origin.** Matthew Dixon and Brent Adamson, from CEB (later Gartner) research; commercialized by Challenger Inc.

**The framework.** Three behaviors — "Teach, Tailor, Take Control" — built around creating "constructive tension," with a six-part conversation structure (warmer, reframe, rational drowning, emotional impact, presenting a new way, the solution).

**Problem it addresses.** Challenger's own research found that traditional relationship-first selling ("the Relationship Builder") performs worst in complex sales, and that buyers are typically 57% through their buying process before ever engaging a rep — so the rep's job is to teach something new, not just relate well.

**Mapping to the addon.** The natural Requirement here is less a qualification field and more a record of *what specific insight was taught to which stakeholder* — closer to a structured Playbook Question than a Metrics-style field.

---

## ValueSelling Framework

**Origin.** Created and owned by ValueSelling Associates, Inc.

**The framework.** A four-stage cycle: **Engage → Qualify → Advance → Close**, aimed at giving a revenue team "a common language" to "compete on value, not price."

**Problem it addresses.** Price-based competition — connecting a solution to quantified business impact instead of a features list.

**Mapping to the addon.** The natural Requirement is a quantified buyer-side value/ROI figure — deliberately distinct from `expected_revenue` (which quantifies the deal's value to the *seller*, not the value delivered to the *buyer*).

---

## Consultative Selling (umbrella term)

**Origin.** Treated as a general umbrella rather than a single trademarked system — no single primary source claims exclusive ownership the way the other seven do. Often traced bibliographically to Mack Hanan's 1970 book, though Huthwaite International's own site also credits Neil Rackham (SPIN's creator) as "a leading authority on consultative selling."

**The framework.** No single named structure — open-ended, discovery-led conversation, by design.

**Problem it addresses.** Generic: selling by understanding the buyer's needs first, rather than pitching.

**Mapping to the addon.** No named Requirement set is implied by the research — a client asking for "consultative selling" support is really asking which of the other seven (usually SPIN, MEDDIC, or Solution Selling) they actually mean, since "consultative" describes a stance, not a checklist.

---

## Further reading

- [Sales Methodology, Explained](sales-methodology-vs-odoo-crm.md) — the main teach doc this page branches from
- [B2B sales methodologies research](../research/b2b-sales-methodologies-odoo.md) — full primary-source citations for every claim above, plus how OOTB Odoo and six competing platforms handle (or don't handle) each one
