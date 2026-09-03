---
status: superseded by ADR-0015
---

# Render Hobby CD deployment

**Superseded:** production is migrating to AWS (Platform Account) — see
[ADR-0015](0015-production-migrates-to-aws-platform-account.md). This record is kept for the
zero-cost-POC reasoning below, which no longer applies once the migration completes.

The client-demo instance runs on Render's free web service + free Postgres, promoted by
merging a release PR from `dev/19.0` into a new `main/19.0` branch, which Render watches for
auto-deploy. No GitHub Actions deploy job exists: `dev/19.0` keeps its existing lint/test CI,
and the PR merge into `main/19.0` *is* the approval gate — Render's own git integration
handles the rest. This is a solo-maintainer repo with no external contributors, so
`main/19.0`'s branch protection requires a passing `lint` check but no separate reviewer,
matching `dev/19.0`'s own protection rather than GitHub's default reviewed-PR shape (which
can't be satisfied by a single account anyway — GitHub disallows self-approval).

We accepted two real costs of the free tier to keep this a zero-recurring-cost POC:

- Free Postgres expires 30 days after creation (14-day grace period before deletion), so the
  database cannot be assumed to persist indefinitely. Render's **Pre-Deploy Command** feature
  would normally run migrations/seeding as a distinct pipeline step, but it's paid-tier only.
  Instead, the Odoo container's own start command checks on every boot whether the database
  is initialized and, if not, runs `-i crm_methodology --with-demo=all` before starting the
  server — so a silent DB expiry heals itself on the next deploy or manual restart, with no
  separate recreation step.
- Free web services spin down after 15 minutes idle (~1 minute cold-start delay on the next
  request). We accepted this rather than adding a keep-alive pinger: warming the tab before a
  client call is simpler than maintaining an always-on workaround for a POC.

A known failure mode of "every boot heals a stale database" is that it only checks whether the
*database* looks right, not whether the *container's local disk* does. Free web services have
no persistent disk, so each deploy is a brand-new container with an empty ephemeral filesystem,
while Postgres — and Odoo's attachment metadata in it — persists across deploys. Odoo splits
attachment storage: `ir_attachment` rows (metadata + checksum) live in Postgres, but by default
the binary content lives on that local disk (the "filestore"). Asset bundles compiled by one
container are unreadable by the next, 500ing every static asset request despite the module
still showing as installed. The entrypoint now also forces `ir_attachment.location` to `db` on
every boot and purges any attachment row whose file-backed content is missing on the current
container, so storage survives container replacement and stale rows regenerate instead of
500ing forever — see `docker/odoo-render-entrypoint.sh`'s `heal_attachment_storage`.

The production image is a new `docker/odoo-render.Dockerfile`, kept separate from
`docker/odoo-dev.Dockerfile` per [ADR 0003](0003-standardize-local-development-on-containers.md),
which established that dev and non-dev environments stay explicitly separate rather than one
Dockerfile branching on build args.

One-time manual setup (creating the Render Postgres instance and web service, setting
environment variables, connecting `main/19.0` for auto-deploy) requires production credentials
an agent shouldn't hold, so it's captured as an interactive checklist instead of automated:
[`scripts/render-demo-setup.sh`](../../scripts/render-demo-setup.sh) (bash, needs Git Bash/WSL)
or [`scripts/render-demo-setup.ps1`](../../scripts/render-demo-setup.ps1) (PowerShell). Both
walk through the same five stages — keep them in sync if either changes.
