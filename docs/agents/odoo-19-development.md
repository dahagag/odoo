# Odoo 19 Agentic Development

Use this playbook before creating or changing an Odoo addon. Completion means every affected context, dependency, extension seam, security boundary, and relevant test is accounted for.

## Source of truth

Use sources in this order:

1. The checked-out Odoo 19 runtime source.
2. [Official Odoo 19 developer documentation](https://www.odoo.com/documentation/19.0/developer.html).
3. The relevant guide under `.agents/skills/odoo-19/references/`.
4. Context7 for discovery; verify its examples against the first three sources.

Runtime behavior and established addon style outrank a style-only rewrite.

## Ownership boundary

- Put owned modules in `custom_addons/<module>/`.
- Treat `odoo/` and `addons/` as upstream reference implementations.
- Extend an upstream model or view from an owned addon when the extension mechanisms can express the behavior.
- A direct upstream patch requires explicit approval and a recorded reason that an extension cannot satisfy. Read `docs/adr/0001-separate-custom-addons-from-upstream.md`.
- Keep module names singular and descriptive. Before scaffolding, check that the name does not collide with any upstream or owned addon.

## Explore before generating

1. Read `CONTEXT-MAP.md`, relevant context glossaries, and applicable ADRs. List every owning context and integration edge touched by the feature.
2. Read the target addon's complete `__manifest__.py` and recursively account for relevant dependencies.
3. Trace the affected models and every extension of them. Include fields, computes, constraints, indexes, lifecycle actions, CRUD overrides, and business methods.
4. Trace security groups and privileges, ACLs, record rules, field restrictions, multi-company rules, and any `sudo()` boundary.
5. Trace data load order, views and inheritance, actions, menus, scheduled jobs, controllers, assets, reports, migrations, and tests.
6. Read connector addons joining the affected contexts, then find the closest stable Odoo 19 implementation of the same pattern.
7. Write a short dependency, ownership, and extension-seam analysis. Generation starts when each affected behavior has an owning module and test surface.

## Generate a deep module

- Prefer one coherent owned addon over unrelated changes spread across modules.
- Declare the smallest complete dependency set. Load groups and rules before ACLs, data before consumers, views before actions where required, and actions before menus.
- Use singular dotted model names and CamelCase classes. Keep recordsets as recordsets; reserve `_id` and `_ids` variable suffixes for integer identifiers.
- Make overrides cooperative: call `super()`, handle batches, and use `ensure_one()` only for genuinely singleton behavior. The one deliberate exception is a controller route meant to fully replace what it overrides (e.g. `LandingHome.index` replacing `Home.index` for `/`, per [ADR 0011](../adr/0011-public-landing-page-overrides-root-route.md)) — there, calling `super()` would run the exact behavior being replaced, so the override is intentionally non-cooperative and should say so in a comment.
- Context is immutable. Derive it with `with_context()` and prefix custom behavior keys with the module name.
- Use `models.Constraint` and `models.Index` for Odoo 19 declarative constraints and indexes.
- Use `fields.Domain` to compose domains. Prefer batch `create`, `write`, `mapped`, `_read_group`, and prefetch-friendly access over per-record queries.
- Use the ORM as the default data interface. When SQL is necessary, use parameterized `odoo.tools.SQL`, flush relevant fields before reading, and invalidate/mark modified records after writing.
- Treat `sudo()` as a narrow privilege boundary: validate the caller and inputs first, elevate only the exact operation, and return to the caller's environment.
- Public methods are RPC surfaces. Validate records and arguments inside every public command; keep implementation helpers private and use `@api.private` when explicit protection is valuable.
- Keep UI restrictions and access control separate. Enforce security with privileges, groups, ACLs, record rules, and field groups.

## Test the behavior

- Use `TransactionCase` for model behavior and deterministic fixtures; use the least privileged user that should succeed.
- Cover the business success path, validation failures, forbidden users, record-rule boundaries, multi-company isolation, batch input, and important lifecycle states.
- Add a regression test for every reproducible bug fix.
- Use `assertQueryCount` when query growth is a risk.
- Mock external services in standard tests. Tag live integration tests explicitly and keep them outside the standard selection.
- Use Hoot for isolated frontend logic and an `HttpCase` tour when Python and browser behavior must work together.
- Run focused tests through `scripts/dev.ps1 test <module>` or `scripts/dev.sh test <module>` before broader selections.

## Autonomy and review

Coding agents may inspect and edit the repository, scaffold owned modules, and create or discard local test databases. They do not receive production credentials or production database access.

Human or designated review gates merge and deployment. Escalate review for:

- ACLs, record rules, groups, privileges, public RPC methods, or `sudo()`.
- Migrations, data deletion, accounting effects, or irreversible external calls.
- New external dependencies, installation hooks, or scheduled actions.
- Direct changes under `odoo/` or `addons/`.
