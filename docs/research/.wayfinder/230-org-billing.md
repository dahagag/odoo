## Findings — AWS credit mechanics across Management and member accounts

Research date: 2026-09-09. Scope: issue #230 (wayfinder spike), a child of map
#228 ("AWS credit visibility and upfront expense control") and grandchild of
#206. The question: how do AWS credits (promotional, Support/Activate,
Enterprise Discount Program) apply across a Management account and its
member accounts in an AWS Organization using Consolidated Billing, and which
account's spend do they offset? This matters because the epic (#193) runs
three accounts. Primary sources only (AWS's own docs); every claim below is
tied to the AWS page it came from.

### Account topology (context)

Per `docs/adr/0013-aws-organizations-for-hosting-foundation.md` and
`docs/adr/0015-production-migrates-to-aws-platform-account.md`, the epic
(#193) runs **one AWS Organization with Consolidated Billing** and three
accounts:

- **Management account** — owns billing and Organization structure only;
  deliberately kept workload-free.
- **Hosting Account** — runs all Trial Org / Client Org workloads (per-org
  EC2, Step Functions, trial data).
- **Platform Account** — runs agentic-erp's own production Odoo instance and
  (per ADR-0034) the new Administration Stack; reaches the Hosting Account
  via a narrow cross-account IAM role (ADR-0019).

### Summary / Direct answer

**Credits can offset any account's spend across the whole Organization, but
only when "credit sharing" is turned on** (it is on by default but is a
revocable, management-account-only setting). With sharing on, a credit
issued to any one account in the family is drawn down against usage
anywhere in the consolidated bill according to an AWS-documented allocation
algorithm — not restricted to the account it was issued to, and not
restricted to the Management account. If sharing is off, a credit applies
only to the account that owns it.
Source: [Applying AWS credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html)

### 1. Do credits on one account offset charges in other accounts?

Yes, when credit sharing is enabled. AWS's consolidated-billing docs state
that "the consolidated billing feature of AWS Organizations treats all the
accounts in the organization as one account" for billing purposes generally.
Source: [Consolidating billing for AWS Organizations](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/consolidated-billing.html)

For credits specifically: "With credit sharing on, the remaining credit
balance... is applied across all applicable usage incurred by member
accounts." Only the **Management (payer) account** can turn credit sharing
on/off, per account, and can additionally restrict a *specific* credit to a
Cost-Category-defined subset of accounts via a credit-level sharing
preference. If sharing is off, credits apply only to the owning account.
Source: [Applying AWS credits — Step 3, Step 4](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#credits-for-orgs)

**Mid-month join/leave caveat:** if an account is standalone at the start of
a calendar month and joins the Organization mid-month, its own credits still
cover only its own usage for that partial month; Organization-wide sharing
begins on the first day of the *following* month. Symmetrically, a departing
account's credits keep benefiting the consolidated bill through the end of
the month it leaves.
Source: [Applying AWS credits — Step 3](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#credits-for-orgs)

### 2. How AWS decides which account/charge absorbs a credit

AWS documents an explicit, two-layer, non-configurable ordering algorithm:

**Which credit is drawn down first**, when an account has more than one
eligible credit: (1) soonest to expire, (2) fewest eligible (applicable)
services, (3) oldest credit.
Source: [Applying AWS credits — Step 1](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#selecting-credits-to-apply)

**Which account/charge the credit is applied to**, once sharing is on:
(1) the owning account's own charges are covered first; (2) remaining credit
then flows to the account in the Organization with the **highest spend**;
(3) within that account, charges are grouped, and the group with the
highest total charge is covered first; (4) within the group, the single
largest charge is covered first. This repeats until the credit is exhausted
or all eligible spend is covered.
Source: [Applying AWS credits — Step 2](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#selecting-usage-to-apply-credits-to)

Practically: this is algorithmic, not something an invoice-level setting can
override — there is no control to say "apply this credit to the Hosting
Account specifically." The only lever is the account-inclusion/exclusion
scoping described in §4.

### 3. Restrictions by service, expiration, or credit type

- **Service eligibility**: every credit carries an "Applicable products"
  list. AWS's promotional-credit terms explicitly exclude Amazon Mechanical
  Turk, AWS Managed Services, some AWS Support tiers, **AWS Marketplace**,
  Professional Services, Training/Certification, domain registration,
  crypto-mining services, **upfront fees for Savings Plans/Reserved
  Instances**, and **tax**.
  Source: [Redeem Your AWS Promotional Credit](https://aws.amazon.com/awscredits/)
- **Expiration**: credits carry a hard expiration date (`endDate`); once
  passed, the credit's status becomes "Expired" and any unused balance is
  forfeited with no refund.
  Source: [Applying AWS credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html)
- **Credit type** (e.g. "Promotion", "Refund", "TrueUp") governs which
  console/API surfaces show a credit, but AWS's public documentation does
  not describe a type-specific *application* algorithm beyond the
  "Applicable products" eligibility list — the ordering rules in §2 are
  described generically, not per credit type.

### 4. Control, prioritization, and visibility

Two management-account-only controls exist:

1. **Credit sharing activation** — a per-account on/off toggle, plus a
   default applied to newly-joining accounts.
   Source: [Customizing your Billing preferences — Credit sharing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-pref.html#credit-sharing-preferences)
2. **Credit-level sharing preferences** — restrict one specific credit to a
   Cost-Category-defined group of accounts (the credit owner and every
   recipient account must each separately have sharing activated).
   Source: [Applying AWS credits — Credit-level sharing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#credit-level-sharing-preferences)

There is **no invoice-time priority knob** beyond these two — you can
include or exclude accounts from a credit's eligible pool, but you cannot
force the highest-spend/highest-charge algorithm in §2 to prefer one
included account over another.

**Visibility into which account a credit offset**: the Billing console's
credit-details page has an "Application history" view showing recipient
account, service, product, and amount, per allocation. This is the closest
AWS surface to "which account's spend did this credit offset."
Source: [Applying AWS credits — Step 1 (viewing credit details)](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html#selecting-credits-to-apply)

By default, only the **Management account** sees full cost, refund, and
credit data for every account in the Organization. A member account sees
only its own cost/usage data unless the Management account explicitly
grants it "Linked account access" including refunds-and-credits visibility
— and even then, **a member account can never see another member account's**
costs, refunds, or credits; that access can only be granted org-wide (every
member sees Management's aggregate/every other member), not selectively
between two specific member accounts.
Source: [Controlling access to Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-access.html)

**Repo-relevant implication**: the Administration Stack and its cost
dashboard run in the **Platform Account** (a member account, not
Management, per ADR-0015/ADR-0034). It therefore cannot natively read
consolidated per-account credit-allocation detail unless the Management
account both (a) grants Cost Explorer credit/refund visibility org-wide, and
(b) the Platform Account's cross-account role (ADR-0019) is scoped to query
that data as/via Management. This is an access-model gap for the epic's
"credit visibility" goal that AWS's access model does not close by default.

### 5. Caveats and impracticalities

- **Marketplace and RI/Savings-Plan upfront fees are structurally excluded**
  from credit coverage (§3) — relevant because on-demand EC2/Step Functions
  spend in the Hosting Account is exactly the kind of usage credits *do*
  cover, but any future Marketplace add-ons or upfront RI/SP purchases would
  not be offset by these credits.
  Source: [Redeem Your AWS Promotional Credit](https://aws.amazon.com/awscredits/)
- **The Cost Explorer visibility model is binary and org-wide, not
  peer-to-peer** — a member account can be granted visibility into
  Management's aggregate data, but two member accounts (e.g. Platform and
  Hosting) cannot be given visibility into each other's costs/credits
  directly; this shapes what the Administration Stack can query without
  routing through Management.
  Source: [Controlling access to Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-access.html)
- **Reserved Instance / Savings Plan sharing is a separate preference** from
  credit sharing, with its own three modes (Open / Prioritized group /
  Restricted group), also scoped via Cost Categories; the Management account
  itself cannot belong to any RI/SP sharing group. Distinguishing this from
  credit sharing matters because the two are configured and reasoned about
  independently.
  Source: [Customizing your Billing preferences — RI/SP discount sharing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-pref.html#reserved-instances-savings-plans-preferences)
- **Enterprise Discount Program (EDP) credits — unanswerable from AWS
  primary sources.** EDP / Private Pricing Agreement terms are individually
  negotiated contracts, not publicly documented mechanics. No page under
  `docs.aws.amazon.com` was found describing how EDP-specific credits
  interact with the consolidated-billing credit-application algorithm in
  §2. This should be confirmed directly against this org's own AWS
  agreement/account team rather than inferred, if and when an EDP is
  negotiated (per #228's broader scope).
- **AWS Support/Activate credits** are not described separately from the
  generic "Promotional Credit" mechanics documented above — AWS does not
  publish a materially different application algorithm for Activate-issued
  credits; they are simply another `Credit type` value subject to the same
  expiration, eligibility, and sharing rules described in §§1–3.

### Sources

- [Consolidating billing for AWS Organizations](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/consolidated-billing.html)
- [Applying AWS credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html)
- [Customizing your Billing preferences](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-pref.html)
- [Controlling access to Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-access.html)
- [Redeem Your AWS Promotional Credit](https://aws.amazon.com/awscredits/)
- Repo context: `docs/adr/0013-aws-organizations-for-hosting-foundation.md`,
  `docs/adr/0015-production-migrates-to-aws-platform-account.md`,
  `docs/adr/0034-administration-stack-owns-org-record-of-truth.md`,
  `docs/adr/0019` (cross-account IAM role, Platform → Hosting)
- Sibling research: `docs/research/.wayfinder/229-credit-visibility.md`
  (the `GetCredits` API — programmatic access to per-credit balance/expiry,
  including the `payerAccountFlag` aggregation behavior that corroborates
  the Management-account-only visibility finding in §4 above)
