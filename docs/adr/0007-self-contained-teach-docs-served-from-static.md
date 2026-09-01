---
status: accepted
---

# Self-contained teach docs served from crm_methodology's own static folder

`docs/teach/*.md` is the stakeholder-facing source of truth for the CRM methodology teach workspace, but had no repeatable rendering — the only polished version stakeholders saw was a hand-authored Claude Artifact that drifted from the committed Markdown (surfaced when PR #32 shipped an older draft than what stakeholders had reviewed). We're building a `docs-build:doc` pipeline that renders `docs/teach/*.md`, plus every local document reachable by a link from them (ADRs, `CONTEXT.md`, the research doc), into self-contained static HTML — images embedded as data URIs, internal links resolved to sibling generated pages — written to `custom_addons/crm_methodology/static/docs/`. Odoo serves any addon's `static/` tree automatically and publicly at `/<module>/static/**` with zero controller code (confirmed against `odoo/http.py`), so this output directory doubles as the public serving path and is committed to git rather than gitignored: committing it is what publishes it.

**Considered Options:** a custom `auth='public'` controller — rejected, pure overhead when Odoo's built-in static route already does this for free. Hosting the rendered pages outside Odoo (a static site, GitHub Pages) — rejected, adds a second deploy surface when the addon is already deployed via the Render demo (ADR 0006). Keeping the hand-authored Claude Artifacts as the source of truth — rejected, that's exactly the drift PR #32 exposed.

**Consequences:** the served pages are unauthenticated by construction, not by a configurable choice — gating them later requires an explicit controller-based alternative to the static route, not a flag.
