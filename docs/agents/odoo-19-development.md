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

## Localization strings

Translatable strings come from more sources than the obvious ones: Python `_(...)`, JS `_t(...)`,
translatable model fields and server-side QWeb views, **and plain text nodes in a frontend OWL
template** (`static/src/xml/*.xml`) — Odoo's extractor (`odoo/tools/translate.py`'s
`babel_extract_qweb`) picks up ordinary element text there automatically, no `_t()` needed, the
same as server-side view text. The one gap: an OWL **component prop** (e.g. `<Dialog
title="'Some text'">`) is a JS expression, not element text, and is only extracted if the attribute
name ends in `.translate` — don't leave user-facing copy sitting in a plain prop like that; either
bind it to a `_t()`-wrapped value from the component, or put the text as a plain child element
instead.

Whenever a change adds or edits any string from the sources above, running
`./scripts/dev.ps1 i18n-export <module> [langs]` (see `docs/agents/local-development.md`) once the
strings are settled, and then filling in the resulting empty `msgstr` entries for every language in
the addon's existing translated set, is part of finishing that change — not a follow-up someone
else does later. Before treating such a change as done: re-run the export one final time and
confirm `git diff` shows no newly-empty `msgstr ""` lines left in the addon's `i18n/*.po` files.
The export only picks up new `msgid`s; it never translates them.

## One-time, per-user UI state (e.g. a first-login prompt)

A "show this once per user, never again" flag (a first-login onboarding prompt, a dismissible
announcement) is plain `res.users` state, surfaced through `ir.http.session_info()` rather than an
extra RPC round-trip on webclient boot:

- Add the flag as a `fields.Boolean` on an owned `_inherit = 'res.users'` extension (default
  `False`). Do not model it as a separate `res.users`-keyed table unless more than a flag or two is
  needed.
- Extend `ir.http.session_info()` (`_inherit = 'ir.http'`, call `super()` and add a key) to expose
  the flag to the client on load, instead of a dedicated `read`/`search_read` call before the
  webclient can decide whether to show anything.
- To let a normal (non-admin) user flip the flag on their own record, add it to both
  `SELF_READABLE_FIELDS` and `SELF_WRITEABLE_FIELDS` (override the property, call `super()`, extend
  the list) on the `res.users` extension. `res.users.write()` only self-sudos when *every* key in
  the write vals is in `SELF_WRITEABLE_FIELDS` — a write that mixes an allowed and a disallowed
  field gets no sudo and fails the normal ACL check, so dismiss actions should write the flag alone
  (`{'<module>_x_seen': True}`), not batched with other fields.
- A dialog opened from a `main_components`-registered launcher at webclient boot races the
  webclient's own default-action load: `action_service.js`'s `doAction()` unconditionally calls
  `dialog.closeAll()` before every `ACTION_MANAGER:UPDATE` bus event, and boot fires more than one
  of those in quick succession while resolving the URL into the user's home action
  (`webclient.js`'s `loadRouterState()`). Opening on the first such event (or immediately in
  `setup()`) loses that race silently — the dialog appears and is closed again before the user can
  interact with it. Debounce: reset a short timer on every `ACTION_MANAGER:UPDATE` and only open
  once the events go quiet.

## Autonomy and review

Coding agents may inspect and edit the repository, scaffold owned modules, and create or discard local test databases. They do not receive production credentials or production database access.

Human or designated review gates merge and deployment. Escalate review for:

- ACLs, record rules, groups, privileges, public RPC methods, or `sudo()`.
- Migrations, data deletion, accounting effects, or irreversible external calls.
- New external dependencies, installation hooks, or scheduled actions.
- Direct changes under `odoo/` or `addons/`.
