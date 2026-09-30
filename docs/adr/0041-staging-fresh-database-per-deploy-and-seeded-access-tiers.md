---
status: accepted
---

# Staging reseeds a dropped database every deploy; seeded accounts get scoped Odoo groups

Part of [#193](https://github.com/dahagag/odoo/issues/193) via
[#203](https://github.com/dahagag/odoo/issues/203), alongside
[ADR-0040](0040-dev-domain-com-staging-has-no-public-surface-tailscale-only.md) (Platform Account
placement and the Tailscale-only access model this ADR's seeded accounts log into).

## Fresh database per deploy

`dev.domain.com`'s database is **dropped and recreated in place before boot**, then reseeded,
mirroring the existing Render entrypoint's self-heal behaviour: `docker/odoo-render-entrypoint.sh`
already checks on boot whether the database is initialised and installs
`crm_methodology --with-demo` if not
([ADR-0012](0012-local-dev-self-heals-crm-methodology-like-render.md) records the same reasoning
for local dev). `docs/adr/0006-render-hobby-cd-deployment.md`'s own "outlived their host" section
names this exact plan: "the self-healing boot that reinitialises a missing database stops being a
workaround and becomes a requirement: it is the shape staging deliberately adopts on every deploy
(fresh demo data per deploy, #203)." Staging's own entrypoint reuses that reasoning rather than
inventing a third mechanism, adding only the drop-and-recreate step ahead of the existing
self-heal check, then installing with the same bare `--with-demo` flag both
`docker/odoo-render-entrypoint.sh` and `docker/odoo-dev-entrypoint.sh` already use — Odoo 19
defines `--with-demo` as a boolean-only flag (`odoo/tools/config.py`'s `action='store_true'`), so
there is no `=all` variant to opt into.

**Accepted trade-off:** a failed seed leaves staging without a database. The environment is
disposable by definition, so a redeploy is the recovery, not a rollback.

## Seeded account passwords come from secrets, never from committed data

Early-adopter and stakeholder `res.users` accounts are seeded from data files on every boot,
since the database is dropped each deploy — but unlike `crm_methodology`'s own internal demo
personas (`custom_addons/crm_methodology/demo/crm_methodology_demo.xml`, which commit trivial
plaintext passwords by design, gated behind a demo-only `ir.config_parameter` flag), these
accounts are real logins reachable by real external clients and internal stakeholders. Their
passwords are never committed. The entrypoint's seed step reads them from **SSM SecureString
parameters** at deploy time and applies them post-install — the same pattern this repo already
uses for `infra/foundation/lambda_src/log_forwarder`'s HMAC secret (a SecureString parameter,
decrypted via `GetParameter --with-decryption`, scoped by IAM to just that parameter and the KMS
key it's encrypted under) — not AWS Secrets Manager (unused anywhere else in this repo) and not a
plain environment variable (only ever used here for deliberately-weak local-dev defaults).

Account provisioning and revocation is therefore a repo change plus a deploy, not a live admin
action. This is the cheapest mechanism that works, with an obvious ceiling: if the adopter or
stakeholder list starts changing weekly, revisit it against the external-IdP option that was
considered and set aside for this ticket.

## Early-adopter Odoo group and data scope

A new dedicated group that **implies** `base.group_portal` (e.g. `hosting.group_early_adopter`)
— not `base.group_user` (no addon's ACL in this repo, including `hosting`'s own read grant on
`hosting.org.registration`, was designed with a login reachable from outside the company in
mind), and not stock `base.group_portal` directly (a thin wrapper keeps this ticket's own grants
from silently widening if some other addon later broadens what portal users can see generally).
The direction matters: Odoo's `implied_ids` grants a group's members whatever the *implied*
groups grant, not the reverse — a group *implied by* `base.group_portal` would mean every portal
user on the instance, not just named early adopters, automatically inherits this group's write
access, which is exactly the authorization bypass this design needs to avoid. A dedicated group
that implies `base.group_portal` has the right shape instead: its own members gain portal's
baseline behavior too, but portal membership alone grants nothing back onto them.

- **One shared demo dataset**, not per-adopter isolated data. This system's real multi-tenancy
  model is instance-per-org (`infra/modules/trial_org`, one Terraform instantiation and state
  file per org) — it never isolates tenants by row within one shared database. Building that
  pattern for staging alone would invent an architecture this product doesn't otherwise use, to
  prove nothing about production.
- **Write access**, not read-only, on the opportunity and methodology-assessment models. A
  sales-methodology product is evaluated by running a deal through it, not by spectating someone
  else's pre-seeded data; read-only would not let a named early adopter actually judge the
  product.
- **Scoped by Odoo's stock portal record rule** — "linked-to-me" visibility, already how
  `base.group_portal` behaves elsewhere in stock Odoo — applied to the opportunity/methodology
  models so one adopter's test records aren't visible to another. Staff
  (`base.group_user`) keep full cross-adopter visibility for support and triage.
- **No per-adopter record cap.** With no public surface at all
  ([ADR-0040](0040-dev-domain-com-staging-has-no-public-surface-tailscale-only.md)), only
  Tailscale-invited users can reach the instance in the first place; combined with the
  fresh-database-per-deploy reset, this is accepted as sufficient containment for a "sized
  small, proving ground" environment.

## Stakeholder Odoo group

A separate, more restricted group — Odoo UI viewing, not full `base.group_user` — paired with
the `group:stakeholders` Tailscale ACL group from ADR-0040. Internal stakeholders are employees,
not external clients, but they are not engineering staff either; this group exists because
neither `base.group_user` (too broad — real internal/employee access) nor the early-adopter
portal group (models an external identity, not an internal one) fit.

## Testing (per #203's own Testing Decisions, carried into this ADR's sub-issues)

- The seed data files get a test that they install cleanly into a fresh database.
- The early-adopter and stakeholder account seeding is asserted: after a seed, the expected
  logins exist with the expected groups, and no account is created with a committed or default
  password.
- The boot sequence's drop-and-recreate path is exercised in CI against a throwaway database,
  including the case where the previous database does not exist.
