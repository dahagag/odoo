# Hosting Operations splits into `hosting` and `hosting_admin` addons

Hosting Operations ships as two addons rather than one mode-gated addon. `hosting` is installed
on every Trial Org's (and later, paying customer's) own Odoo instance, namespaced `hosting`, and
is deliberately thin: it surfaces that org's own Org Registration info (name, domain, seats
used/total, expiry) and nothing else. `hosting_admin` is installed only on the factory1 Platform
instance, namespaced `hosting.admin`, and owns everything cross-org: the Trial Org model across
all orgs, the OpenTofu/AWS integration, suspend/wake control, and the cost dashboard.

We rejected one addon whose menus/models activate by a config flag depending on which instance
it's installed on. A mode-gated single addon would mean shipping admin-only code — AWS
credentials, cross-org data access, OpenTofu invocation — onto every Trial Org's own instance,
merely inert rather than absent there. For a system whose entire purpose is isolating one
customer's environment from another's, having that isolation depend on a runtime flag rather than
on the code not being present at all is a real attack-surface and blast-radius concern, not just
a style preference. It also matches this repo's existing convention of small, single-purpose
addons (`crm_methodology`, `dev_e2e_smoke_test`, `example_addon`) rather than one addon branching
on its deployment context.
