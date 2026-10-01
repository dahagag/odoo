# Customer Relationship Management

Tracks prospective demand from initial lead through qualified opportunity and loss or conversion. This glossary covers the vocabulary introduced by configurable sales-methodology support; see `docs/research/b2b-sales-methodologies-odoo.md` for the research this is built on.

## Language

**Sales Methodology**:
A named, reusable qualification-and-coaching framework (MEDDIC, Sandler, ValueSelling, ...) assigned to a client, governing which qualification fields apply to their opportunities and what discovery guidance reps see. Every client has exactly one, defaulting to the empty "None" methodology.
_Avoid_: Process, Sales Process, Framework

**Requirement**:
A rule owned by a Sales Methodology that binds one qualification field (a Property key on the opportunity) to a Checkpoint and an Enforcement level.
_Avoid_: Rule, Gate

**Checkpoint**:
The lifecycle moment at which a Requirement is evaluated: Quotation Created, Marked Won, Marked Lost, or Continuous (no gating moment — always visible on the Qualification tab, never blocks anything).

**Enforcement**:
How a Requirement behaves when its field is empty at its Checkpoint. **Block**: the action fails outright, same class of error as Odoo's native validation errors (e.g. confirming a quotation with no lines). **Warn**: the field is visibly flagged on the Qualification tab but the action proceeds unimpeded.

**Playbook Question**:
A suggested discovery question owned by a Sales Methodology and tied to an Activity Type, shown to the rep when they mark a matching activity done.
_Avoid_: Script, Talk Track
