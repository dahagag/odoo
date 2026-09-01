# B2B Sales Methodologies and Odoo 19 CRM/Sales

Research date: 2026-08-30. Scope: eight named B2B sales methodologies
(CustomerCentric Selling, Solution Selling, SPIN Selling, The Challenger
Sale, MEDDIC/MEDDPICC, the Sandler Selling System, the ValueSelling
Framework, and Consultative Selling as a general umbrella term), each
sourced from the originating author/book or the trademark-holding training
organization's own site (Phase 1), followed by a check of whether this
repo's vendored Odoo 19 source (`addons/crm/`, `addons/sale_crm/`,
`addons/sales_team/`, `addons/mail/`) or the official Odoo 19 documentation
names or maps onto each one (Phase 2). Every claim below carries an inline
citation; anything that could not be pinned to fetched primary-source page
text is listed in [Unverified / could not confirm](#unverified--could-not-confirm)
instead of being asserted as fact.

On 2026-08-31, a third phase was added: a survey of how five other
commercial CRM/sales platforms — Salesforce Sales Cloud, HubSpot Sales Hub,
Microsoft Dynamics 365 Sales, Membrain, and Pipeliner CRM (now rebranded
Coevera), plus Zoho CRM — implement (or don't) the same eight methodologies,
gathered as inspiration for closing the gaps Phase 2 found in Odoo (see
[Phase 3](#phase-3--how-other-crmserps-implement-these-methodologies)
below). The same sourcing rule applies: every claim is checked against the
vendor's own help center/documentation/developer docs, and anything not
confirmed that way is listed under Unverified rather than asserted.

## Phase 1 — The methodologies, from primary sources

### 1. CustomerCentric Selling

**Creator / trademark holder.** CustomerCentric Selling was created by
Michael T. Bosworth together with John R. Holland (Frank Visgatis joined as
co-author for the second edition and appears as lead instructor on the
methodology's own current training site, customercentric.com). Bosworth is
separately credited on the same site's search-indexed material as the
author of the earlier book *Solution Selling*.
Source: [CustomerCentric Selling® — Sales Training Workshops](https://customercentric.com/).

The company's own site states: "From our beginning in 2002, we've taught
tens of thousands of B2B professional sellers."
Source: [CustomerCentric Selling — About](https://customercentric.com/about/).

**Core framework.** The methodology reframes selling around a guiding
principle — "people would rather buy than be sold to" — which shifts the
seller's role from "convincing, persuading and overcoming objections to
empowering buyers to achieve desired business outcomes." Practically, this
is built around **Targeted Conversation Lists™ (TCLs)**, which pair
decision-maker titles with the business outcomes they care about, plus
"diagnostic questions" and "Sales Ready Messaging®" used to engage those
titles. The described sales process spans: prospecting/business
development, need development, identifying unique business value,
prospect qualification/disqualification, sales process control, and
negotiation management. Sellers are also expected to "document their
efforts with communication to buyers that sales leaders review to grade
opportunities against pre-defined milestones."
Source: [CustomerCentric Selling® — Sales Training Workshops](https://customercentric.com/).

**Problem addressed.** The site frames the methodology as a response to:
losing deals to "no decision," difficulty reaching actual decision makers,
inconsistent individual sales performance, unreliable forecasts, excessive
discounting, and misalignment between sales and marketing messaging.
Source: [CustomerCentric Selling® — Sales Training Workshops](https://customercentric.com/).

**What a CRM needs to support it.** A record of each targeted
decision-maker's title/role per opportunity (to drive TCL-style targeting),
a place to log the specific business outcome/value discussed with that
contact, and a milestone/grading mechanism a sales manager can review
against a defined process — the last of these is an explicit entailment of
"grade opportunities against pre-defined milestones" above.

### 2. Solution Selling

**Creator / current trademark holder.** Michael T. Bosworth authored
*Solution Selling: Creating Buyers in Difficult Selling Markets*, published
by McGraw-Hill (originally copyrighted 1995).
Source: [McGraw Hill — Solution Selling (PB)](https://www.mheducation.com/highered/mhp/product/solution-selling-pb.html).
The methodology is now marketed by Richardson Sales Performance (the
training organization formed from the 2019/2020 merger of Richardson and
Sales Performance International), whose own site currently hosts the
Solution Selling® training program.
Source: [Richardson — Solution Selling®](https://www.richardson.com/sales-training-programs/sales-professionals/solution-selling/).

**Core framework.** Per the trademark holder's own page, Solution Selling
provides "a structured way to: Identify buyer business issues and connect
them to your solutions; Navigate stakeholder complexity and align across
the buying team; Manage pipelines more effectively and close with less
discounting; Move deals forward collaboratively and predictably." It is
organized into five components — A Map for Sales Success, Building Sales
Pipelines, Establishing Buyer Consensus, Collaborating with Buyers, and
Negotiating the Win — and uses a diagnostic model the page calls **PPVVC**:
Pain, Power, Vision, Value, and Consensus, used to "prioritize deals,
identify risks, and plan their next best move."
Source: [Richardson — Solution Selling®](https://www.richardson.com/sales-training-programs/sales-professionals/solution-selling/).

**Problem addressed.** The current owner's page targets organizations with
"long sales cycles, complex buying groups, or inconsistent pipelines"
operating in "today's competitive, consensus-driven sales environment."
Source: [Richardson — Solution Selling®](https://www.richardson.com/sales-training-programs/sales-professionals/solution-selling/).

**What a CRM needs to support it.** Discrete per-opportunity fields for
each PPVVC dimension (Pain, Power, Vision, Value, Consensus) as named on
the trademark holder's own page, plus a stage-based pipeline that mirrors
"Building Sales Pipelines."

*Note:* the Richardson page, as fetched, does not itself state that
Bosworth founded the company or name a founding year — see
[Unverified](#unverified--could-not-confirm) for that gap, and for the
relationship between Solution Selling and CustomerCentric Selling (which
this research could not pin to primary-source text on either
organization's site).

### 3. SPIN Selling

**Creator / trademark holder.** SPIN Selling was created by Neil Rackham,
founder and former CEO of Huthwaite International, which continues to
publish the methodology on its own site.
Source: [Huthwaite International — Fifty years of SPIN](https://www.huthwaiteinternational.com/fifty-years-of-spin).
Huthwaite's own description: "SPIN Selling is a research-based sales
methodology and the universal framework for persuasive communication,"
first documented in Rackham's 1988 book of the same name.
Source: [Huthwaite International — The SPIN Methodology](https://www.huthwaiteinternational.com/spin-methodology).

**Core framework.** SPIN is an acronym for four question types used in
sequence: **S**ituation, **P**roblem, **I**mplication, and **N**eed-payoff
questions. Huthwaite frames the overall sales conversation in four stages:
Preliminaries (build rapport/credibility); Investigating ("use SPIN
questions systematically to uncover problems, understand implications, and
develop the customer's perception of value and urgency"); Demonstrating
capability; and Obtaining commitment ("secure next steps that advance the
sales process towards a successful conclusion").
Source: [Huthwaite International — The SPIN Methodology](https://www.huthwaiteinternational.com/spin-methodology).

Huthwaite's own site also credits Rackham as "a leading authority on
'consultative selling,' an approach he pioneered" — directly tying SPIN to
the general Consultative Selling umbrella covered in item 8 below.
Source: [Huthwaite International — Fifty years of SPIN](https://www.huthwaiteinternational.com/fifty-years-of-spin).

**Problem addressed.** SPIN targets "big complex transactions," where
uncovering latent problems and their business implications (rather than
pitching features) drives the buyer's own perceived need and urgency.
Source: [Huthwaite International — Fifty years of SPIN](https://www.huthwaiteinternational.com/fifty-years-of-spin).

**What a CRM needs to support it.** A place to log the specific
problem(s) uncovered and their implications per opportunity/contact
(distinct from a generic notes field), since the methodology's own value
lies in the sequence and content of the questions, not just that a call
happened.

### 4. The Challenger Sale

**Creator / trademark holder.** *The Challenger Sale: Taking Control of the
Customer Conversation* was authored by Matthew Dixon and Brent Adamson,
originating from Corporate Executive Board (CEB, later acquired by
Gartner) research; the methodology is now commercialized by Challenger
Inc., which hosts its own explanation of the framework.
Source: [Challenger Inc. — What is the Challenger Sales Methodology?](https://challengerinc.com/what-is-challenger-sales-methodology/).

**Core framework.** Challenger Inc.'s own page centers the methodology on
three behaviors — "Teach, Tailor, Take Control" — built around creating
"constructive tension," and additionally describes a six-part conversation
structure: the warmer, reframe, rational drowning, emotional impact,
presenting a new way, and the solution itself.
Source: [Challenger Inc. — What is the Challenger Sales Methodology?](https://challengerinc.com/what-is-challenger-sales-methodology/).

**Problem addressed.** The page states that traditional relationship-first
selling underperforms in complex B2B sales: "Traditional sales models
demanded that seller work hard to woo clients... Yet Challenger research
revealed this profile, the Relationship Builder, performed the worst in
complex sales." It further asserts "53% of customer loyalty comes down to
the quality of the sales experience" rather than product, price, or brand,
and that buyers are typically "57% through their buying process" before
engaging a salesperson — making the seller's job to teach the customer
something new, not just sell to them.
Source: [Challenger Inc. — What is the Challenger Sales Methodology?](https://challengerinc.com/what-is-challenger-sales-methodology/).

**What a CRM needs to support it.** A way to record what specific
insight/content ("teaching") was delivered to which stakeholder and when —
this is a direct entailment of a methodology whose core behavior *is*
insight delivery, not just contact logging.

### 5. MEDDIC / MEDDPICC

**Creator / trademark holder.** MEDDIC originated as sales-qualification
techniques developed inside PTC (Parametric Technology Corporation) in the
early 1990s. MEDDIC Academy's own site attributes this to an initial team
that "included Darius Lahoutifard and approximately a dozen sales
managers." A separate MEDDIC-methodology site (MEDDICC) instead
specifically names Dick Dunkel as "creator of the MEDDIC framework" and
states he "formulated the six elements of the MEDDIC framework at PTC."
MEDDPICC® itself is stated by MEDDIC Academy to be "a federally registered
trademark of Darius Lahoutifard."
Source: [MEDDIC Academy — What Is MEDDIC?](https://meddic.academy/definition-meddic/);
[MEDDICC — MEDDICC welcomes Dick Dunkel, creator of MEDDIC framework](https://meddicc.com/resources/meddicc-welcomes-dick-dunkel);
[meddpicc.net — MEDDPICC Definition](https://meddpicc.net/meddpicc-sales-definition/).

*(These two primary-ish sources credit the framework's origin somewhat
differently — a team at PTC per MEDDIC Academy vs. Dunkel personally per
MEDDICC's own site — so both attributions are reported here rather than
picking one; see also [Unverified](#unverified--could-not-confirm).)*

**Core framework.** Per MEDDIC Academy's own definition page, the acronym
stands for:

| Letter | Element | MEDDIC Academy's own definition |
|---|---|---|
| M | Metrics | "Measure the potential gain leading to the economic benefit of your solution compared to competition or non-decision" |
| E | Economic Buyer | "Identify and meet the person with the ultimate word to release funds to purchase" |
| D | Decision Process | "Know and Influence the process defined by the client to make a purchase decision" |
| D | Decision Criteria | "Know and Influence the client's criteria to make a purchase decision" |
| I | Identify Pain | "Identify and Analyze the pains that require your solution to be remedied" |
| C | Champion | "Identify, Qualify, Develop, and Test your Champion or Internal Seller" |

Source: [MEDDIC Academy — What Is MEDDIC?](https://meddic.academy/definition-meddic/).

MEDDPICC extends this with **P**aper Process (the legal/procurement/
security steps needed to close) and **C**ompetition (direct competitors,
alternatives, and status quo).
Source: [meddpicc.net — MEDDPICC Definition](https://meddpicc.net/meddpicc-sales-definition/).

**Problem addressed.** MEDDIC Academy's site frames the goal as more
accurate deal qualification and forecasting: "In a nutshell, MEDDIC tells
you that if you execute the above in any complex B-to-B sales campaign,
you win the sale," and separately claims MEDDPICC delivers "higher sales
productivity since sellers will only work on deals that will close," "more
accurate sales forecasts," and a "shorter sales cycle."
Source: [MEDDIC Academy — What Is MEDDIC?](https://meddic.academy/definition-meddic/);
[meddpicc.net — MEDDPICC Definition](https://meddpicc.net/meddpicc-sales-definition/).

**What a CRM needs to support it.** This is the most CRM-field-explicit
methodology of the eight: its own definition names each element as
something to "identify," "know," or "measure" per deal — i.e. it directly
entails discrete, per-opportunity fields (or an equivalent structured
place to record answers) for Metrics, Economic Buyer, Decision Process,
Decision Criteria, Pain, Champion, and (for MEDDPICC) Paper Process and
Competition.

### 6. Sandler Selling System

**Creator / trademark holder.** The Sandler Selling System was created by
David H. Sandler, founder of Sandler Training, which continues to publish
the system on its own site (sandler.com). Per Sandler's own page: "David
Sandler teamed up with a clinical psychologist and designed an approach to
sales that would break the traditional stereotypes of salespeople."
Source: [Sandler — The Sandler Selling System](https://sandler.com/sandler-selling-system/).

**Core framework.** Sandler's own site describes it as "a seven-step
system for successful selling. It's a low-pressure, consultative selling
approach that puts you, the salesperson, in control of the discovery
process." The seven steps, as named on the page, are: Establishing
Bonding & Rapport; Setting an Up-Front Contract; Identify the Prospect's
Pain; Uncover the Prospect's Budget; Identify the Decision Making Process;
Present Your Fulfillment of the Agreement; and Confirm the Post-Sell
Process.
Source: [Sandler — The Sandler Selling System](https://sandler.com/sandler-selling-system/).

**Problem addressed.** The system is explicitly positioned against
manipulative, pressure-based sales tactics: "the Sandler Selling System is
designed to prevent the games from ever being played."
Source: [Sandler — The Sandler Selling System](https://sandler.com/sandler-selling-system/).

**What a CRM needs to support it.** A qualification checklist mirroring
the seven named steps — in particular discrete fields for the prospect's
stated pain, their budget, and their decision-making process — since the
system's own step names call each of these out individually as something
to establish before proceeding.

### 7. ValueSelling Framework

**Creator / trademark holder.** The ValueSelling Framework® is created and
owned by ValueSelling Associates, Inc., published on its own site
(valueselling.com).
Source: [ValueSelling — The ValueSelling Framework®](https://www.valueselling.com/solutions/foundational-workshops/the-valueselling-framework).

**Core framework.** The company's own site describes "a simple,
conversational process to manage interactions with prospects and align
your solutions with what buyers value most," organized as a four-stage
cycle: **Engage → Qualify → Advance → Close**. The framework's stated
purpose is to "equip your entire revenue team with a common language and a
practical methodology that lets you compete on value, not price," and to
provide "a common language for greater forecast accuracy, powerful deal
reviews, and effective sales coaching."
Source: [ValueSelling — What Is ValueSelling?](https://www.valueselling.com/what-is-valueselling);
[ValueSelling — The ValueSelling Framework®](https://www.valueselling.com/solutions/foundational-workshops/the-valueselling-framework).

**Problem addressed.** The methodology targets price-based competition,
aiming to "compete on value, not price" by connecting solutions to
quantified business impact rather than features.
Source: [ValueSelling — The ValueSelling Framework®](https://www.valueselling.com/solutions/foundational-workshops/the-valueselling-framework).

**What a CRM needs to support it.** A four-stage pipeline matching
Engage/Qualify/Advance/Close, plus a place to record the quantified
business value/ROI discussed with the buyer (distinct from the deal's own
price), since "compete on value, not price" only works if that value is
captured somewhere other than the quote total.

### 8. Consultative Selling

Consultative Selling is treated here as a general umbrella term rather
than a single trademarked system, per this research's own findings: no
single primary source claims exclusive ownership of the term the way the
other seven methodologies' organizations do. Bibliographic sources
(bookseller/publisher listings) attribute the founding book — *Consultative
Selling: The Hanan Formula for High-Margin Sales at High Levels* — to Mack
Hanan, first published in 1970 and now in an eighth edition from
HarperCollins Leadership.
Source: [Amazon — Consultative Selling: The Hanan Formula for High-Margin Sales at High Levels](https://www.amazon.com/Consultative-Selling-Formula-High-Margin-Levels/dp/0814437508).

Separately, Huthwaite International's own site (see item 3) describes Neil
Rackham as "a leading authority on 'consultative selling,' an approach he
pioneered" — i.e. at least one primary source (the SPIN trademark holder)
treats "consultative selling" as a general approach that SPIN itself
belongs to, rather than a distinct competing framework.
Source: [Huthwaite International — Fifty years of SPIN](https://www.huthwaiteinternational.com/fifty-years-of-spin).

This research could not fetch a primary-source page (Hanan's own
publisher description, in usable form) describing the specific steps of
Hanan's own formula — see
[Unverified](#unverified--could-not-confirm). No CRM-requirement claims are
made for this item beyond what is generically implied by "consultative":
open-ended discovery conversation logging per contact/opportunity, without
a named structured field set.

## Phase 2 — How Odoo 19 supports each methodology

Every model, field, and stage name below was verified directly against
this repo's vendored Odoo 19 source under `addons/crm/`, `addons/sale_crm/`,
`addons/sales_team/`, and `addons/mail/`, or against fetched Odoo 19
documentation pages. Searching the vendored CRM/Sales source for each
methodology's name or acronym (`MEDDIC`, `MEDDPICC`, `SPIN`, `Sandler`,
`Challenger`, `Solution Selling`, "economic buyer", "decision criteria",
"champion", "pain point", `BANT`) returned no matches in code, views, or
non-translation data files — the only non-translation hit was a demo
contact name, "Elmo Espinazo" (a coincidental substring match on "SPIN"
within "Espinazo"), confirmed not to reference the SPIN Selling
methodology.
Source: `addons/crm/` and `addons/sale_crm/` (this repo, vendored Odoo 19
source; grep performed across models, views, and data files).
A targeted web search for these terms scoped to odoo.com's own domain
likewise surfaced no CRM documentation page naming any of the eight
methodologies (the one "Challenger" hit was an unrelated customer company
name, Challenger Aerospace Systems Inc.).
Source: [Odoo — CRM documentation (19.0)](https://www.odoo.com/documentation/19.0/applications/sales/crm.html).
Fetched Odoo 19 documentation pages on lead mining, lost opportunities, and
sales-team pipeline management likewise contain no reference to any of the
eight methodologies or their named qualification concepts.
Source: [Odoo 19.0 — Lead mining](https://www.odoo.com/documentation/19.0/applications/sales/crm/acquire_leads/lead_mining.html);
[odoo/documentation — lost_opportunities.rst, 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/sales/crm/pipeline/lost_opportunities.rst);
[odoo/documentation — manage_sales_teams.rst, 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/sales/crm/pipeline/manage_sales_teams.rst).

Conclusion: **none** of the eight methodologies are explicitly named or
implemented by Odoo 19 (no case (a) findings). All mappings below are case
(b) — generic features that partially overlap a methodology's stated
requirements — or case (c), no meaningful support.

| Methodology | Native Odoo support? | Closest Odoo features | Gaps |
|---|---|---|---|
| CustomerCentric Selling | No | `mail.thread`/chatter logging on `crm.lead` (generic activity/note history); `crm.tag` for loose categorization | No TCL concept, no per-title business-outcome field, no milestone-grading mechanism |
| Solution Selling | No | `crm.stage` pipeline (freeform stage names could be renamed to mirror "Building Sales Pipelines"); `sale.order.opportunity_id` links quotations/orders to the opportunity for "Negotiating the Win" | No PPVVC (Pain/Power/Vision/Value/Consensus) fields of any kind |
| SPIN Selling | No | `mail.activity` (generic Call/Meeting activity types) and chatter notes can record that a conversation happened | No structured place to record Situation/Problem/Implication/Need-payoff content distinctly |
| The Challenger Sale | No | `utm.mixin` fields (`campaign_id`, `medium_id`, `source_id`) on `crm.lead` track which marketing content/campaign sourced a lead | No "insight delivered" or teaching-content tracking per opportunity/stakeholder; UTM tracks acquisition, not in-sales-cycle teaching |
| MEDDIC / MEDDPICC | No (native); Yes (configurable) | `crm.team.lead_properties_definition` + `crm.lead.lead_properties` (the Properties field) let an admin add named custom fields per team without code — the natural place to add Economic Buyer, Champion, Decision Criteria, etc.; `expected_revenue`, `partner_id`/`contact_name`/`function`, `lost_reason_id` cover Metrics-adjacent value, contact identity, and post-mortem reason loosely | No out-of-the-box Economic Buyer/Champion/Decision Criteria/Decision Process/Paper Process/Competition fields; Properties must be configured manually per deployment |
| Sandler Selling System | No | `crm.stage` (per-team custom stages, verified `team_ids` scoping) could be renamed to the seven steps; `lost_reason_id` for qualify-out | No dedicated Budget, Up-Front-Contract, or Pain-identification fields distinct from `expected_revenue`/`description` |
| ValueSelling Framework | No | `crm.stage` could be renamed Engage/Qualify/Advance/Close (default Odoo stages are New/Qualified/Proposition/Won, see below); `expected_revenue`/`recurring_revenue` quantify deal value | No distinct "quantified buyer value/ROI" field separate from deal price |
| Consultative Selling (umbrella) | No | Generic `mail.thread`/activities support open-ended discovery-conversation logging | No named structure at all, by design (it's not a single trademarked system) |

### Notes per methodology

**CustomerCentric Selling.** `crm.lead` inherits `mail.thread.cc`,
`mail.thread.blacklist`, `mail.thread.phone`, and `mail.activity.mixin`,
giving every opportunity a chatter log and activity scheduling — generic
enough to record a directed conversation, but with no field distinguishing
a "targeted conversation" from any other note.
Source: `addons/crm/models/crm_lead.py` (this repo, vendored Odoo 19 source).

**Solution Selling.** The `sale_crm` module adds `order_ids`
(`One2many` to `sale.order` via `opportunity_id`) plus computed
`sale_amount_total`/`quotation_count`/`sale_order_count` fields directly on
`crm.lead`, so a quotation/order is natively linked back to the
opportunity that produced it — useful for Solution Selling's "Negotiating
the Win" stage, though nothing in the model names or tracks Pain, Power,
Vision, Value, or Consensus.
Source: `addons/sale_crm/models/crm_lead.py` (this repo, vendored Odoo 19 source).

**SPIN Selling.** No fields specific to question type exist; only the
generic `mail.activity.type` records (Email, Call, Meeting, To-Do,
Document, Exception) distinguish activity kinds, and none of them encode
"Situation/Problem/Implication/Need-payoff."
Source: `addons/mail/data/mail_activity_type_data.xml` (this repo, vendored
Odoo 19 source).

**The Challenger Sale.** `crm.lead` carries `campaign_id`, `medium_id`,
and `source_id` (from `utm.mixin`) enforced with `ondelete='set null'`,
which is Odoo's mechanism for attributing a lead to a marketing campaign —
this is attribution tracking for how a lead arrived, not a record of what
insight a salesperson taught a buyer mid-cycle, so it does not actually
satisfy Challenger's core requirement.
Source: `addons/crm/models/crm_lead.py` (this repo, vendored Odoo 19 source).

**MEDDIC / MEDDPICC.** `crm.team` defines
`lead_properties_definition = fields.PropertiesDefinition('Lead Properties')`
and `crm.lead` defines `lead_properties = fields.Properties('Properties', definition='team_id.lead_properties_definition', copy=True)`
— Odoo's generic "Properties" mechanism, which lets an administrator define
arbitrary typed custom fields per sales team without writing code. This is
the most direct configurable path to MEDDIC/MEDDPICC's required fields
(Economic Buyer, Champion, Decision Criteria, Decision Process, Paper
Process, Competition), but none of those fields exist by default — they
would have to be added per deployment.
Source: `addons/crm/models/crm_team.py`, `addons/crm/models/crm_lead.py`
(this repo, vendored Odoo 19 source).
Separately, `crm.lead` has `expected_revenue` (Monetary, tracked),
`probability`/`automated_probability` (with a `crm.lead.scoring.frequency`
model backing Odoo's own **Predictive Lead Scoring** feature, configured
via `res.config_settings` fields `predictive_lead_scoring_fields` /
`predictive_lead_scoring_start_date`), and `lost_reason_id` (Many2one to
`crm.lost.reason`, tracked). These are worth flagging precisely because
they are easy to mistake for MEDDIC's "Metrics": Odoo's predictive score is
an internal, ML-derived win-probability estimate based on historical
patterns in the database, not a captured measure of the *customer's own*
economic benefit as MEDDIC's own definition specifies — so it does not
substitute for a Metrics field.
Source: `addons/crm/models/crm_lead.py`, `addons/crm/models/res_config_settings.py`,
`addons/crm/models/crm_lead_scoring_frequency.py` (this repo, vendored Odoo
19 source).

**Sandler Selling System.** `crm.stage` records are freely definable per
team (`team_ids` Many2many, `sequence`, `is_won`, `requirements` free-text
tooltip field) — the default shipped stages are New, Qualified,
Proposition, and Won (sequences 1/2/3/70), which an admin could rename or
supplement to mirror Sandler's seven steps, but Odoo ships no Budget or
Up-Front-Contract concept.
Source: `addons/crm/models/crm_stage.py`, `addons/crm/data/crm_stage_data.xml`
(this repo, vendored Odoo 19 source).

**ValueSelling Framework.** Same `crm.stage` mechanism as above — the
default stage set (New/Qualified/Proposition/Won) is not itself
Engage/Qualify/Advance/Close, but nothing in the model prevents
relabeling. `expected_revenue` and `recurring_revenue`/
`recurring_revenue_monthly` (Monetary fields, tracked) quantify the deal's
value to the *seller*; there is no separate field for the value proposition
quantified *for the buyer*.
Source: `addons/crm/models/crm_lead.py`, `addons/crm/data/crm_stage_data.xml`
(this repo, vendored Odoo 19 source).

**Consultative Selling.** As a general umbrella term with no single
trademarked structure, there is nothing specific for Odoo to implement or
fail to implement beyond the generic chatter/activity logging already
noted for the other methodologies above.

## Phase 3 — How other CRMs/ERPs implement these methodologies

Researched 2026-08-31. Six platforms were checked against their own
official help centers, documentation, developer docs, or (where a platform
has no independent help site) their own product/marketing pages: Salesforce
Sales Cloud, HubSpot Sales Hub, Microsoft Dynamics 365 Sales, Membrain,
Pipeliner CRM, and Zoho CRM. Third-party blog posts, comparison articles,
and AppExchange/Marketplace listings from independent vendors are called
out explicitly as such wherever they appear below — they are not treated as
the platform vendor's own claim.

*Note on Pipeliner CRM's name:* mid-research, `pipelinersales.com` was found
to redirect (HTTP 301) to `coevera.com`; the destination page is footer-
branded with the old pipelinersales.com identity and industry press
confirms Pipelinersales Corporation relaunched its CRM under the new name
Coevera. This is referred to as "Pipeliner CRM (now Coevera)" below.
Source: [Coevera — Sales Methodologies / Selling Techniques](https://www.coevera.com/sales-methodologies-shortcut/selling-techniques/)
(redirected from pipelinersales.com);
[PR Newswire — Pipeliner CRM Relaunches as Coevera](https://www.prnewswire.com/news-releases/pipeliner-crm-relaunches-as-coevera-the-first-crm-built-to-empower-and-develop-salespeople-not-just-track-them-302738413.html).

### 1. Salesforce Sales Cloud

Salesforce's own Help documentation describes **Path**, a configurable
per-object/per-picklist/per-record-type visual guide for opportunities (and
other objects) that lets an admin define, per stage, "key fields" shown to
guide a rep, plus free-text "Guidance for Success" content and a completion
celebration. Path's key fields are guidance only — Path itself does not
require or block on them; enforcing that a field be filled before a stage
change needs a separate Validation Rule. Source: [Salesforce Help — Considerations and Guidelines for Creating Paths](https://help.salesforce.com/s/articleView?language=en_US&id=sales.path_considerations.htm&type=5).
Path is a generic, admin-configured stage-guidance mechanism — it names no
sales methodology and ships no methodology-specific field set by default.

Salesforce's own Help documentation also describes **Einstein Opportunity
Scoring**, which assigns each opportunity a 1–99 score. Per Salesforce's own
explanation, "Einstein analyzes your and your team's past closed
opportunities (both closed-won and closed-lost) to build a scoring model,"
using machine learning rather than manually captured qualification
criteria. Source: [Salesforce Help — Understand How Einstein Scores Your Opportunities](https://help.salesforce.com/s/articleView?id=einstein_sales_opportunity_scoring_how_it_works.htm&language=en_US&type=5).
This is architecturally the same category of feature as Odoo's own
Predictive Lead Scoring (Phase 2 above): an internal, historical-data-driven
win-probability estimate, not a captured record of the buyer's own stated
Metrics/Pain/Economic Buyer/etc.

Salesforce also ships **Cadences** (via Sales Engagement / Cadence
Builder), which sequence outreach steps (calls, emails) with attached call
scripts and email templates per step. Source: [Salesforce Help — Cadence Builder Classic Cadences](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.hvs_cadences.htm&language=en_us).
Cadences structure *prospecting activity sequencing*, not opportunity
qualification content, so they do not substitute for any of the eight
methodologies' own required fields.

No page under `help.salesforce.com` was found naming MEDDIC, MEDDPICC,
Challenger, SPIN, Sandler, Solution Selling, ValueSelling, CustomerCentric
Selling, or Consultative Selling. The only Salesforce-platform artifact
found for MEDDIC is **"MEDDIC Opportunity Management"** on Salesforce
AppExchange, published by iSEEit GmbH — an independent third-party ISV, not
Salesforce itself — describing itself as "the Official and First MEDDIC app
on Salesforce.com," embedding qualification screens, an org-chart buying-
circle mapper, and Close Plan features directly into the Opportunity page
layout. Source: [Salesforce AppExchange — MEDDIC Opportunity Management](https://appexchange.salesforce.com/appxListingDetail?listingId=a0N3000000Dpa1UEAR)
(third-party listing, not a Salesforce-authored page).
Conclusion for Salesforce: **no methodology is natively named or shipped**;
Path/key-fields is the generic configurable mechanism (Odoo's Properties
analog), and MEDDIC support specifically exists only as a paid third-party
AppExchange app.

### 2. HubSpot Sales Hub

HubSpot's own Knowledge Base describes **custom deal properties** as a
generic, no-code mechanism: an admin picks an object (Deals among them) and
creates a property via a UI or an AI-assisted "Create with Data Agent"
generator. Source: [HubSpot Knowledge Base — Create and edit properties](https://knowledge.hubspot.com/properties/create-and-edit-properties).
This confirmed page makes no mention of MEDDIC or any other named
methodology.

HubSpot's own Knowledge Base also describes **Playbooks**: admin-authored
"interactive content cards" attached to contact/company/deal/ticket
records, built from free text, links, images, embedded knowledge-base
articles, and "questions" fields that map answers back onto record
properties. Source: [HubSpot Knowledge Base — Use playbooks](https://knowledge.hubspot.com/playbooks/use-playbooks).
The only templates it offers out of the box are generic "Sales playbook"
and "Service playbook" starting points — the page names no sales
methodology. (A preliminary web-search summary, before this page was
fetched directly, suggested HubSpot's own playbooks feature "can include
questions related to MEDDIC" — the fetched Knowledge Base article itself
contains no such reference, so that claim is not repeated as fact here; it
likely conflated a customer's own configured playbook content with a
product feature.)

HubSpot's own **blog** (`blog.hubspot.com`, not the product Knowledge Base)
carries educational articles naming and explaining most of the eight
methodologies individually — e.g. "Inside the MEDDIC sales qualification
process," a SPIN Selling deep dive, and a roundup titled "12 best sales
methodologies & customer-centric selling systems" that names SPIN,
Conceptual Selling, SNAP Selling, The Challenger Sale, Sandler Sales, and
CustomerCentric Selling by name. Source: [HubSpot Blog — Inside the MEDDIC sales qualification process](https://blog.hubspot.com/sales/a-step-by-step-guide-to-the-meddic-sales-qualification-process);
[HubSpot Blog — 12 best sales methodologies & customer-centric selling systems](https://blog.hubspot.com/sales/6-popular-sales-methodologies-summarized).
This is HubSpot naming the methodologies in its own educational content,
not shipping them as product features — the distinction matters because it
would be easy to mistake blog coverage for product support.
A dedicated third-party MEDDIC app, **"Meddicc Score,"** exists on the
HubSpot ecosystem marketplace and analyzes existing HubSpot activity data
to pre-fill MEDDICC/MEDDPICC/BANT/SPICED/etc. fields, per its own listing —
again a third-party integration, not native HubSpot functionality. Source: [HubSpot Ecosystem Marketplace — Meddicc Score](https://ecosystem.hubspot.com/marketplace/apps/meddicc-score).
Conclusion for HubSpot: **no methodology is natively named or shipped** as
structured fields; custom deal properties and freeform Playbooks are the
generic configurable mechanisms, and MEDDIC support again exists only via a
paid third-party marketplace app.

### 3. Microsoft Dynamics 365 Sales

Microsoft's own Learn documentation describes **custom fields on the
Opportunity (and Opportunity Close) entity** as a standard, no-code
customization: an admin adds a field (Microsoft's own example is a "Profit
Margin" field on Opportunity Close) and publishes the customization.
Source: [Microsoft Learn — Enable customization of Opportunity Close form](https://learn.microsoft.com/en-us/dynamics365/sales/enable-opportunity-close-customization).
This is the same generic, admin-configured-custom-field pattern as Odoo's
Properties, Salesforce's custom fields, and HubSpot's custom deal
properties.

Microsoft's own Learn documentation describes **predictive lead and
opportunity scoring**, which — like Salesforce's Einstein Opportunity
Scoring and Odoo's Predictive Lead Scoring — trains a model on the
organization's own historical won/lost records (Microsoft's own
documentation specifies a minimum of "40 won opportunities and 40 lost
opportunities... created in the past two years") rather than capturing
manually-entered qualification criteria. Source: [Microsoft Learn — Lead and opportunity scoring](https://learn.microsoft.com/en-us/dynamics365/sales/digital-selling-scoring).

Microsoft's own Learn documentation describes **Sales Accelerator**, which
surfaces a prioritized "Up next" work queue driven by configurable
"sequences" of activities/recommendations attached to records (leads,
opportunities, or custom tables). Source: [Microsoft Learn — Use the sales accelerator](https://learn.microsoft.com/en-us/dynamics365/sales/digital-selling-sales-accelerator).
Sequences structure *seller activity cadence*, similar in category to
Salesforce Cadences — they do not carry named qualification-methodology
fields.

Targeted searches scoped to `learn.microsoft.com` for MEDDIC, MEDDPICC,
Challenger, SPIN Selling, Sandler, and Solution Selling — including across
the Dynamics 365 Sales training paths/modules index — returned no matching
Microsoft Learn page or module. Conclusion for Dynamics 365 Sales: **no
methodology is natively named or shipped**; custom fields on
Opportunity/Opportunity Close are the generic configurable mechanism, and
Sales Accelerator/predictive scoring are generic activity-sequencing and
ML-scoring features respectively, not methodology-specific ones.

### 4. Membrain

Membrain's own Help Center describes **Scorecards** as user-defined
structures, not pre-built methodology templates: "Score Cards are simply
custom fields created to capture data, but with additional functionality,"
built by "documenting key elements of your sales process that you believe
have a big impact on its potential success or failure" and then adding
"questions... with a range of answers and a structure for how you would
like to score each answer." Source: [Membrain Help Center — Scorecards](https://www.membrain.com/help-center/process-tools/scorecards).
Membrain's own Help Center similarly describes **Playbooks** as a generic
tool to "control and dynamically change your sales processes based on
conditions you specify," illustrated with generic examples (competitor
selected, stakeholder count, activity thresholds) rather than any named
methodology's fields. Source: [Membrain Help Center — Playbooks](https://www.membrain.com/help-center/process-tools/playbooks).
Membrain's own product page for its Sales Enablement offering similarly
describes "preset and customizable benchmarks" and the ability to "Create
and iterate sales processes easily" without naming MEDDIC, MEDDPICC,
Sandler, Challenger, SPIN, Solution Selling, or CustomerCentric Selling
anywhere on the page. Source: [Membrain — Sales Enablement](https://www.membrain.com/sales-enablement).

Membrain's own **Edition Partners** page — the closest thing Membrain has
to "pre-built methodology support" — lists five partner-built, pre-
configured editions: Baseline Selling, Winning by Design, SalesStar
("STAR Consultative Selling"), Inflexion Point ("Outcome-Centric Selling"),
and Predictable Prospecting ("Pipeline Table of Elements"). Source: [Membrain — Edition Partners](https://www.membrain.com/edition-partners).
Notably, **none of the five listed editions is MEDDIC/MEDDPICC, Sandler, or
Challenger** by name — despite Membrain's broader market positioning as a
CRM for structured, methodology-driven selling, its own edition-partners
page names only Baseline Selling and a generically-branded "STAR
Consultative Selling" (SalesStar) among the eight methodologies scoped by
this research. Conclusion for Membrain: **no MEDDIC/MEDDPICC, Sandler, or
Challenger support is natively named**; Membrain's own Scorecards and
Playbooks are a generic, admin-configured qualification/process mechanism —
the same category of feature as Odoo's Properties, just marketed under
sales-enablement branding rather than as a "custom field" admin setting.
Its SalesStar partner edition is the one instance found of a
Consultative-Selling-branded pre-configured offering, and its Inflexion
Point edition is built specifically around "Outcome-Centric Selling" (an
adjacent but distinct value-based methodology, not one of the eight scoped
here).

### 5. Pipeliner CRM (now Coevera)

Coevera's own site (redirected from pipelinersales.com, see the note above)
carries a page listing eleven sales methodologies it claims to support:
SPIN Selling, Conceptual Selling, SNAP Selling, Challenger Sale, Solution
Selling, CustomerCentric Selling, Strategic Selling, ValueSelling
Framework, RAIN Selling, Baseline Selling, and Hoffeld Selling. Source: [Coevera — Selling Techniques](https://www.coevera.com/sales-methodologies-shortcut/selling-techniques/)
(redirected from pipelinersales.com/sales-methodologies-shortcut/selling-techniques/).
Its dedicated CustomerCentric Selling sub-page makes only a generic
customization claim rather than describing named fields: "Because it is
fully, rapidly and visually customizable, Coevera will accommodate and
empower any of these methodologies." Source: [Coevera — CustomerCentric Selling](https://www.coevera.com/sales-methodologies-shortcut/customercentric-selling/)
(redirected from pipelinersales.com/sales-methodologies-shortcut/customercentric-selling/).
Neither page describes a single named, structured field or screen shipped
specifically for any of the twelve listed methodologies — the pattern is
identical across all of them: name the methodology, then claim the CRM's
general-purpose customizability ("fully, rapidly and visually
customizable") accommodates it.

Notably, **MEDDIC/MEDDPICC and the Sandler Selling System do not appear** in
Coevera's own list of eleven supported methodologies, despite the task's
premise that Pipeliner markets multi-methodology support broadly — its own
page's specific list stops short of naming those two. Conclusion for
Pipeliner CRM/Coevera: **no methodology ships as named, structured
fields**; the platform's own marketing describes generic visual
customizability (pipeline/field customization) as the mechanism for
accommodating whichever methodology a customer already uses — the same
category of claim made for Odoo's Properties and `crm.stage`, just phrased
as a sales pitch rather than a technical capability list.

### 6. Zoho CRM

Zoho's own Help documentation describes **Blueprint**, a drag-and-drop
process-flow builder: "Zoho CRM's Blueprint is simply an online replica of
your business process. It captures every detail of your entire offline
process within the software," built around states of a picklist field
(typically Deal Stage) with defined transitions that can require fields to
be filled and can trigger automations. Source: [Zoho CRM Help — Blueprint: An Overview](https://help.zoho.com/portal/en/kb/crm/customize-crm-account/blueprint/articles/blueprint-an-overview).
This is a generic, admin-configured mechanism — Zoho's own page names no
sales methodology.

Zoho's own CRM glossary page, fetched directly, contains **no entries** for
MEDDIC, Challenger Sale, SPIN Selling, Sandler, Solution Selling,
ValueSelling, or Consultative Selling, confirming these are not part of
Zoho's own product terminology. Source: [Zoho CRM — Glossary](https://www.zoho.com/crm/resources/glossary.html).
Zoho's own blog (`zoho.com/blog`) has, however, promoted a third-party
Zoho Marketplace app — **"Meddicc Score"** — which "integrates directly
into Zoho CRM to automate the sales qualification process using advanced
AI" against MEDDICC/MEDDPICC/BANT/SPICED and similar frameworks; the post
itself frames this explicitly as a marketplace add-on ("App Spotlight
brings you hand-picked solutions that enhance your Zoho apps and tools"),
not a native CRM feature. Source: [Zoho Blog — App Spotlight: Meddicc Score for Zoho CRM](https://www.zoho.com/blog/marketplace/app-spotlight-meddicc-score-for-zoho-crm.html).
Conclusion for Zoho CRM: **no methodology is natively named or shipped**;
Blueprint (process/field enforcement) and custom fields are the generic
configurable mechanism, and MEDDIC support again exists only via a
third-party marketplace app.

### Summary comparison table

"Native/named" means the platform's own documentation describes a
structured field set or screen shipped specifically for that methodology.
"Configurable only" means the platform's own marketing/docs claim the
methodology can be built using a generic mechanism (custom fields, Path,
Blueprint, Scorecards, Properties) — the methodology itself is not shipped.
"3rd-party app only" means the only implementation found is a paid,
independently-published marketplace/AppExchange add-on, not anything from
the platform vendor. "No support found" means no primary-source evidence
of any of the above was located.

| Methodology | Salesforce | HubSpot | Dynamics 365 | Membrain | Pipeliner/Coevera | Zoho CRM |
|---|---|---|---|---|---|---|
| CustomerCentric Selling | No support found | No support found | No support found | No support found | Configurable only (named on marketing page) | No support found |
| Solution Selling | No support found | No support found | No support found | No support found | Configurable only (named on marketing page) | No support found |
| SPIN Selling | No support found | No support found (blog content only) | No support found | No support found | Configurable only (named on marketing page) | No support found |
| The Challenger Sale | No support found | No support found (blog content only) | No support found | No support found (blog content only) | Configurable only (named on marketing page) | No support found |
| MEDDIC / MEDDPICC | 3rd-party app only (iSEEit, AppExchange) | 3rd-party app only (Meddicc Score) | No support found | No support found (not in Membrain's own edition list) | No support found (not in Coevera's own methodology list) | 3rd-party app only (Meddicc Score) |
| Sandler Selling System | No support found | No support found (blog content only) | No support found | No support found (not in Membrain's own edition list) | No support found (not in Coevera's own methodology list) | No support found |
| ValueSelling Framework | No support found | No support found | No support found | No support found | Configurable only (named on marketing page) | No support found |
| Consultative Selling (umbrella) | No support found | No support found (blog content only) | No support found | Configurable, partner-branded ("STAR Consultative Selling" edition) | Configurable only (named on marketing page) | No support found |

Every platform in this table also ships a generic, no-code custom-field
mechanism that *could* be configured toward any of these methodologies —
Salesforce's custom fields/Path key-fields, HubSpot's custom deal
properties, Dynamics 365's custom fields on Opportunity, Membrain's
Scorecards/Playbooks, Pipeliner/Coevera's customizable pipeline fields, and
Zoho's Blueprint/custom fields — architecturally the same category of
feature as Odoo's `crm.lead.lead_properties`/Properties mechanism
documented in Phase 2. None of the six platforms was found, via its own
primary sources, to ship MEDDIC/MEDDPICC, Sandler, Challenger, SPIN,
Solution Selling, ValueSelling, or CustomerCentric Selling as native,
out-of-the-box structured fields — the pattern Phase 2 found for Odoo
(generic configurability, no named native support) turns out to be the
industry norm, not an Odoo-specific gap, for these eight methodologies
specifically.

### Patterns worth borrowing for Odoo

- **Stage-scoped key fields, paired with separate enforcement (Salesforce
  Path).** Salesforce's Path lets an admin attach "key fields" to a specific
  stage of a specific object/record-type combination, so a rep is shown
  particular fields only when the opportunity reaches that stage — distinct
  from Odoo's `crm.lead.lead_properties`, which are available uniformly
  regardless of stage. Path's own Key Fields are guidance only, not
  enforced: making a stage's fields actually required needs a separate
  Validation Rule that checks the stage and the field. Combining "which
  fields are relevant at this stage" (Path's job) with "block advancing
  until they're filled" (a Validation Rule's job) is a concrete pattern for
  "fill in the Economic Buyer before this deal reaches Proposition" that
  Properties alone does not provide.
- **Freeform "Playbook" content blocks with answer-capturing questions
  (HubSpot Playbooks, Membrain Playbooks).** Both platforms let an admin
  attach a block of guided content (talking points, links, embedded
  knowledge-base articles) *and* discrete "question" fields whose answers
  write back to record properties — a middle ground between an open notes
  field and a rigid custom field, useful for methodologies like SPIN or
  CustomerCentric Selling whose value lies in the specific questions asked,
  not just that a conversation happened.
- **Conditional, rule-driven process branching (Membrain Playbooks, Zoho
  Blueprint).** Both let an admin define conditions (e.g. competitor
  selected, stakeholder count, deal size) that dynamically change which
  process steps or fields apply next, rather than a single fixed stage
  list — closer to a real qualification workflow than Odoo's uniform
  `crm.stage` sequence.
- **User-defined scoring rubrics distinct from ML-based scoring (Membrain
  Scorecards).** Membrain's Scorecards let an admin define named questions
  each with a weighted 1–5 (or similar) answer scale that rolls up into a
  visible opportunity-strength indicator — a manager-legible, rules-based
  score built from the *qualification content itself*, as opposed to
  Odoo's/Salesforce's/Microsoft's shared pattern of an opaque ML score
  trained on historical win/loss data. A MEDDIC-style rubric (Economic
  Buyer identified? Champion tested? Paper Process known?) maps naturally
  onto this pattern in a way it does not onto a black-box probability.
- **Partner-published, pre-configured methodology "editions" (Membrain
  Edition Partners).** Rather than Membrain itself shipping a MEDDIC
  screen, outside sales-methodology experts publish a ready-made
  configuration (fields, stages, playbooks, scorecards already set up for
  their methodology) that a customer installs as a starting point. This
  separates "the generic configurable mechanism" (Membrain's own job) from
  "a specific methodology's field set" (a partner's job) — a packaging
  pattern Odoo's module system (a MEDDIC-fields module bolted onto
  `crm.lead.lead_properties`) could mirror directly.

## Unverified / could not confirm

- **The stated relationship between Solution Selling and CustomerCentric
  Selling** (that Bosworth developed the latter partly as a successor to
  or critique of the former). Multiple secondary sources describe Bosworth
  as the author of both, but neither customercentric.com's own About page
  (fetched in full) nor Richardson's current Solution Selling® page
  mentions the other methodology or states this relationship in their own
  words.
- **Bosworth founding Solution Selling in 1983, based on research at
  Xerox.** This appears only in WebSearch result summaries of secondary
  sources (e.g. sales-methodology blogs), not in the fetched text of
  Richardson's own Solution Selling® page (which does not mention Bosworth
  at all) or McGraw-Hill's own book page (which gives an original
  copyright year of 1995 but no 1983 founding claim).
- **Whether "Frank Watts" coined the term "solution selling" in the 1970s
  before Bosworth.** This claim appeared only in a WebSearch synthesis of
  secondary sources, with no primary source located to confirm it.
- **MEDDIC's precise origin/attribution.** MEDDIC Academy's own site
  attributes the framework to a team effort at PTC "including Darius
  Lahoutifard and approximately a dozen sales managers," while the
  MEDDICC (a differently-branded platform) site instead specifically
  labels Dick Dunkel "creator of the MEDDIC framework." Both are primary
  (each organization's own claim about itself/its principal), but they are
  not consistent with each other, and this research could not adjudicate
  between them.
- **The specific steps/structure of Mack Hanan's own "Consultative
  Selling" formula.** The current publisher's own product pages
  (harpercollinsleadership.com, hcleadershipessentials.com) could not be
  fetched (403 Forbidden and connection refused respectively in this
  session); only bookseller listing pages (Amazon) were reachable, and
  those confirm bibliographic facts (title, author, edition count,
  publisher) but not a description of the methodology's own steps.
- **Whether Odoo's `supported_versions`-style feature-comparison pages or
  Odoo's own marketing pages (odoo.com/app/crm, odoo.com/app/crm-features)
  reference any of the eight methodologies by name.** These were not
  fetched in this session because the documentation- and source-level
  checks (Phase 2, above) already returned a clear negative and the task
  instructions treat marketing pages as a secondary supplement only, not a
  substitute for a documentation/source-level check.
- **Odoo's internal Predictive Lead Scoring model's exact algorithm.**
  `addons/crm/models/crm_lead_scoring_frequency.py` and
  `res_config_settings.py` were read for field names and configuration
  parameters, but the scoring computation itself lives elsewhere in the
  CRM module and was not traced in this session; only the field-level
  claims above (that it is a stored, computed win-probability rather than
  a captured buyer-stated ROI figure) are asserted.
- **Whether Zoho's own CRM Academy site independently discusses MEDDIC as
  educational content, separate from the third-party marketplace app.** A
  WebSearch surfaced a Japanese-language page at
  `zoho.com/jp/crm/academy/conceptual/meddic/` that appears to explain
  MEDDIC conceptually on Zoho's own domain, but this session could not
  fetch and read that page directly (only a search-result snippet was
  seen, and it is not in English), so it is not asserted as a confirmed
  Zoho-authored claim above — only the fetched, English-language Zoho CRM
  glossary page (which contains no MEDDIC entry) is cited as confirmed.
- **Whether Salesforce's Trailhead platform (trailhead.salesforce.com, a
  distinct property from help.salesforce.com) has any module that names
  one of the eight methodologies.** Search results surfaced only generic
  Path/Sales-Cloud-fundamentals Trailhead modules; no module title or
  description naming a specific methodology was found, but Trailhead's
  full module catalog was not exhaustively enumerated in this session.
- **Whether HubSpot's Sales Hub product (as opposed to its Knowledge Base
  or blog) ships any AI-driven "deal health" or similar feature that
  internally references a named methodology.** This was not checked in
  this session; only Playbooks and custom deal properties were confirmed
  against HubSpot's own Knowledge Base.
- **The exact mechanics of Membrain's partner-built "editions"** (e.g.
  whether the SalesStar "STAR Consultative Selling" edition or the
  Inflexion Point "Outcome-Centric Selling" edition actually ships named,
  structured fields once installed, versus just a pre-populated Scorecard/
  Playbook configuration). Membrain's own Edition Partners page names the
  editions and their methodology branding but this session did not find or
  fetch a page detailing the installed field-level content of any specific
  edition.

## Phase 4 — Addendum (2026-09-01): Odoo edition split and a deeper competitor comparison

Added 2026-09-01, extending the research above with two further questions: (A)
whether this repo's vendored Odoo source is Community or Enterprise, and what
Odoo's own Enterprise CRM adds beyond Community; and (B) a deeper look at the
specific tier/pricing/configurability of the three competitor features
flagged as closest analogs in Phase 3 — Salesforce Path, HubSpot Playbooks,
and Membrain Scorecards — checked against each vendor's *current* (2026-09-01)
pricing and documentation pages. The same sourcing rule as Phases 1–3
applies: every claim is checked against a primary source (the vendor's own
site, or this repo's own vendored code) and anything not confirmed that way
is stated as such rather than asserted.

### Section A — Odoo Community vs Enterprise split

**A1. This repo's vendored source is Community edition (LGPL-3), not
Enterprise.** Every manifest checked declares `'license': 'LGPL-3'`, which is
Odoo's own marker for Community-licensed code (Enterprise modules are
licensed OEEL-1, the Odoo Enterprise Edition License):

| Module | `__manifest__.py` license key |
|---|---|
| `addons/crm/__manifest__.py` | `'license': 'LGPL-3'` |
| `addons/sale_crm/__manifest__.py` | `'license': 'LGPL-3'` |
| `addons/sales_team/__manifest__.py` | `'license': 'LGPL-3'` |
| `addons/mail/__manifest__.py` | `'license': 'LGPL-3'` |

Source: `addons/crm/__manifest__.py`, `addons/sale_crm/__manifest__.py`,
`addons/sales_team/__manifest__.py`, `addons/mail/__manifest__.py` (this
repo, vendored Odoo 19 source).
Corroborating evidence: a repo-wide search under `addons/` found no
`enterprise/` directory and no file anywhere under `addons/crm/`,
`addons/sale_crm/`, `addons/sales_team/`, or `addons/mail/` containing the
string `OEEL` (Odoo's Enterprise license identifier) — the pattern this repo
would show if any Enterprise-licensed module were vendored alongside the
Community ones. Source: directory listing and grep of `addons/` (this repo).
This repo's own custom `crm_methodology` module (the module whose
Requirements/Checkpoints/Enforcement system this addendum compares against)
is itself also licensed `'license': 'LGPL-3'`, per
`custom_addons/crm_methodology/__manifest__.py` (this repo).

**A2. What Odoo's own site says Enterprise/Custom adds beyond Community, for
CRM specifically.** Odoo restructured its commercial offering since Phase 1–3
were written: `odoo.com/pricing-plan` (fetched 2026-09-01) no longer frames
the split as "Community vs Enterprise" but as **Standard** ($7.95/user/month,
billed yearly, Odoo Online hosting only) vs **Custom** ($10.90/user/month,
billed yearly — adds flexible hosting including "Download Odoo Enterprise and
host it yourself" or Odoo.sh, Odoo Studio access, multi-company support, and
external API access). Source: [Odoo — Pricing Plan](https://www.odoo.com/pricing-plan)
(fetched 2026-09-01). Both tiers include "all apps," and the fetched page
text draws no CRM-specific feature distinction between Standard and Custom —
it names no lead-scoring, AI, forecasting, or qualification-checklist
difference between the two.

Odoo's own dedicated editions-comparison page,
[odoo.com/page/editions](https://www.odoo.com/page/editions) (fetched
2026-09-01), states in its own words: "Odoo Community is the core upon which
Odoo Enterprise is built — and you can switch versions at any time." Its
feature-comparison table lists CRM and Sales as rows linking to
`odoo.com/app/crm-features` and `odoo.com/app/sales-features`, but the
page's checkmark grid did not render as fetchable text in this session (it
appears to be populated by client-side JavaScript), so this addendum cannot
quote which specific checkmarks differ for the CRM row — that gap is listed
under Unverified below rather than guessed at. The only differences this
session *could* confirm from that page's fetched text are in other app
areas entirely: Mobile (Android/iOS), Payroll, Spreadsheet, Manufacturing
Shopfloor/Control Panel/Scheduling, and advanced Timesheet features — none
of them CRM/Sales.

Odoo's own CRM features marketing page,
[odoo.com/app/crm-features](https://www.odoo.com/app/crm-features) (fetched
2026-09-01), lists **Predictive Lead Scoring** ("Odoo computes the
probability of success according to several criteria such as past
performance") among the CRM app's headline features, without marking it
Enterprise-only anywhere in the fetched text — and this matches Phase 2's
own finding above, which already traced `crm.lead.scoring.frequency` and the
`predictive_lead_scoring_fields`/`predictive_lead_scoring_start_date`
settings directly in this repo's Community-licensed `addons/crm/` source
(see `addons/crm/models/crm_lead_scoring_frequency.py`,
`addons/crm/models/res_config_settings.py`). In other words: **Predictive
Lead Scoring is confirmed, by this repo's own vendored LGPL-3 code, to be a
Community-edition feature, not an Enterprise upsell.** Odoo 19's own
documentation for the feature,
[Assign leads with predictive lead scoring](https://www.odoo.com/documentation/19.0/applications/sales/crm/track_leads/lead_scoring.html)
(fetched 2026-09-01), describes it as "a machine-learning model that uses
historical data from Odoo CRM to score open leads/opportunities" (a
naive-Bayes-style model over fields such as assigned salesperson, lead
source, language, and contact-information quality) and states no
edition/licensing restriction anywhere in the fetched page text.

The same Odoo 19 documentation index page,
[CRM (19.0)](https://www.odoo.com/documentation/19.0/applications/sales/crm.html)
(fetched 2026-09-01), lists a **Forecast report** under "Analyze
Performance," alongside Pipeline Analysis and Expected Revenue report — this
is revenue/pipeline forecasting (a report over `expected_revenue` and
stage/probability data), not a qualification-methodology feature, and no
edition restriction is stated for it either in the index or in its
immediate surrounding navigation text.

**A3. Conclusion: not offered.** Based on everything fetched from Odoo's own
site and documentation in this session, Odoo Enterprise (in either its old
"Enterprise" framing or its current "Custom" pricing-tier framing) does
**not** ship anything equivalent to `crm_methodology`'s configurable
Requirements/Checkpoints/Enforcement system — a mechanism where an admin
defines named, per-methodology qualification fields, assigns each one a
specific lifecycle checkpoint (Quotation Created / Marked Won / Marked Lost
/ Continuous, per `custom_addons/crm_methodology/models/crm_methodology_requirement.py`),
and sets a Block-vs-Warn enforcement level per requirement, gating the
`action_set_won` transition on the Block-level ones (per
`custom_addons/crm_methodology/models/crm_lead.py`,
`_check_methodology_checkpoint`). No page fetched in this session — the
pricing plan page, the editions-comparison page (to the extent its text
rendered), the CRM features page, the CRM documentation index, or the
predictive-lead-scoring doc page — describes a comparable named-methodology,
per-checkpoint, block-vs-warn field-gating mechanism as either a Community or
an Enterprise/Custom feature. The two Odoo mechanisms that come closest by
category are (a) the `lead_properties`/`PropertiesDefinition` system already
covered in Phase 2, which is itself Community-licensed (confirmed in
`addons/crm/models/crm_team.py`, `addons/crm/models/crm_lead.py`, under the
`LGPL-3` manifest above) and offers arbitrary named fields but no
checkpoint/enforcement concept, and (b) Predictive Lead Scoring, also
Community, which is an opaque ML probability rather than a captured,
per-requirement qualification checklist — the same distinction Phase 2 (see
"MEDDIC / MEDDPICC" notes) already draws for it. Neither is Enterprise-gated,
and neither is what `crm_methodology` provides, so the honest characterization
is **"not offered"** at either edition, not "partially offered by Enterprise
and missing from Community."

### Section B — Deepening the competitor comparison

Phase 3 already established that Salesforce Path, HubSpot Playbooks, and
Membrain Scorecards/Playbooks are each a *generic, admin-configured*
qualification mechanism rather than a named, out-of-the-box methodology.
This addendum adds the specific tier/price gate and a closer read of each
one's configurability, using each vendor's own pricing and documentation
pages as fetched on 2026-09-01 (a later date than Phase 3's 2026-08-31
research, so prices reflect that day's posted list pricing and may already
differ from Phase 3's framing of these platforms).

**1. Salesforce Path (Sales Cloud).**
*Tier/cost.* Salesforce's own current pricing page,
[salesforce.com/sales/pricing](https://www.salesforce.com/sales/pricing/)
(fetched via browser 2026-09-01), lists five/six tiers: Starter Suite ($25
USD/user/month), Pro Suite ($100 USD/user/month, billed annually), Enterprise
($175 USD/user/month, billed annually), Unlimited ($350 USD/user/month,
billed annually), and Agentforce 1 Sales ($550 USD/user/month, billed
annually) — this is a different, simplified tier-naming scheme than the
"Essentials/Group/Professional/Enterprise/Performance/Unlimited" naming still
used in Salesforce's own Help Center. Path's own Help Center page states its
own required editions directly: "Available in: Essentials, Group,
Professional, Enterprise, Performance, Unlimited, and Developer Editions" —
i.e. Path is bundled broadly, not reserved for a top tier, under that
(older) naming. Source: [Salesforce Help — Considerations and Guidelines for
Creating Paths](https://help.salesforce.com/s/articleView?language=en_US&id=sales.path_considerations.htm&type=5)
(fetched via browser 2026-09-01). This session could not confirm, from a
fetched primary source, the exact mapping between that classic-edition list
and the current Starter Suite/Pro Suite/Enterprise/Unlimited pricing names —
see Unverified below.
*Configurability.* Per Phase 3's own already-cited finding (unchanged by this
addendum): Path's "key fields" are stage-scoped guidance only, not
enforcement — making a field required at a given stage needs a separate
Validation Rule layered on top. So Path plus Validation Rules can reach
"required field X at stage Y," but Salesforce's own documentation does not
describe a single mechanism offering `crm_methodology`'s three-way
combination of arbitrary named methodologies, a warn-vs-block distinction
per field, and checkpoints tied to lifecycle *actions* (Quotation
Created/Marked Won/Marked Lost) rather than only to pipeline *stages*.
*Verdict:* Path (+ Validation Rules) reaches stage-scoped required fields but
has no native warn-vs-block distinction and no per-methodology field-set
switching, so it covers a narrower slice of what `crm_methodology` does.

Separately, **Einstein Opportunity Scoring** — the closest Salesforce
feature to Odoo's Predictive Lead Scoring — is explicitly tier-gated, per
Salesforce's own Help Center: "Available with Sales Cloud Einstein, which is
available in Performance and Unlimited Editions, and for an extra cost in
Enterprise Edition" and "Available to eligible customers for no extra cost
in: Enterprise, Performance, and Unlimited Editions." Source: [Salesforce
Help — Understand How Einstein Scores Your Opportunities](https://help.salesforce.com/s/articleView?id=einstein_sales_opportunity_scoring_how_it_works.htm&language=en_US&type=5)
(fetched via browser 2026-09-01). Mapped loosely onto the current pricing
names, that means the ML-scoring feature needs Enterprise ($175/user/month)
or above — unlike Odoo's Predictive Lead Scoring, which (per Section A above)
ships in Odoo's free-to-self-host Community edition. This is a genuine,
confirmed asymmetry between the two platforms' ML-scoring features, distinct
from — and not to be confused with — the qualification-gating comparison
above, since (as Phase 2 already establishes) neither platform's ML score is
itself a substitute for captured qualification-checklist data.

**2. HubSpot Playbooks (Sales Hub).**
*Tier/cost.* HubSpot's own current pricing page,
[hubspot.com/pricing/sales](https://www.hubspot.com/pricing/sales) (fetched
2026-09-01), lists Free ($0/month), Starter ($7/month/seat billed annually,
$20/month/seat billed monthly), Professional ($90/month/seat billed
annually, $100/month/seat billed monthly), and Enterprise ($150/month/seat,
with custom pricing available). Per that page's own feature-comparison
table, **Playbooks first appear at the Professional tier** ("Create up to
5,000 playbooks. Embed properties or capture notes in playbooks."), with the
same capability carried into Enterprise; Free and Starter list no Playbooks
entitlement. Source: [HubSpot — Sales Hub Pricing](https://www.hubspot.com/pricing/sales)
(fetched 2026-09-01).
*Configurability.* Per Phase 3's own already-cited finding (unchanged by this
addendum): a Playbook is free-text/link/image/knowledge-base content plus
"questions" whose answers write back onto record properties — a flexible,
admin-authored content structure, but HubSpot's own Knowledge Base article
describes no checkpoint concept (Playbooks are opened by a rep during a
call/record view, not gated to a stage transition or a Won/Lost action) and
no block-vs-warn enforcement distinction; a Playbook's questions can at most
be marked as producing a property value, not as blocking a pipeline
transition. Source: [HubSpot Knowledge Base — Use playbooks](https://knowledge.hubspot.com/playbooks/use-playbooks)
(cited already in Phase 3, re-confirmed here).
*Verdict:* Playbooks are more rigid than `crm_methodology` in the dimension
that matters most for qualification-gating — there is no native block/warn
enforcement or lifecycle-checkpoint concept at all, only content-plus-answer
capture, and that capability itself is withheld below the $90–100/seat/month
Professional tier.

**3. Membrain Scorecards.**
*Tier/cost.* Membrain's own pricing page,
[membrain.com/pricing](https://www.membrain.com/pricing) (fetched
2026-09-01), lists Prospecting ($49/user/month), Active Pipeline
($69/user/month), Account Growth ($89/user/month), and a coaching-focused
Elevate tier ($89/coach/month), plus paid add-ons (Tickets $29, Flows $19,
Content Hub $12) and platform upgrades (Insight Engine from $199, API+ $499,
Automation+ $299 — all per-org/month figures per that page). Per the same
page, **Score Cards are included starting at the entry Prospecting tier**
($49/user/month), and Active Pipeline additionally lists "Score Cards &
Probability Score"; the fetched page text does not list Score Cards under
Account Growth or Elevate. Source: [Membrain — Pricing](https://www.membrain.com/pricing)
(fetched 2026-09-01). This is a materially lower entry price than either
Salesforce's Path-bearing tiers or HubSpot's Playbooks-bearing Professional
tier — Scorecards are Membrain's base-tier headline feature, not an
upsell.
*Configurability.* Per Phase 3's own already-cited finding (unchanged by
this addendum): Membrain's own Help Center describes Scorecards as
fully user-defined — "Score Cards are simply custom fields created to
capture data, but with additional functionality," built by the admin
"documenting key elements of your sales process" and adding "questions...
with a range of answers and a structure for how you would like to score each
answer." Source: [Membrain Help Center — Scorecards](https://www.membrain.com/help-center/process-tools/scorecards)
(cited already in Phase 3, re-confirmed here). Membrain's own Playbooks
(a separate feature from Scorecards) add conditional, rule-driven branching —
"control and dynamically change your sales processes based on conditions you
specify" — closer to a checkpoint concept than Path or HubSpot's Playbooks,
though the fetched Help Center text still does not use a "block vs. warn"
vocabulary the way `crm_methodology`'s `enforcement` field does explicitly;
Membrain's own examples (competitor selected, stakeholder count, activity
thresholds) describe branching the *process*, not a two-level (block/warn)
severity on a single required field.
*Verdict:* of the three, Membrain's Scorecards+Playbooks combination comes
closest to `crm_methodology` — user-defined named scoring rubrics, available
at the lowest entry price of the three vendors, with rule-driven process
branching — but still without a first-class, explicit block-vs-warn
enforcement axis on individual fields the way `crm_methodology`'s
`enforcement` selection field provides.

### Addendum: additions to Unverified / could not confirm

- **The exact checkmark differences between Odoo Community and Enterprise/
  Custom for the CRM app specifically**, on `odoo.com/page/editions`. The
  page's own text confirms a comparison table exists with a CRM row, but its
  checkmark grid did not render as fetchable text in this session (likely
  client-side-JavaScript-populated), so no specific CRM-row difference can be
  quoted from it.
- **The mapping between Salesforce's current pricing-page tier names
  (Starter Suite / Pro Suite / Enterprise / Unlimited / Agentforce 1 Sales)
  and the classic edition names Salesforce's Help Center still uses
  (Essentials / Group / Professional / Enterprise / Performance / Unlimited /
  Developer) when stating feature-availability requirements such as Path's.**
  Both naming schemes were confirmed independently (pricing page vs. Help
  Center article) but no fetched page in this session states the
  correspondence between them explicitly.
- **Whether Odoo 19's Enterprise-only apps (outside CRM/Sales entirely, e.g.
  Odoo Studio, multi-company, the areas `odoo.com/page/editions` did confirm
  differ) have any indirect bearing on CRM — for example whether Odoo Studio,
  a Custom-tier feature per `odoo.com/pricing-plan`, could be used to build a
  Requirements/Checkpoints/Enforcement-equivalent system with no code.** This
  was out of scope for this addendum (Studio is a generic app-builder, not a
  CRM feature) and was not investigated.

## Sources

- [CustomerCentric Selling® — Sales Training Workshops](https://customercentric.com/)
- [CustomerCentric Selling — About](https://customercentric.com/about/)
- [McGraw Hill — Solution Selling (PB)](https://www.mheducation.com/highered/mhp/product/solution-selling-pb.html)
- [Richardson — Solution Selling®](https://www.richardson.com/sales-training-programs/sales-professionals/solution-selling/)
- [Huthwaite International — The SPIN Methodology](https://www.huthwaiteinternational.com/spin-methodology)
- [Huthwaite International — Fifty years of SPIN](https://www.huthwaiteinternational.com/fifty-years-of-spin)
- [Challenger Inc. — What is the Challenger Sales Methodology?](https://challengerinc.com/what-is-challenger-sales-methodology/)
- [MEDDIC Academy — What Is MEDDIC?](https://meddic.academy/definition-meddic/)
- [MEDDICC — MEDDICC welcomes Dick Dunkel, creator of MEDDIC framework](https://meddicc.com/resources/meddicc-welcomes-dick-dunkel)
- [meddpicc.net — MEDDPICC Definition](https://meddpicc.net/meddpicc-sales-definition/)
- [Sandler — The Sandler Selling System](https://sandler.com/sandler-selling-system/)
- [ValueSelling — The ValueSelling Framework®](https://www.valueselling.com/solutions/foundational-workshops/the-valueselling-framework)
- [ValueSelling — What Is ValueSelling?](https://www.valueselling.com/what-is-valueselling)
- [Amazon — Consultative Selling: The Hanan Formula for High-Margin Sales at High Levels](https://www.amazon.com/Consultative-Selling-Formula-High-Margin-Levels/dp/0814437508)
- [Odoo — CRM documentation (19.0)](https://www.odoo.com/documentation/19.0/applications/sales/crm.html)
- [Odoo 19.0 — Lead mining](https://www.odoo.com/documentation/19.0/applications/sales/crm/acquire_leads/lead_mining.html)
- [odoo/documentation — lost_opportunities.rst, 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/sales/crm/pipeline/lost_opportunities.rst)
- [odoo/documentation — manage_sales_teams.rst, 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/sales/crm/pipeline/manage_sales_teams.rst)
- `addons/crm/models/crm_lead.py` (this repo, vendored Odoo 19 source)
- `addons/crm/models/crm_stage.py` (this repo, vendored Odoo 19 source)
- `addons/crm/models/crm_team.py` (this repo, vendored Odoo 19 source)
- `addons/crm/models/res_config_settings.py` (this repo, vendored Odoo 19 source)
- `addons/crm/models/crm_lead_scoring_frequency.py` (this repo, vendored Odoo 19 source)
- `addons/crm/data/crm_stage_data.xml` (this repo, vendored Odoo 19 source)
- `addons/sale_crm/models/crm_lead.py` (this repo, vendored Odoo 19 source)
- `addons/mail/data/mail_activity_type_data.xml` (this repo, vendored Odoo 19 source)
- [Salesforce Help — Considerations and Guidelines for Creating Paths](https://help.salesforce.com/s/articleView?language=en_US&id=sales.path_considerations.htm&type=5)
- [Salesforce Help — Understand How Einstein Scores Your Opportunities](https://help.salesforce.com/s/articleView?id=einstein_sales_opportunity_scoring_how_it_works.htm&language=en_US&type=5)
- [Salesforce Help — Cadence Builder Classic Cadences](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.hvs_cadences.htm&language=en_us)
- [Salesforce AppExchange — MEDDIC Opportunity Management (iSEEit, third-party listing)](https://appexchange.salesforce.com/appxListingDetail?listingId=a0N3000000Dpa1UEAR)
- [HubSpot Knowledge Base — Create and edit properties](https://knowledge.hubspot.com/properties/create-and-edit-properties)
- [HubSpot Knowledge Base — Use playbooks](https://knowledge.hubspot.com/playbooks/use-playbooks)
- [HubSpot Blog — Inside the MEDDIC sales qualification process](https://blog.hubspot.com/sales/a-step-by-step-guide-to-the-meddic-sales-qualification-process)
- [HubSpot Blog — 12 best sales methodologies & customer-centric selling systems](https://blog.hubspot.com/sales/6-popular-sales-methodologies-summarized)
- [HubSpot Ecosystem Marketplace — Meddicc Score (third-party listing)](https://ecosystem.hubspot.com/marketplace/apps/meddicc-score)
- [Microsoft Learn — Enable customization of Opportunity Close form](https://learn.microsoft.com/en-us/dynamics365/sales/enable-opportunity-close-customization)
- [Microsoft Learn — Lead and opportunity scoring](https://learn.microsoft.com/en-us/dynamics365/sales/digital-selling-scoring)
- [Microsoft Learn — Use the sales accelerator with the Dynamics 365 Sales Enterprise license](https://learn.microsoft.com/en-us/dynamics365/sales/digital-selling-sales-accelerator)
- [Membrain Help Center — Scorecards](https://www.membrain.com/help-center/process-tools/scorecards)
- [Membrain Help Center — Playbooks](https://www.membrain.com/help-center/process-tools/playbooks)
- [Membrain — Sales Enablement](https://www.membrain.com/sales-enablement)
- [Membrain — Edition Partners](https://www.membrain.com/edition-partners)
- [Coevera (formerly Pipeliner CRM) — Selling Techniques](https://www.coevera.com/sales-methodologies-shortcut/selling-techniques/) (redirected from pipelinersales.com)
- [Coevera (formerly Pipeliner CRM) — CustomerCentric Selling](https://www.coevera.com/sales-methodologies-shortcut/customercentric-selling/) (redirected from pipelinersales.com)
- [PR Newswire — Pipeliner CRM Relaunches as Coevera](https://www.prnewswire.com/news-releases/pipeliner-crm-relaunches-as-coevera-the-first-crm-built-to-empower-and-develop-salespeople-not-just-track-them-302738413.html)
- [Zoho CRM Help — Blueprint: An Overview](https://help.zoho.com/portal/en/kb/crm/customize-crm-account/blueprint/articles/blueprint-an-overview)
- [Zoho CRM — Glossary](https://www.zoho.com/crm/resources/glossary.html)
- [Zoho Blog — App Spotlight: Meddicc Score for Zoho CRM](https://www.zoho.com/blog/marketplace/app-spotlight-meddicc-score-for-zoho-crm.html)

### Addendum sources (2026-09-01, Phase 4)

- `addons/crm/__manifest__.py`, `addons/sale_crm/__manifest__.py`, `addons/sales_team/__manifest__.py`, `addons/mail/__manifest__.py` (this repo, vendored Odoo 19 source; license keys)
- `custom_addons/crm_methodology/__manifest__.py` (this repo)
- `custom_addons/crm_methodology/models/crm_methodology_requirement.py` (this repo)
- `custom_addons/crm_methodology/models/crm_lead.py` (this repo)
- [Odoo — Pricing Plan](https://www.odoo.com/pricing-plan)
- [Odoo — Editions comparison](https://www.odoo.com/page/editions)
- [Odoo — CRM features](https://www.odoo.com/app/crm-features)
- [Odoo 19.0 — Assign leads with predictive lead scoring](https://www.odoo.com/documentation/19.0/applications/sales/crm/track_leads/lead_scoring.html)
- [Odoo — CRM documentation (19.0)](https://www.odoo.com/documentation/19.0/applications/sales/crm.html)
- [Salesforce — Sales Pricing](https://www.salesforce.com/sales/pricing/)
- [Salesforce Help — Considerations and Guidelines for Creating Paths](https://help.salesforce.com/s/articleView?language=en_US&id=sales.path_considerations.htm&type=5)
- [Salesforce Help — Understand How Einstein Scores Your Opportunities](https://help.salesforce.com/s/articleView?id=einstein_sales_opportunity_scoring_how_it_works.htm&language=en_US&type=5)
- [HubSpot — Sales Hub Pricing](https://www.hubspot.com/pricing/sales)
- [HubSpot Knowledge Base — Use playbooks](https://knowledge.hubspot.com/playbooks/use-playbooks)
- [Membrain — Pricing](https://www.membrain.com/pricing)
- [Membrain Help Center — Scorecards](https://www.membrain.com/help-center/process-tools/scorecards)
