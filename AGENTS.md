## Agent skills

### Issue tracker

Issues and specifications are tracked as GitHub Issues on the fork (origin) repository using the `gh` CLI. See `docs/agents/issue-tracker.md` for commands and workflows.

### Triage labels

Triage uses the five default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the multi-context layout rooted at `CONTEXT-MAP.md`. Before naming or changing business concepts, read the relevant context entries and `docs/agents/domain.md`.

### Odoo 19 development

Before creating or changing an addon, read `docs/agents/odoo-19-development.md`. Owned modules belong in `custom_addons/`; the upstream `odoo/` and `addons/` trees are reference implementations unless a core patch is explicitly approved.

### Agentic administration

Before designing or executing Odoo administration automation, read `docs/agents/odoo-19-automation.md`. Apply its split control/execution architecture and tiered authority model.

### Local development

For environment setup, module lifecycle commands, tests, database access, or destructive local reset, read `docs/agents/local-development.md` and use the repository wrappers.
