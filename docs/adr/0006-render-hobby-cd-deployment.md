# Demo instance deploys to Render's free tier via a `main/19.0` branch, self-healing on every start

The client-demo instance runs on Render's free web service + free Postgres, promoted by
merging a reviewed release PR from `dev/19.0` into a new `main/19.0` branch, which Render
watches for auto-deploy. No GitHub Actions deploy job exists: `dev/19.0` keeps its existing
lint/test CI, and the PR merge into `main/19.0` *is* the human approval gate — Render's own
git integration handles the rest.

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

The production image is a new `docker/odoo-render.Dockerfile`, kept separate from
`docker/odoo-dev.Dockerfile` per [ADR 0003](0003-standardize-local-development-on-containers.md),
which established that dev and non-dev environments stay explicitly separate rather than one
Dockerfile branching on build args.

One-time manual setup (creating the Render Postgres instance and web service, setting
environment variables, connecting `main/19.0` for auto-deploy) requires production credentials
an agent shouldn't hold, so it's captured as an interactive checklist instead of automated:
[`scripts/render-demo-setup.sh`](../../scripts/render-demo-setup.sh).
