# Live AWS-pulled audit view for Trial Org lifecycle actions

`hosting_admin` shows a Trial Org's lifecycle audit trail (issue/extend/suspend/wake/destroy —
who, when, what happened at each step) by calling AWS directly when an admin opens the record,
rather than maintaining its own audit log or syncing one on a schedule. Step Functions already
keeps a full execution history per lifecycle action (per
[ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)/[ADR-0020](0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md)'s
design); duplicating that into an Odoo-side log would mean two systems of record for the same
facts, drifting apart the moment one write path is missed.

`hosting_admin`'s IAM role (narrowly scoped in ADR-0019 to `states:StartExecution`/
`DescribeExecution`) gains two more read-only actions, both resource-scoped the same way
(per-execution ARN, `aws:ResourceTag`-conditioned to the specific Trial Org): `states:DescribeExecution`
was already present; `states:GetExecutionHistory` is added because the summary
`DescribeExecution` gives (overall status, start/stop time, input/output) isn't the audit trail
that's actually useful — the step-by-step detail (mutex acquired, ECS task started, EC2 waiter
result, which step failed and why) is.

We chose on-demand over a scheduled sync deliberately: a cron job caching execution history into
Odoo records would survive past Step Functions' own retention window and load faster, but it's
more to build (a sync job, staleness handling, a place to store the cache) for a view whose whole
value is "what actually happened," which is only ever fully trustworthy read fresh from AWS
anyway. The accepted cost is a live AWS dependency on page load and nothing surviving past Step
Functions' retention — acceptable for an early-stage system at this trial volume, revisit if audit
data needs to outlive that window or page-load latency becomes a real problem.
