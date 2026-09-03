<!-- layout: main -->
<!-- dependencies: methodologies.md ../contexts/crm/CONTEXT.md ../adr/0005-methodology-requirements-reference-properties-by-key.md ../research/b2b-sales-methodologies-odoo.md -->
# Sales Methodology, Explained

What the custom `crm.methodology` addon does, why it exists, and exactly how it differs from stock Odoo 19 CRM — for Sales, R&D, and the consultants who have to explain it to a client.

<!-- section: tldr s c -->
## TL;DR

The `crm.methodology` addon lets a Sales Manager define named qualification frameworks — MEDDIC, Sandler, or an in-house one — and attach them per client. Each framework declares **Requirements**: qualification fields that must (or should) be filled in before an opportunity can move to a quotation or be marked Won, plus **Playbook Questions** that surface during discovery activities. It's a coaching and gating layer, not a pipeline replacement.

The reason it exists: stock Odoo 19 CRM has no concept of a named B2B sales methodology at all — confirmed against the actual vendored Odoo source in this repo. See [§10, how this compares to the broader market](#market).

<!-- section: why s r c -->
## Why this exists

Internal research surveyed [eight named B2B methodologies](methodologies.md) — MEDDIC/MEDDPICC, Sandler, Challenger Sale, SPIN Selling, Solution Selling, CustomerCentric Selling, ValueSelling, Consultative Selling — from primary, trademark-holder sources, then checked whether stock Odoo 19 CRM already supported any of them. It found nothing: no methodology-specific fields, stages, or terminology anywhere in the vendored CRM, Sales, or Mail modules. See [The Eight B2B Sales Methodologies](methodologies.md) for what each one actually claims, in its own trademark holder's words, and how it maps onto a Sales Methodology configuration.

The addon's founding commit frames the need directly: Sales Managers define named Sales Methodologies; opportunities inherit their client's methodology; reps are blocked with a clear error when a Block-enforcement Requirement is unmet. The core engine shipped first, followed by demo personas so the workflow could be shown live, and a "Reset Demo Data" action so the demo can be replayed without polluting real data.

![Workflow: a new opportunity inherits its client's default methodology, shows live completion in the Qualification tab, and is gated at two points — creating a quotation and marking Won — each either refused with a clear error when a Block Requirement is unmet, or proceeding (through an activity-done Playbook Question wizard, in the quotation case) to Won.](images/workflow-diagram.svg)

The addon deliberately does **not** try to own qualification-field storage itself. Requirements reference Odoo's native per-team `lead_properties` Properties mechanism by string key, rather than defining bespoke fields — and the reason is simple: Sales Teams already configure their own Properties, and a second, addon-owned field system would immediately fork from whatever fields a team actually uses, forcing reps to fill in the same information twice under two different names. Referencing by key keeps one field, one place, one name — the addon adds enforcement on top of data that already exists, instead of asking teams to maintain it twice. More on that trade-off in [§8](#decisions).

<!-- section: vocabulary r c -->
## Core vocabulary

Five terms, used consistently everywhere in the codebase and its docs. Reuse them as-is — don't invent synonyms.

| Term | Definition |
|---|---|
| Sales Methodology | A named qualification framework (e.g. MEDDIC), owning a set of Requirements and Playbook Questions. |
| Requirement | One qualification field a methodology cares about, tied to a Checkpoint and an Enforcement level. |
| Checkpoint | The moment in an opportunity's life a Requirement is checked: Quotation Created, Marked Won, Marked Lost, or Continuous. |
| Enforcement | **Block** — can't proceed without it. **Warn** — flagged, but proceeds anyway. |
| Playbook Question | A discovery question tied to an activity type, surfaced when a rep marks a matching activity done. |

<!-- section: workflow s c -->
## The workflow story

Trace one opportunity through the addon:

1. A client has a default methodology. Every new opportunity for that client inherits it automatically on creation — a rep can change it afterward, it isn't locked retroactively.
2. The opportunity's Qualification tab shows live completion: percentage complete, which Requirements are missing as warnings, and which are missing as hard blockers.
3. Creating a quotation checks every quotation-checkpoint Block Requirement. If one's unmet, quotation creation is refused with a clear error — a hook into quote creation, not a stage change.
4. When a rep marks a matching activity — a discovery call, say — done, a wizard surfaces any Playbook Questions tied to that activity type.
5. Marking the opportunity Won checks every won-checkpoint Block Requirement the same way quotation creation does.
6. If a Requirement's key doesn't yet exist on the client's Sales Team's Properties, a rep can use "Sync to Team" to add it in one action.

> **For consultants.** None of this touches the kanban pipeline. A lead can sit in any stage throughout this entire flow — the gating is orthogonal to where the opportunity is in the pipeline.

<!-- section: untouched c r s -->
## What's explicitly untouched: the pipeline

The addon never reads or writes Odoo's pipeline-stage field (`stage_id`) or its OOTB won/lost stage flag (`is_won`) from any of its business logic. (Two test files read `stage_id`, read-only, only to assert demo-data invariants in tests — not to gate or move opportunities through the pipeline.)

> **For consultants.** This is the single most important thing when mapping this addon onto a client's existing Odoo instance. **It does not replace, extend, or interact with stage-based pipeline customization.** A client's existing stage configuration, kanban views, and stage-change automations are completely unaffected — Requirements gate *quotation creation* and *marking Won*, two specific actions, never which stage an opportunity sits in.

<!-- section: appendix r c -->
## Technical appendix: model by model

| Model | What the addon adds | OOTB status | Notes |
|---|---|---|---|
| crm.methodology | Named framework, owning Requirements and Playbook Questions. Exactly one default "None" methodology, always. | <span class="pill new">New</span> | No OOTB equivalent. |
| crm.methodology.requirement | Binds a Properties key to a Checkpoint + Enforcement level. Reconciles against a team's Properties definition. | <span class="pill new">New</span> | Built on OOTB Properties, not a parallel field system. |
| crm.methodology.playbook.question | A discovery question tied to an activity type. | <span class="pill new">New</span> | &nbsp; |
| crm.lead | Adds methodology + computed completion/warning/blocker fields; blocks Won on unmet Requirements. | <span class="pill ext">Extended</span> | Reuses OOTB Properties storage. |
| crm.stage | Nothing. | <span class="pill same">Unchanged</span> | Confirmed by code search — see §5. |
| crm.team | Not extended by a new class — its Properties definition is written to at runtime when a rep syncs a Requirement. | <span class="pill ext">Runtime dep.</span> | Not a schema change. |
| res.partner | Adds the client's default methodology. | <span class="pill ext">Extended</span> | &nbsp; |
| sale.order | Checks quotation-checkpoint Block Requirements on creation from an opportunity. | <span class="pill ext">Extended</span> | Uses OOTB opportunity link. |
| mail.activity | Surfaces matching Playbook Questions via a wizard on activity feedback. | <span class="pill ext">Extended</span> | Matches OOTB feedback signature. |

<!-- section: decisions r c -->
## Design decisions & trade-offs

Requirements reference the Properties system by key instead of owning field definitions themselves. This keeps qualification data inside the same Properties system Sales Teams already use, avoiding a second parallel field system. The trade-off: a Requirement's key can drift out of sync with a team's actual Properties definition, which is why the addon includes reconciliation and "Sync to Team" logic rather than assuming they always match.

![Properties reference: the Sales Team owns the Properties Definition; a Sales Methodology's Requirement holds a key that looks up that definition (and can trigger Sync to Team when the key is missing); the Properties Definition defines the field that backs the Opportunity's own Properties, where the Requirement reads and checks the actual stored value.](images/properties-reference-diagram.svg)

The addon also follows OCA-style module versioning — the target Odoo series comes first, and the rest tracks the addon's own feature and fix increments independently of Odoo core.

<!-- section: demo s c -->
## Try it yourself

The addon ships three demo users spanning the roles that matter to this workflow: a Sales Manager who defines methodologies and Requirements, a Salesperson who works opportunities under those Requirements, and a Viewer with read-only access. Three named methodologies are seeded and ready to explore — **MEDDIC** (6 Requirements, 3 Playbook Questions), **Sandler Selling System** (3 Requirements, 2 Playbook Questions), and **SPIN Selling** (playbook-only) — each already assigned to a demo client.

| Persona | Login | Password |
|---|---|---|
| Sales Manager | priya.shah@example.com | priya.shah |
| Salesperson | jordan.lee@example.com | jordan.lee |
| Viewer (read-only) | morgan.ito@example.com | morgan.ito |

Sign in at [method.dev.factory1.io](https://method.dev.factory1.io/) as the Salesperson or Sales Manager and open a demo client's opportunity to see live completion/warning/blocker state. To reset the instance after poking at it, sign in as the **Sales Manager** and go to **Configuration > Reset Demo Data** — gated so it only works on this demo database.

> **For consultants.** The Render demo is a free-tier instance — it spins down after ~15 minutes idle, so the first click after a while takes about a minute to wake up. Don't take that as a product issue when showing a client.

<!-- section: market c r -->
## How this compares to the broader market

Prior research surveyed how competing CRMs handle named methodologies: Salesforce Path (stage-scoped required fields), HubSpot Playbooks, Membrain Scorecards, and others. The pattern across the market is "configurable only" or "third-party app only" — no major CRM ships a named methodology natively either. Odoo isn't behind the field here; this addon puts the repo in the same category as the market leaders.

**"Why not just pay for Enterprise / Salesforce / HubSpot instead?"**

| Option | What it costs | How close does it get? |
|---|---|---|
| **Odoo Enterprise** | Enterprise/Custom pricing | Nothing equivalent. Predictive Lead Scoring — Odoo's closest qualification-adjacent feature — is a **Community** feature already in this repo, and it's an ML score, not a captured qualification field. |
| **Salesforce Path + Einstein** | Scoring needs Enterprise/Performance/Unlimited ($165–550+/user/mo) | Path's key fields are guidance only — enforcing them needs a separate Validation Rule; no built-in warn/block distinction. |
| **HubSpot Playbooks** | Professional tier (~$90–100/seat/mo) | Content blocks + property-writing questions — no Checkpoint concept, no enforcement levels. |
| **Membrain Scorecards** | Entry Prospecting tier (~$49/user/mo) | Closest match found — weighted scoring + rule-driven branching — but still no explicit block-vs-warn axis. |

None of the three externally-priced options combine per-methodology switching, named Requirements, lifecycle Checkpoints, and a Block/Warn enforcement axis the way this addon does — each covers a piece of it.

<!-- section: nongoals c r -->
## Non-goals & open gaps

So consultants don't over-promise to clients, today the addon does **not**:

- Scope Requirements to specific pipeline stages, the way Salesforce Path does — Checkpoints are lifecycle moments, not stage-bound.
- Provide a weighted scoring rubric across Requirements — completion is presence or absence, not scored.
- Give a Requirement its own field definition. A Requirement can never define or own a field — it always references a field that already exists in the Sales Team's Properties, by key.

<!-- section: reading s r c -->
## Further reading

- [The Eight B2B Sales Methodologies — deep-dive teaching page](methodologies.md)
- [CRM context glossary — docs/contexts/crm/CONTEXT.md (repo)](https://github.com/dahagag/odoo/blob/dev/19.0/docs/contexts/crm/CONTEXT.md)
- [ADR 0005 — Requirements reference Properties by key (repo)](https://github.com/dahagag/odoo/blob/dev/19.0/docs/adr/0005-methodology-requirements-reference-properties-by-key.md)
- [B2B sales methodologies research — 8 methodologies, OOTB Community/Enterprise, 6 platforms (repo)](https://github.com/dahagag/odoo/blob/dev/19.0/docs/research/b2b-sales-methodologies-odoo.md)
- [Addon source — custom_addons/crm_methodology/ (repo)](https://github.com/dahagag/odoo/tree/dev/19.0/custom_addons/crm_methodology)

*Verified against code as of 2026-09-01 — six of seven technical claims checked directly against current addon and vendored Odoo source; the seventh (pipeline untouched) confirmed for all business logic, with two read-only test-file references noted in §5. Source of truth: docs/teach/sales-methodology-vs-odoo-crm.md.*
