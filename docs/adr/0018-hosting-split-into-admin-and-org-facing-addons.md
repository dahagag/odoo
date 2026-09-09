---
status: superseded by ADR-0034
---

# Hosting Operations splits into `hosting` and `hosting_admin` addons

**Superseded:** the cross-org Trial Org model, the AWS integration, suspend/wake control, and the
cost dashboard move **out of `hosting_admin` and out of Odoo entirely**, into the administration
stack — see [ADR-0034](0034-administration-stack-owns-org-record-of-truth.md), which records the
reversal and its rejected alternatives, and the epic it belongs to
([#193](https://github.com/dahagag/odoo/issues/193)). `hosting_admin` shrinks to a CRM
integration ([#197](https://github.com/dahagag/odoo/issues/197)).

**Two of this ADR's decisions are not superseded and are still binding:**

1. The thin `hosting` addon survives, installed on every org's own instance, surfacing that org's
   own Org Registration and nothing else. It now reads that registration from the stack over a
   read-only per-org-scoped endpoint ([#201](https://github.com/dahagag/odoo/issues/201)).
2. The **no-dependency rule** between `hosting` and `hosting_admin` stands. It is why the
   org-facing read path gets its own minimal `OrgRegistrationClient` rather than reusing
   `hosting_admin`'s stack client.

The isolation argument below — that admin-only code must be *absent* from a customer-facing
instance rather than inert on it — is also not repudiated. ADR-0034 applies the same reasoning
one boundary further out.

**Everything below is the original decision. It is superseded — implement nothing from it
except what the note above explicitly preserves.**

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
