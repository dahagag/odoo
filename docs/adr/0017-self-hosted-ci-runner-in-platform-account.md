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
