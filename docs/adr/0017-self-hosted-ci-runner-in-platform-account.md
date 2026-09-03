# Self-hosted GitHub Actions runner in the Platform Account

CI/CD runs on a dedicated, self-hosted GitHub Actions runner living in the Platform Account
([ADR-0015](0015-production-migrates-to-aws-platform-account.md)), rather than GitHub-hosted
runners. Three reasons drove this: CI/CD needs private network access to the OpenTofu remote-state
backend and (post-migration) production's VPC, which a GitHub-hosted runner outside our network
can't reach without exposing them publicly; persistent Docker-layer and OpenTofu-provider caching
across runs is only possible with a runner that survives between jobs; and GitHub-hosted-runner
minutes get expensive as CI/CD volume grows, versus predictable cost on our own compute.

The runner authenticates to AWS via GitHub Actions' native OIDC federation
(`AssumeRoleWithWebIdentity`) rather than a stored credential or its own instance's IAM role —
the same AWS-documented external-caller pattern identified in
[`docs/research/aws-hosting-foundation-tooling.md`](../research/aws-hosting-foundation-tooling.md#authenticating-from-outside-aws-odoo-on-render).
Scoping the trust policy to the workflow/repo identity (rather than "whatever compute the runner
happens to be on") means the permissions travel with the CI job, not with wherever we later move
the runner.

Placing the runner inside the Platform Account (rather than a separate CI/CD account) accepts a
smaller blast-radius boundary than full account isolation would give, in exchange for not adding
a fourth AWS Organizations account before anything has shipped. Revisit if/when CI/CD volume or a
security requirement justifies isolating it.

**Trust boundary:** this repository is public (`dahagag/odoo`, a fork of `odoo/odoo`), and
`.github/workflows/ci.yml` currently triggers on `pull_request` targeting `dev/19.0`/`main/19.0`
— including PRs opened from forks. A self-hosted, persistent runner picking up jobs from that
trigger is the well-known fork-PR-to-RCE vector: arbitrary code from an untrusted PR would run on
our own persistent compute, with access to whatever the runner's environment (including its
OIDC-assumed AWS role) can reach. The self-hosted runner is therefore scoped to **trusted
workflows only** — pushes/merges to `dev/19.0`, `workflow_dispatch`, and PRs opened by
collaborators (`authorAssociation` of `OWNER`/`MEMBER`/`COLLABORATOR`, mirroring the PR-triage
distinction already drawn in `docs/agents/issue-tracker.md`'s "PRs as a request surface" section).
Any `pull_request`-triggered job from a non-collaborator continues to run on GitHub-hosted
runners, not the self-hosted one, until this repo has a documented, enforced way to gate which
jobs the persistent runner accepts.

**CD pipeline AWS configuration.** OIDC federation is only "the runner authenticates via
OIDC" in the abstract until the workflow itself is wired for it. Once the OIDC identity provider
and the trust-scoped IAM role exist (both provisioned as part of the production migration,
[ADR-0015](0015-production-migrates-to-aws-platform-account.md), since the runner and its role
live in the Platform Account), the CI/CD workflow(s) that need AWS access require, at minimum:

- `permissions: id-token: write` set on the workflow (or the specific job) — without it, GitHub
  never mints the OIDC token `AssumeRoleWithWebIdentity` needs.
- An `aws-actions/configure-aws-credentials` step (or equivalent) consuming two values that must
  be available to the workflow: the IAM role's ARN to assume, and the target AWS region. Neither
  is a secret in the credentials sense (the role ARN is not sensitive on its own — the trust
  policy is what restricts who can assume it), so both are GitHub Actions **repository or
  environment variables**, not `secrets.*`, keeping them visible in workflow runs for debugging
  rather than redacted.
- No long-lived AWS access key ever stored as a GitHub secret for this path — that would defeat
  the entire reason OIDC was chosen over a stored credential (see the main decision above).

These values don't exist yet — there is no OIDC provider or role to reference until ADR-0015's
migration provisions them. This subsection is the requirement that migration work must satisfy for
CI/CD specifically, so it isn't rediscovered or improvised later: whoever wires the workflow sets
the role-ARN and region variables at that point, adds the `id-token: write` permission, and adds
the credentials step: no other CI/CD-specific AWS design decision remains open.
