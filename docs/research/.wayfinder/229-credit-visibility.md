## Findings — AWS credit visibility and applied-credit API

Research date: 2026-09-09. Scope: issue #229 (wayfinder spike), a child of map
#228 ("AWS credit visibility and upfront expense control") and grandchild of
#206. The question: what does AWS expose about applied credits
programmatically — remaining balance, applied amount, expiry — and through
which API? Specifically, is credit balance available *at all* outside the
console, since the repo's Cost Dashboard currently works around this by
reading the credit amount from configuration rather than live from AWS.
Primary sources only (AWS's own docs/API references); every claim below is
tied to the AWS page it came from.

### Summary / Direct answer

**Yes — credit balance is available outside the console.** AWS's Billing and
Cost Management API (service `billing-2023-09-07`) exposes a `GetCredits`
operation that returns, per credit: initial amount, remaining (unused)
balance, an estimated remaining balance including in-flight bills, expiry
date, and the date the balance hit zero. This directly answers the "amount
+ expiry" half of the question with a real API, not a console-only surface.

What it does **not** give directly is a single scalar "applied amount" field
— that has to be derived (`initialAmount - remainingAmount`, or read off
`exhaustDate`/`creditStatus`) rather than read off one named field. And the
API is silent on two practical questions the repo's dashboard cares about:
data freshness/lag, and any documented rate limit — both **unanswerable from
primary sources**, called out explicitly below rather than guessed at.

### The existing repo workaround (context)

`custom_addons/hosting_admin/models/cost_dashboard.py` reads the credit
figure from `ir.config_parameter` (`hosting_admin.aws_cost_credit_amount`,
default $200 — `DEFAULT_CREDIT_AMOUNT`), not from any AWS call:

```python
credit_amount = float(ICP.get_param(CONFIG_PARAM_CREDIT_AMOUNT) or DEFAULT_CREDIT_AMOUNT)
```

Only *spend* (`total_spend`, `burn_rate_per_day`) comes from AWS, via
`AwsCostExplorerClient.get_daily_cost_by_trial_org`
(`custom_addons/hosting_admin/models/cost_explorer.py`), which calls Cost
Explorer's `GetCostAndUsage` grouped by the `TrialOrgId` cost-allocation tag.
`credit_remaining` (`credit_amount - total_spend`, floored at 0) and
`days_remaining_on_credit` are then both computed client-side against that
hardcoded credit figure — the dashboard has no live signal for how much
credit AWS itself still considers unapplied, or when it expires.
`docs/adr/0030-cost-dashboard-daily-snapshot-not-live-pull.md` (lines 27–29)
explicitly flags this as provisional, pending "what AWS actually permits
around credit visibility" — i.e., this ticket.

### The API: `GetCredits`

AWS Billing and Cost Management API, service `billing-2023-09-07` (a
separate, newer service from Cost Explorer's `ce` service — see "Which
service" below).

> "Returns the list of AWS account credits for the specified account. Each
> credit includes its identifier, type, monetary amounts, applicable
> products, expiration, sharing configuration, and current enabled status."

Source: [`GetCredits` API Reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html)

**Request parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `accountId` | Yes | 12-digit account ID |
| `startDate` | Yes | Unix epoch seconds; must be a past date, ≤1 year before today |
| `endDate` | No | Unix epoch seconds; defaults to current date; must not be future, must be ≥ `startDate` |
| `payerAccountFlag` | No | When `true` *and the caller is the management account*, aggregates credits across the whole consolidated billing family. Otherwise scoped to `accountId` only. |

**Response — one `CreditData` object per credit** (fields relevant to the
issue's three questions):

| Field | Answers | Type / notes |
|---|---|---|
| `initialAmount` | starting credit amount | `Amount` object: `{currencyAmount, currencyCode}` |
| `remainingAmount` | **remaining balance** | `Amount` object — "the unused balance of the credit" |
| `estimatedAmount` | remaining balance incl. unbilled/in-flight usage | `Amount` object — explicitly distinct from `remainingAmount`; not yet finalized |
| `endDate` | **expiry** | Unix epoch seconds — "the date the credit expires" |
| `exhaustDate` | when balance hit zero | Unix epoch seconds — distinct from `endDate` (a credit can expire before or after it's exhausted) |
| `creditStatus` | whether it's currently active | `ENABLED` \| `DISABLED` — "whether the credit participates in billing runs" |
| `creditType` | classification | e.g. `Promotion`, `Refund`, `TrueUp` |
| `applicableProductNames`, `applicationType`, sharing fields | scope/applicability | secondary to the three core questions |

There is **no single "applied amount" field** — the closest derivable figure
is `initialAmount - remainingAmount` (or `initialAmount - estimatedAmount`
for the in-flight-inclusive version). This is an inference from the
documented fields, not an AWS-named value.

Source: [`CreditData`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_CreditData.html)

### Which service, and account-scope implications

`GetCredits` belongs to the **AWS Billing and Cost Management API**
(`billing-2023-09-07`), a distinct, newer service from **Cost Explorer**
(`ce`, the service the existing dashboard already calls for spend via
`GetCostAndUsage`). They are separate APIs with separate service
identifiers per AWS's own API Reference welcome page, which lists Cost
Explorer, Billing and Cost Management Dashboards, Billing, Budgets, CUR,
Free Tier, Invoicing, and Price List as distinct services each with their
own endpoint.

Source: [AWS Cost Management API Reference — Welcome](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/Welcome.html)

The `payerAccountFlag` parameter means a **linked/member account's**
credentials, called without that flag (or with it `false`), only see
credits scoped to their own `accountId` — consistent with how AWS scopes
most consolidated-billing-family data. Aggregating credits across the whole
family (the figure a "days remaining on shared credit" dashboard would
actually want, given docs/adr/0013's shared-foundation-account model) requires
calling as the **management/payer account** with `payerAccountFlag: true`.
This is stated directly in the `GetCredits` reference itself (quoted above)
— not inferred.

### Errors, permissions, and rate limits — what's documented and what isn't

`GetCredits`' own Errors section lists four error shapes:
`AccessDeniedException` ("You don't have sufficient access to perform this
action"), `InternalServerException`, `ThrottlingException` ("The request was
denied due to request throttling"), and `ValidationException`.

Source: [`GetCredits` API Reference — Errors](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html)

Two practical gaps, confirmed absent rather than assumed:

- **IAM permission name/resource shape**: the existence of
  `AccessDeniedException` confirms an IAM permission gate exists, but the
  AWS Service Authorization Reference page for the billing service
  (`list_awsbilling.html`) did not return usable action-level detail via
  this session's fetch (the page appears to render its action/resource/
  condition-key tables client-side rather than in static HTML reachable by
  this session's fetch tool). The conventional `billing:GetCredits` action
  name can be inferred from the API operation name and service prefix per
  AWS's own naming convention, but this session could **not** independently
  confirm its exact IAM action string, required resource ARN pattern, or
  condition keys against the authoritative Service Authorization Reference.
  This should be verified directly (e.g. via the IAM console's policy
  visual editor, which lists real action names per service) before writing
  an IAM policy against it.
- **Rate limit / throttling quota**: AWS's Billing user guide "Quotas and
  restrictions" page documents concrete numeric quotas for several
  Billing/Cost Management surfaces (e.g. the Price List Query API's
  token-bucket rate limits — 10 token bucket size, 5/sec refill, per
  operation), but **contains no entry at all for `GetCredits` or "credits"
  generally**. `ThrottlingException` being a possible response confirms
  *some* limit exists; AWS does not publish its value for this operation.
  Source: [Quotas and restrictions — AWS Billing User Guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-limits.html)

### Data freshness / lag — unanswerable from primary sources

Per the parallel data-lag research on sibling ticket #233
(`docs/research/.wayfinder/233-data-lag.md`, section 5), the `GetCredits`
API reference and its `CreditData` shape page are both **silent on refresh
cadence, staleness bound, or "as of" timestamp semantics** — unlike Cost
Explorer (`GetCostAndUsage`) and Cost and Usage Reports, which both state
explicit lag figures ("about 24 hours", "at least once every 24 hours",
etc.) in their own AWS docs. No companion user-guide page describing
`GetCredits`' underlying data pipeline or latency was found in this
session's research either — independently corroborating #233's conclusion.
It would be reasonable to *assume* credit balances lag at least as much as
the finalized cost data they're netted against, but that is an inference,
not an AWS-documented figure.

### Answer to the issue's three questions

1. **Remaining balance** — yes, `remainingAmount` (unused, finalized) and
   `estimatedAmount` (including in-flight/unbilled usage) both directly
   exposed by `GetCredits`.
2. **Applied amount** — not a named field; derivable as
   `initialAmount - remainingAmount` (or `- estimatedAmount`).
3. **Expiry** — yes, `endDate` directly exposed; `exhaustDate` (when the
   balance actually hit zero, which can differ from `endDate`) also exposed.

**Is it available outside the console at all?** Yes — unambiguously, via a
real, currently-documented API (`GetCredits`, `billing-2023-09-07`), not a
console-only surface. This overturns the assumption implicit in the current
dashboard's config-parameter workaround: a live credit read is technically
possible today.

**Is it practical?** Mostly yes, with two open gaps that block a
confident implementation decision without further verification:
IAM permission/resource details were not independently confirmed against
the Service Authorization Reference in this session (see above), and data
freshness for credit figures is genuinely undocumented by AWS — a synthesis
decision (ticket #235) should not assume same-day freshness for credit
figures without either an AWS statement to that effect or empirical
measurement, both out of scope for this primary-source-only spike.

### Sources

- [`GetCredits` API Reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html)
- [`CreditData` API Reference](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_CreditData.html)
- [AWS Cost Management API Reference — Welcome (service list/endpoints)](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/Welcome.html)
- [Quotas and restrictions — AWS Billing User Guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-limits.html)
- Sibling research: `docs/research/.wayfinder/233-data-lag.md` (independently corroborates the "freshness undocumented" finding for `GetCredits`)
- Repo context: `custom_addons/hosting_admin/models/cost_dashboard.py`, `custom_addons/hosting_admin/models/cost_explorer.py`, `docs/adr/0030-cost-dashboard-daily-snapshot-not-live-pull.md`
