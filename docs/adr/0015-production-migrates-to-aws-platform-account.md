# Production migrates to AWS (Platform Account), ahead of trial provisioning

agentic-erp's production instance moves off Render (see
[ADR-0006](0006-render-hobby-cd-deployment.md), now superseded) onto a new Platform Account
within the same AWS Organization as the Hosting Account
([ADR-0013](0013-aws-organizations-for-hosting-foundation.md)). This migration is sequenced
*before* building Trial-Org provisioning, even though it delays shipping trial issuance: the
Hosting Automation identity that provisions Trial Orgs is meant to authenticate via a native IAM
role (EC2 instance profile / ECS task role), which only exists once Odoo itself runs inside AWS.
Building trial provisioning first would mean standing up a long-lived IAM user access key as a
throwaway auth path, then discarding it — see the research behind this trade-off in
[`docs/research/aws-hosting-foundation-tooling.md`](../research/aws-hosting-foundation-tooling.md#3-iam-least-privilege-model-for-an-external-caller),
which found AWS's own IAM best-practices documentation leads with temporary role credentials and
treats long-lived access keys as an exception, not a default.

Kept separate from the Hosting Account per the update to ADR-0013: production is not disposable
infrastructure and should not share an account boundary with frequently-created/destroyed trial
orgs.

Compute type, database engine, networking, and cutover plan for the production migration itself
are not decided here — that's a separate design pass.
