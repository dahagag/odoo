## Findings — Data lag per AWS cost/billing data source

Research date: 2026-09-09. Scope: issue #233 (wayfinder spike), a child of map
#228 ("AWS credit visibility and upfront expense control") and grandchild of
#206. The question: what is the delay on each cost/billing data source used or
considered — Cost Explorer, Cost and Usage Reports (CUR), cost allocation
tags, AWS Budgets, and (per the credit-visibility research in sibling #229) a
credit-balance API if one exists? Any control built on this data has a floor
on how fast it can react; this establishes that floor. Primary sources only
(AWS's own docs/API references); every claim below is tied to the AWS page it
came from, and anything AWS does not state a number for is called out
explicitly rather than guessed at.

### Summary / Direct answer

There is no single "the lag is N hours" figure — each source has its own
floor, and AWS documents them inconsistently (some as hard numbers, some as
qualitative statements with no bound):

| Source | Documented floor | Precision |
|---|---|---|
| Cost Explorer | current month ≈24h to first appear; refreshes ≥ every 24h thereafter | AWS-stated number, but no per-granularity (hourly/daily/monthly) breakdown |
| CUR / CUR 2.0 | first delivery ≤24h after report creation; updated 1–3×/day until finalized at month-end invoice | range, not a fixed cadence |
| Cost allocation tags | "up to 24 hours" to appear in Billing and Cost Management console after activation | confirmed hard number; no further AWS-documented step beyond this |
| AWS Budgets | data updates up to 3×/day, "typically" 8–12h apart; notification send lag beyond that is acknowledged but **not bounded** by AWS | partial — data cadence is numeric, alert-send lag is not |
| Credit balance API | `GetCredits` API exists and is programmatically reachable | lag **not documented anywhere in the API reference** — unanswerable from primary sources |

### Existing repo documentation on cost allocation tags (confirm/correct)

`docs/research/aws-hosting-foundation-tooling.md` (lines ~299–310, "Propagation
delay") already carries the primary-sourced sentence "All tags can take up to
24 hours to appear in the Billing and Cost Management console," and flags a
compounded "~48 hours end-to-end" figure as unverified. That file, plus
`docs/adr/0030-cost-dashboard-daily-snapshot-not-live-pull.md` (lines 41–53)
and `docs/design/115-cost-dashboard/Main.dc.html:55`, all key off the same
24-hour number for the cost dashboard's staleness assumption.

**This research confirms the 24-hour figure and leaves the 48-hour figure
unresolved by design, not oversight.** A direct fetch of both AWS pages the
existing doc cites was performed in this session:

- [Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
  states, verbatim: "All tags can take up to 24 hours to appear in the Billing
  and Cost Management console." Tags must first be **activated** before this
  clock even starts ("You must activate both types of tags separately before
  they can appear in Cost Explorer or on a cost allocation report").
- [Understanding dates for cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-allocation-tags-timeline.html)
  — the page that would be expected to carry a compound/end-to-end number —
  contains **no timing or lag figure at all**. It only documents two metadata
  columns shown in the console (Last updated date, Last used month). It does
  not corroborate or contradict a 48-hour figure; the topic simply isn't
  addressed there.

Conclusion: the repo's "up to 24 hours" figure for tag-activation visibility
is correct and is the only number AWS states directly for this source. Any
"~48 hours" compound figure remains a synthesized/inferred number, not an
AWS-documented one — the existing "unverified" flag in
`aws-hosting-foundation-tooling.md` should stand as-is; this research did not
surface a primary source that resolves it either way.

### 1. AWS Cost Explorer (API + console)

- **First availability:** "The current month's data is available for viewing
  in about 24 hours. The rest of your data takes a few days longer."
- **Ongoing refresh:** "Cost Explorer refreshes your cost data at least once
  every 24 hours. However, this depends on your upstream data from your
  billing applications, and some data might be updated later than 24 hours."
- **Estimated vs. finalized:** the `GetCostAndUsage` API's `ResultByTime`
  objects carry an `Estimated` boolean (AWS's own example response shows
  `"Estimated": false` for a finalized month). AWS does not publish a numeric
  lag specifically for the estimated→finalized transition beyond this flag;
  finalization is tied to month-end invoice issuance (see CUR below — Cost
  Explorer explicitly shares its dataset with CUR/detailed billing reports).
- **Granularity:** `GetCostAndUsage`'s `Granularity` parameter accepts
  `DAILY`, `MONTHLY`, or `HOURLY`. No AWS page found states a *different*
  refresh SLA per granularity — the single "at least once every 24 hours"
  applies across the API. A per-granularity lag differential is **not
  confirmed** in primary AWS text.

Sources: [Analyzing your costs and usage with AWS Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html),
[`GetCostAndUsage` API Reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html).

### 2. AWS Cost and Usage Reports (CUR / CUR 2.0 / Data Exports)

- **First delivery:** "After you create your report, it can take up to 24
  hours for AWS to deliver the first report to your Amazon S3 bucket."
- **Update frequency:** AWS states this in slightly different ways across the
  same guide — "AWS updates your report in your bucket once a day" (overview),
  "Update the report up to three times a day" (capability list), "AWS updates
  your report at least once a day until your charges are finalized"
  (mechanics). Read together, the honest range is **1–3 updates/day**, not a
  single fixed cadence.
- **Estimates during the month:** "Each report update in a given month is
  cumulative... The report updates that you receive throughout the month are
  estimates. The charges are subject to change as you continue to use your
  AWS services."
- **Finalization:** "AWS finalizes your report's usage charges after issuing
  an invoice at the end of the month." Refunds/credits/Support fees can still
  land after that point — Developer/Business/Enterprise Support fees post "on
  the sixth or seventh of the month for the prior month's Cost and Usage
  Report."
- **The "24–72 hour post-close reconciliation window" is not AWS-documented.**
  Targeted searches of the CUR "How CUR works," report-timeline, and Data
  Exports pages surfaced no fixed hour-range for post-period-close
  reconciliation — only the qualitative "finalizes after issuing an invoice at
  month-end" plus the specific "6th or 7th" date for Support fees. Treat any
  24–72h reconciliation figure as **unconfirmed**; do not cite a specific hour
  range for it going forward.

Source: [What are AWS Cost and Usage Reports?](https://docs.aws.amazon.com/cur/latest/userguide/what-is-cur.html).

### 3. Cost allocation tags

See "Existing repo documentation" section above — confirmed floor is **up to
24 hours** after activation for a tag to appear in the Billing and Cost
Management console / become usable in Cost Explorer and cost allocation
reports. No further AWS-documented number exists beyond that.

Sources: [Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html),
[Understanding dates for cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-allocation-tags-timeline.html).

### 4. AWS Budgets notifications

- **Data update cadence:** "AWS Budgets information is updated up to three
  times a day. Updates typically occur 8–12 hours after the previous update."
  This is a more precise statement than a flat "every 8 hours" — AWS's own
  wording is 8–12 hours between updates, capped at 3 updates/day.
- **Notification lag beyond the data cadence — acknowledged, not bounded:**
  "There can be a delay between when you incur a charge and when you receive
  a notification from AWS Budgets for the charge. This is due to a delay
  between when an AWS resource is used and when that resource usage is
  billed. You might incur additional costs or usage that exceed your budget
  notification threshold before AWS Budgets can notify you, and your actual
  costs or usage may continue to increase or decrease after you receive the
  notification."
- AWS gives no additional numeric bound for the notification-send step itself
  past the underlying data-update cadence above; the "delay" language is a
  deliberate warning that threshold overshoot before the alert fires is
  expected behavior, not an edge case.

Source: [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

### 5. AWS credit-balance API

A programmatic API **does exist** — this is worth flagging against any
assumption (including any carried over from #229) that credit balance is
console-only. The AWS Billing and Cost Management API (service
`billing-2023-09-07`) exposes `GetCredits`, returning `CreditData` objects per
account: `initialAmount`, `remainingAmount`, `estimatedAmount`, `exhaustDate`,
`creditStatus`, `creditType`, `applicableProductNames`, and
expiration/sharing fields. It accepts `accountId`, `startDate`/`endDate`
(Unix epoch), and a `payerAccountFlag` to aggregate across a consolidated
billing family from the management account.

**Data lag: genuinely unanswerable from primary sources.** The `GetCredits`
API reference states no refresh cadence, staleness bound, or "as of" timestamp
semantics for the returned balances — unlike Cost Explorer and CUR, which
explicitly document their own lag, this operation's reference page and its
`CreditData` shape page are both silent on freshness. No companion user-guide
page describing `GetCredits`' underlying data pipeline or latency was found.
It would be reasonable to *assume* credits lag at least as much as the
finalized cost data they're netted against (credits are applied against
invoiced usage), but that is an inference, not an AWS-documented figure, and
should not be treated as a cited number.

Sources: [`GetCredits` API Reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html),
[`CreditData`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_CreditData.html).

### What this means for anything built on this data

Whatever reacts to AWS cost/billing signals inherits the slowest link it
depends on. In practice: cost-allocation-tag-filtered views and Cost Explorer
both carry a same-order-of-magnitude ~24-hour floor from event to visibility;
CUR trails a similar first-delivery floor but keeps revising for the rest of
the month; AWS Budgets alerts can lag both the up-to-12-hour data cadence *and*
an unbounded additional send delay, so a Budgets notification is the least
reliable source for "just in time" reaction; and credit balance, while
programmatically reachable via `GetCredits`, has no documented freshness
guarantee at all, so it cannot be relied on as a real-time or even
same-day-bounded signal without further empirical measurement (out of scope
for this primary-source-only spike).
