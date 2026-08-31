# Methodology Requirements reference Properties by key, not by ownership

`crm.methodology.requirement` binds a Checkpoint and an Enforcement level to
a qualification field, but it references that field as a string key into the
opportunity's existing `lead_properties` (Odoo's per-team `Properties`
mechanism), rather than owning a field definition itself.

The alternative was a dedicated model owning methodology-specific field
definitions independently of Sales Team scoping. That would have avoided a
real wrinkle this decision creates: Properties are defined per Sales Team,
while a Sales Methodology is assigned per client, so two clients on the same
team running different methodologies see the union of every field either
methodology has ever needed — the Qualification tab has to filter that union
down to the active methodology's own keys itself, and nothing stops a
Requirement from referencing a key a given team hasn't actually configured
yet (see the "sync to team" mechanism this forced on `crm.lead`, triggered
by the Salesperson through an explicit "Sync to Team" action rather than
automatically).

We accepted that wrinkle to keep the zero-code path Odoo's Properties widget
already provides — a Sales Manager can add a new qualification field from
the record's own Actions menu in seconds, with typed values (including
Many2one links to real records), without a module update. Rebuilding that
mechanism independently, scoped more cleanly to methodology instead of team,
would have meant re-implementing infrastructure Odoo already ships for free
to avoid one filtering problem.
