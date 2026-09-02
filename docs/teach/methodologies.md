<!-- layout: methodologies -->
<!-- dependencies: ../research/b2b-sales-methodologies-odoo.md -->
# The Eight B2B Sales Methodologies

Branches off [Sales Methodology, Explained](sales-methodology-vs-odoo-crm.md). Every claim here traces to the trademark holder's or originating author's own site — full citations live in the underlying research doc.

## Intended Learning Outcomes

- Name the core framework of each of the eight methodologies the addon can model, in the originating organization's own terms.
- Explain what problem each methodology claims to solve, so you can match a prospective client's stated pain to the right one.
- Identify which three methodologies are pre-seeded in the demo data (MEDDIC, Sandler, SPIN) and which five are supported by the addon's architecture but not yet configured.
- Translate a methodology's own named elements (e.g. MEDDIC's "Economic Buyer") into what it would look like as a Requirement in this addon.

## MEDDIC / MEDDPICC <span class="demo-badge">Used in our demo</span>

**Origin.** Developed inside PTC in the early 1990s; MEDDIC Academy and the MEDDICC platform both host primary material, attributing authorship slightly differently.

**The framework.** Six elements: **M**etrics (measurable economic benefit vs. competition or no-decision), **E**conomic Buyer (who can release funds), **D**ecision Process, **D**ecision Criteria, **I**dentify Pain, **C**hampion. MEDDPICC adds **P**aper Process and **C**ompetition.

**Problem it addresses.** More accurate deal qualification and forecasting.

**Seeded in the demo as.** 6 Requirements (Metrics, Economic Buyer, Decision Process, Decision Criteria, Identify Pain, Champion), 3 Playbook Questions — assigned to demo client Nimbus Robotics.

**Mapping to the addon.** The most directly CRM-field-shaped methodology of the eight — each element is already something to identify, know, or measure per deal, exactly what a Requirement is for.

## Sandler Selling System <span class="demo-badge">Used in our demo</span>

**Origin.** Created by David H. Sandler, founder of Sandler Training, positioned explicitly against pressure-based sales tactics.

**The framework.** Seven steps: Establishing Bonding & Rapport, Setting an Up-Front Contract, Identify the Prospect's Pain, Uncover the Prospect's Budget, Identify the Decision Making Process, Present Your Fulfillment of the Agreement, Confirm the Post-Sell Process.

**Problem it addresses.** Preventing manipulation and "games" from entering the sales conversation.

**Seeded in the demo as.** 3 Requirements (Pain, Budget, Decision-Making Process), 2 Playbook Questions — assigned to demo client Falcon Logistics.

**Mapping to the addon.** Data-shaped steps become Requirements; the two conversational steps (Up-Front Contract, Post-Sell Confirmation) become Playbook Questions instead.

## SPIN Selling <span class="demo-badge">Used in our demo</span>

**Origin.** Created by Neil Rackham, founder of Huthwaite International, first documented in his 1988 book of the same name.

**The framework.** Four question types in sequence: **S**ituation, **P**roblem, **I**mplication, **N**eed-payoff.

**Problem it addresses.** Big, complex transactions, where uncovering latent problems creates the buyer's own sense of urgency.

**Seeded in the demo as.** 0 Requirements (deliberately), 4 Playbook Questions — assigned to demo client Comet Analytics.

**Mapping to the addon.** Playbook-only by design: SPIN's value is entirely in the sequence of questions asked, not a field filled in afterward — proof a methodology doesn't need any Requirements at all.

## CustomerCentric Selling

**Origin.** Created by Michael T. Bosworth with John R. Holland; trained today via customercentric.com.

**The framework.** Targeted Conversation Lists™ pairing decision-maker titles with business outcomes, diagnostic questions, and "Sales Ready Messaging®." Guiding principle: "people would rather buy than be sold to."

**Problem it addresses.** Losing deals to "no decision," trouble reaching real decision-makers, inconsistent forecasts, excessive discounting.

**Mapping to the addon.** Would need a Requirement recording each decision-maker's title/role, plus a milestone Checkpoint a manager reviews against — not configured in the demo, but a straightforward new `crm.methodology` record.

## Solution Selling

**Origin.** Michael T. Bosworth's 1995 book, now marketed by Richardson Sales Performance.

**The framework.** Five components, and a diagnostic model called **PPVVC**: Pain, Power, Vision, Value, Consensus.

**Problem it addresses.** Long sales cycles, complex buying groups, inconsistent pipelines.

**Mapping to the addon.** PPVVC's five dimensions translate directly to five Requirements — a close analog to how MEDDIC's six elements were configured.

## The Challenger Sale

**Origin.** Matthew Dixon and Brent Adamson, from CEB/Gartner research; commercialized by Challenger Inc.

**The framework.** Three behaviors — "Teach, Tailor, Take Control" — built around creating constructive tension.

**Problem it addresses.** Relationship-first selling performs worst in complex sales; buyers are ~57% through their buying process before engaging a rep, so the rep's job is to teach.

**Mapping to the addon.** The natural fit is a record of what insight was taught to which stakeholder — closer to a Playbook Question than a Metrics-style field.

## ValueSelling Framework

**Origin.** Created and owned by ValueSelling Associates, Inc.

**The framework.** A four-stage cycle: **Engage → Qualify → Advance → Close**.

**Problem it addresses.** Price-based competition — connecting a solution to quantified business impact instead of features.

**Mapping to the addon.** The natural Requirement is a quantified buyer-side value/ROI figure, deliberately distinct from `expected_revenue` (which quantifies value to the seller, not the buyer).

## Consultative Selling

**Origin.** An umbrella term, not a single trademarked system — often traced bibliographically to Mack Hanan's 1970 book, though Huthwaite International also credits SPIN's Neil Rackham as a pioneer of the approach.

**The framework.** No single named structure — open-ended, discovery-led conversation, by design.

**Problem it addresses.** Generic: understanding the buyer's needs before pitching.

**Mapping to the addon.** No named Requirement set is implied — a client asking for "consultative selling" is usually really asking about SPIN, MEDDIC, or Solution Selling specifically.

## Further reading

- [Back to Sales Methodology, Explained](sales-methodology-vs-odoo-crm.md)
