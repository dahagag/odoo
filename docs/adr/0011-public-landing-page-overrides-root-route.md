---
status: amended by ADR-0037
---

# Public landing page overrides the root route, /odoo stays untouched

**Amended:** the public landing page moves **off Odoo** to static hosting in the Platform
Account, because Odoo loses its public listener entirely — see
[ADR-0037](0037-odoo-has-no-public-ingress.md), under epic
[#193](https://github.com/dahagag/odoo/issues/193).

The `/`-overriding `auth='public'` controller in `crm_methodology` was the right call while Odoo
*was* the public deploy surface. Once it is not, there is nothing for that controller to serve to
anyone. The reasoning below therefore stays valid on its own terms, and is overtaken by a change
of premise rather than a change of mind.

Two of the rejections below are also re-answered by that premise. Hosting the landing page on a
separate static site was rejected as "a second deploy surface" — the epic builds that surface
anyway for the teach docs and the client app, so it is no longer a second one. And "`/odoo` is
already the demo" no longer holds: our own instance is not something a prospect reaches, and the
demo a lead sees is their own Trial Org. `/odoo` stays Odoo's native route, now reached by staff
over Tailscale.

We want a public entry point at `/` that links to the teach docs and to the live demo, instead of Odoo's default behavior of redirecting `/` straight into the backend login screen (`addons/web/controllers/home.py`). ADR 0007 rejected a custom controller for *serving the teach docs themselves* because Odoo's built-in static route already publishes `custom_addons/crm_methodology/static/**` for free — that reasoning doesn't extend here, because there is no free route for `/`: it's claimed by Odoo's own `Home.index`, and only a controller can override it. We add one `auth='public'` controller, in `crm_methodology`, registering `/`, that renders a minimal static-style hub (title, description, links to the two teach docs, a button to the demo) and otherwise changes nothing — `/odoo` is left as Odoo's native route, which already resolves to the real backend/login on this same instance, so it doubles as "the Odoo demo" with zero additional code.

**Considered Options:** installing the `website` module for a CMS-authored homepage — rejected, it isn't installed anywhere in this repo and pulls in a much larger surface than a static hub needs. Hosting the landing page on a separate static site (mirroring how teach-doc HTML is generated) — rejected for the same reason ADR 0007 rejected it for docs: a second deploy surface, when the addon is already deployed via the Render demo (ADR 0006). Reverse-proxying or embedding the external demo under `/odoo` — rejected as unnecessary: `/odoo` is already Odoo's reserved app route on this same instance, so it's already the demo.

**Consequences:** unauthenticated visitors now see a landing page at `/` instead of being bounced to the login screen — this is a deliberate behavior change to Odoo's default UX for anyone probing the root path, not just an additive feature.
