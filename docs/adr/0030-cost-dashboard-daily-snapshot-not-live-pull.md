# Cost dashboard: daily-refresh snapshot, not a live-pulled view

`hosting_admin` shows AWS spend across every Trial Org (issue #115) as a stored, cron-refreshed
snapshot (`hosting.cost.dashboard.snapshot` + its `hosting.cost.dashboard.line` breakdown), not as
computed fields pulled live from AWS on every page open — the opposite choice from the lifecycle
audit trail ([ADR-0022](0022-live-aws-pulled-audit-view.md)).

The audit trail's live-pull argument doesn't transfer here. There, the only trustworthy source was
Step Functions' own execution history, and staleness was never a concern because every open is a
fresh, free `DescribeExecution`/`GetExecutionHistory` call. Cost Explorer data is different on both
counts: `GetCostAndUsage` itself only refreshes daily and can lag up to 24h behind actual spend once
a cost-allocation tag has just been activated (docs/research/aws-hosting-foundation-tooling.md), so
a live call on every dashboard open would re-fetch data that hasn't actually changed since the last
call — at real per-request AWS cost, for no fresher an answer. A once-daily cron
(`_cron_refresh_snapshot`, `data/ir_cron.xml`) upserts one snapshot per day instead: idempotent
(re-running it same-day recomputes that day's own row rather than creating a second one), and the
dashboard reads whatever the last refresh produced instantly, with no AWS round-trip on open.

The accepted cost is the same 24h figure the ticket already requires surfacing on the view itself:
the dashboard can lag behind AWS's own console by as much as a day. That's inherent to Cost
Explorer's own tag-activation delay, not something a live-pull design would avoid either — a live
call still reads whatever AWS has indexed so far, which is exactly what the cached snapshot already
holds.

## Cost-allocation tag and grouping

Spend is grouped via `GetCostAndUsage`'s `GroupBy=[{'Type': 'TAG', 'Key': 'TrialOrgId'}]` (the same
`TrialOrgId` tag `infra/modules/trial_org` already sets on every resource it creates, and
`hosting_admin`'s own IAM policies already scope against — see `infra/foundation/iam.tf`). A
`GroupBy=TAG` key comes back as `"TrialOrgId$<value>"`; an empty value after the `$` means AWS
spend with no `TrialOrgId` tag at all (the shared foundation/CI infrastructure ADR-0013 keeps
outside any single Trial Org's tag) and is surfaced as an "Unattributed" line rather than dropped,
so the dashboard's total always reconciles with what AWS actually billed.

## Burn rate and days-remaining-on-credit

Burn rate averages the trailing 7 days of spend (not a single day, which swings with normal daily
variance and the tag-activation lag itself) - clamped to however many days have actually elapsed
since the configured credit start date, so a fresh credit period doesn't understate the rate by
averaging over days that don't exist yet. Days-remaining-on-credit is `(credit_amount -
total_spend) / burn_rate_per_day`: blank once burn rate is zero (nothing to project) and zero once
the credit is already exhausted, rather than a negative or divide-by-zero figure.

## Mockable AWS boundary

`CostExplorerClient` (`models/cost_explorer.py`) is an injectable seam in the same shape as
`Provisioner` ([ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md)/
[ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)): an ABC with
`AwsCostExplorerClient` (lazy `boto3.client('ce', ...)`, injectable for tests) and
`StubCostExplorerClient` (no AWS call at all, for dev/test environments with no AWS wiring
configured) implementations. The figure computation itself
(`HostingCostDashboardSnapshot._compute_figures`) is a pure function over already-fetched daily
cost rows, kept apart from both the AWS call and the ORM, so tests assert on computed figures given
fixture cost data without a real `GetCostAndUsage` call anywhere in the suite (the ticket's own
requirement).
