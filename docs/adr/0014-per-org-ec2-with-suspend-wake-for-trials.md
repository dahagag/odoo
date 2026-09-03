# Per-org EC2 with suspend/wake for Trial Orgs; Fargate reserved for paid hosting

Each Trial Org gets its own EC2 instance rather than sharing one multi-tenant Odoo server
(Odoo's native multi-database routing) or running on a per-org Fargate task. We rejected the
shared-server option because a noisy or misbehaving trial would degrade every other live sales
demo sharing the box, and rejected always-on Fargate-per-org because at 1-5 concurrent trials
its always-on cost isn't justified. We also rejected Lambda-per-org: Odoo is a heavy stateful
app not built for serverless, and a 10s+ cold start during a live sales demo directly undermines
the thing this system exists to support.

Instead each trial's EC2 instance is stopped after an idle timeout (~30 min) and stays stopped
until an org user explicitly clicks "Wake Up" on a static waiting page — never woken silently on
first request, to avoid bots/link-previews racking up compute time. This keeps steady-state cost
near the EBS-storage floor while avoiding serverless cold-start risk entirely, at the cost of a
real (if bounded, ~1-2 min) wait on the first click of a new session.

Paid hosting customers (once that exists) are deliberately scoped to ECS Fargate instead: no
AMI/OS patching burden as the fleet grows, and the operational quality bar for a paying customer
doesn't tolerate the same suspend/wake tradeoff a disposable trial does. This intentionally
leaves two provisioning code paths rather than one uniform compute model — accepted because
trials and paid hosting have genuinely different cost/quality requirements, not because of an
oversight.

**Update:** the mechanism that actually creates a Trial Org's EC2 instance is OpenTofu, not raw
boto3 calls — see [ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md). The
compute/lifecycle decisions above (per-org EC2, suspend/wake, Fargate for paid hosting) stand
unchanged; only *how* the instance gets created changed.
