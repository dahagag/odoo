## Findings — AWS native cost controls: alerting vs. enforcement

Research date: 2026-09-09. Scope: issue #232 (wayfinder spike, child of map #228,
which charts #206) — what AWS Budgets, AWS Budget Actions, and AWS Cost Anomaly
Detection actually provide, and precisely where the line sits between
*alerting* on spend and *enforcing* a hard limit. No hard spend cap is assumed
to exist; every capability claim below is tied to the AWS primary-source page
it came from. Sources checked: `docs.aws.amazon.com` (Cost Management user
guide, EC2 user guide, account billing guide) and the official AWS Budgets /
AWS Billing FAQ pages. No blog posts were used.

### TL;DR — Where the line sits

AWS's native cost-control tooling is overwhelmingly an alerting/notification
system, not a hard enforcement system. AWS Budgets and Cost Anomaly Detection
only ever *tell you* about spend after the fact, with a documented data lag.
The one mechanism with any teeth — **Budget Actions** — can execute a small,
pre-configured set of *identity- and resource-scoped* responses (deny an IAM
policy, attach an SCP, stop specific EC2/RDS instances) when a budget
threshold is crossed. It does not provide anything equivalent to a
GCP-style account-wide billing kill switch: it cannot block all future
usage-based charges across every AWS service in real time, it cannot claw
back charges already accrued before it fires, it only acts on
resources/identities explicitly wired up in advance, and it evaluates
against the same lagged cost data as ordinary budget alerts. No hard,
all-charges-stopping limit exists anywhere in the reviewed primary
documentation — and AWS's current public docs/FAQs do not contain an
explicit "there is no hard limit" disclaimer (see
[§4](#4-explicit-aws-statements-on-hard-limits)); the absence of such a
capability is established by the mechanism itself, not by an AWS admission.

### 1. AWS Budgets

**What it monitors.** AWS Budgets supports several distinct budget types:

- **Cost budgets** — spending limits per service/account, with alerts as
  costs approach/exceed a threshold.
- **Usage budgets** — usage limits, with alerts on approach/exceed.
- **RI utilization budgets** and **RI coverage budgets** — alert when
  Reserved Instance utilization drops below, or coverage falls below, a set
  threshold.
- **Savings Plans utilization budgets** and **Savings Plans coverage
  budgets** — same pattern for Savings Plans.
- Budgets can use **custom periods** (e.g., aligned to a project or fiscal
  window).

Source: [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

**Granularity / cost basis.** "Budgets can track your blended, unblended,
net unblended, amortized, and net amortized costs. Budgets can include or
exclude charges such as discounts, refunds, support fees, and taxes."
(same source as above)

**Alert thresholds.** Notifications can be configured for **actual** spend
(after it accrues) and/or **forecasted** spend (before it accrues), as
either an absolute dollar amount or a percentage of the budgeted amount.
Sources: [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html);
threshold mechanics in [Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html)
("Next to the threshold, choose **Actual**... Or, choose **Forecasted**...").

**Notification mechanisms.** "You can have notifications sent to an Amazon
SNS topic, to an email address, or to both." Chat notification is also
supported via Amazon Q Developer in chat applications (the current branding
for what was AWS Chatbot), which can route SNS-based alerts into Slack or
Amazon Chime. Sources: [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html);
[Receiving budget alerts in chat applications](https://docs.aws.amazon.com/cost-management/latest/userguide/sns-alert-chime.html);
chat-config field confirmed in [Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).

**Refresh / update latency — not real-time.** Per the current AWS Budgets
user guide: *"AWS Budgets information is updated up to three times a day.
Updates typically occur 8–12 hours after the previous update."* Source:
[Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

The same page carries an explicit lag disclaimer: *"There can be a delay
between when you incur a charge and when you receive a notification from
AWS Budgets for the charge. This is due to a delay between when an AWS
resource is used and when that resource usage is billed. You might incur
additional costs or usage that exceed your budget notification threshold
before AWS Budgets can notify you, and your actual costs or usage may
continue to increase or decrease after you receive the notification."*
Source: same as above.

### 2. AWS Budget Actions

**Trigger types.** Budget Actions attach to an alert threshold on a cost or
usage budget, evaluated on either **actual** or **forecasted** cost/usage —
the same actual/forecasted distinction as ordinary budget alerts (a Budget
Action is an action bolted onto that same alert). Source:
[Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).

**What Budget Actions can execute.** AWS states directly: *"Your available
actions include applying an IAM policy or a service control policy (SCP).
They also include targeting specific Amazon EC2 or Amazon RDS instances in
your account."* Concretely, three action types:

1. **Apply an IAM (identity) policy** — e.g., a custom `Deny` policy
   restricting a user/group/role from provisioning further resources of a
   given type.
2. **Attach a Service Control Policy (SCP)** — applied via AWS
   Organizations, explicitly noted as usable to restrict an account "so
   that you don't need to provision any new resources during the budget
   period." Only a management account can apply SCPs.
3. **Target specific Amazon EC2 or Amazon RDS instances** — i.e., stop
   those named instances.

Multiple actions can be attached to a single threshold. Actions can run
**automatically** or require **manual approval** first: *"Do you want to
automatically run this action when this threshold is exceeded... If you
choose No, then you run the action manually on the Alert details page."*

Sources: [Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html);
approval mechanics from [Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).

**Explicit scoping limit stated by AWS.** *"From the management account,
you can apply an SCP to another account. However, you can't target Amazon
EC2 or Amazon RDS instances in another account."* Source:
[Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) —
an AWS-stated limitation, not an inference.

**What Budget Actions cannot do (and whether AWS says so explicitly).**

- **Cannot block arbitrary new usage-based charges across all AWS services
  in real time.** Not stated as a limitation anywhere in the reviewed AWS
  docs; it is an inference from the documented action set, which is limited
  to (a) IAM deny policies scoped to whatever actions/resources are written
  into the policy, (b) SCPs scoped to an OU/account, and (c) stopping
  specifically-named EC2/RDS instances. No "stop all billing" action type
  is documented in [Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)
  or [Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).
- **Cannot claw back or prevent charges already accrued before the action
  fires.** Not stated specifically about Budget Actions, but follows
  directly from the documented refresh/lag behavior of the underlying
  budget data (§1) — the action only fires once the lagged
  threshold-crossing is detected, by which point usage has already
  occurred, and per AWS's own disclaimer "your actual costs or usage may
  continue to increase... after you receive the notification." This is an
  inference from the documented data-lag mechanism, applied to actions by
  extension — treat it as inferred, not an explicit AWS admission.
- **Not a GCP-style hard billing-account shutoff.** Not stated in these
  terms anywhere in AWS docs (AWS does not compare itself to GCP). This is
  an inference from the fact that every documented action type is scoped to
  specific, pre-identified IAM identities/resources or an OU/account SCP —
  never "the account's billing capability" as a whole.

### 3. AWS Cost Anomaly Detection

**What it is.** *"AWS Cost Anomaly Detection is a feature that uses machine
learning models to detect and alert on anomalous spend patterns in your
deployed AWS services."* It evaluates seasonality/natural growth to reduce
false positives and supports root-cause investigation (by service, account,
Region, usage type). Source:
[Detecting unusual spend with AWS Cost Anomaly Detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html).

**Alerting-only — no enforcement/action capability.** The entire documented
feature set is: alerts via email or Amazon SNS (optionally routed to
Slack/Chime via Amazon Q Developer in chat applications), root-cause
investigation, and configuration of which cost dimensions to monitor.
Nowhere on that page, nor its linked sub-topics (setup, access control,
EventBridge integration, User Notifications integration), is there any
action/remediation capability comparable to Budget Actions. AWS does not
explicitly say "Cost Anomaly Detection cannot take action"; this is
confirmed by the complete absence of any action/enforcement feature in the
documented capability list, not by a direct disclaimer. Source: same as
above.

**Data lag.** *"Cost Anomaly Detection uses data from Cost Explorer, which
has a delay of up to 24 hours. As a result, it can take up to 24 hours to
detect an anomaly after a usage occurs."* It runs "approximately three
times a day" once billing data is processed. New monitors need up to 24
hours before they start detecting, and a newly-subscribed service needs 10
days of historical usage data before it can be evaluated. Source: same as
above.

**Thresholds vs. ML pattern detection.** Budgets require a fixed/variable
numeric threshold (dollar amount or percentage) chosen by the customer.
Cost Anomaly Detection instead uses ML models trained on historical spend
to flag statistically unusual patterns without a specified number —
explicitly framed by AWS as evaluating "weekly or monthly seasonality and
natural growth" to avoid the false positives a static threshold would
produce. Source: same as above.

Also note a documented coverage gap: Cost Anomaly Detection "does not
monitor third-party products and services available through AWS
Marketplace" (except third-party foundation models on Bedrock) — for that,
AWS explicitly redirects customers to Budgets instead. Source: same as
above.

### 4. Explicit AWS statements on hard limits

Checked the current **AWS Budgets FAQ**
([aws.amazon.com/aws-cost-management/aws-budgets/faqs/](https://aws.amazon.com/aws-cost-management/aws-budgets/faqs/)),
the current **AWS Billing FAQ**
([aws.amazon.com/aws-cost-management/aws-billing/faqs/](https://aws.amazon.com/aws-cost-management/aws-billing/faqs/)),
the **Understanding unexpected charges** billing guide page
([docs.aws.amazon.com/awsaccountbilling/.../checklistforunwantedcharges.html](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/checklistforunwantedcharges.html)),
and the **"Control Your AWS Costs" Free Tier tutorial**
([docs.aws.amazon.com/hands-on/.../control-your-costs-free-tier-budgets.html](https://docs.aws.amazon.com/hands-on/latest/control-your-costs-free-tier-budgets/control-your-costs-free-tier-budgets.html)).

**Result: no explicit statement of the historical form "there isn't a way
to set a hard limit on your AWS costs" was found on any currently-live AWS
primary-source page checked.** The AWS Budgets FAQ describes Budgets purely
in terms of alerting ("alert you when you exceed... your budgeted cost or
usage amount") and mentions "budgets with actions" as a paid feature
without itself disclaiming hard-limit capability. The Billing FAQ and the
unexpected-charges guide describe how charges continue to accrue in various
scenarios (Free Tier overage continues as pay-as-you-go with the account
left open, disabled Regions still bill for existing resources, closed
accounts still generate a final bill and continue billing for active
Reserved Instances/Savings Plans/Marketplace subscriptions) but do not
contain a single consolidated "no hard limit exists" statement.

This is flagged plainly rather than fabricating a quote: **a sentence like
this may have existed in an older FAQ revision, but it is not present in
the current live pages fetched for this research.** The absence of a hard
account-wide-limit *feature* is nonetheless independently confirmed by the
mechanism-level evidence in §1–§3: no AWS Budgets, Budget Actions, or Cost
Anomaly Detection capability described anywhere in the current
documentation stops all account-wide billing; the closest thing (Budget
Actions) is scoped to pre-configured identities/resources, detailed next.

### 5. Practical scoping caveats

**Budget Action targets must be explicitly pre-configured — nothing is
automatic/blanket.** Setting up a Budget Action requires: (a)
selecting/assigning an IAM role with the correct permissions so "AWS
Budgets can... perform an action on your behalf" (cross-referenced from
[Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html)
to the role-setup topic in the same guide); (b) explicitly choosing the
action type (IAM policy / SCP / EC2 or RDS instance target); and (c)
"complet[ing] the fields related to the resources that you want to apply
the action to" for whichever action type was chosen — i.e., naming the
specific policy, OU/account, or instance IDs ahead of time. Source:
[Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).
No mechanism is documented that automatically discovers or blankets all
resources/identities in an account — every target is explicit.

**IAM/SCP deny actions stop future API calls, not already-running resource
charges.** Confirmed at the EC2 billing-state level: a **stopped** EC2
instance is not billed for instance usage, but *"Charges are incurred for
the storage of any Amazon EBS volumes"* while stopped, and an Elastic IP
address left unattached/unreleased after an instance is terminated
continues to be billed. Source:
[Amazon EC2 instance state changes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html) —
table note: *"Some AWS resources, such as Amazon EBS volumes and Elastic IP
addresses, incur charges regardless of the instance's state."* Corroborated
by the billing guide's unexpected-charges checklist, which lists EBS
volumes/snapshots and Elastic IP addresses as independent, ongoing charge
sources that survive instance stop/terminate and require separate manual
cleanup: *"If you don't need that IP address anymore, release it to avoid
additional charges."* Source:
[Understanding unexpected charges](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/checklistforunwantedcharges.html).
So even a successful "stop EC2 instance" Budget Action leaves EBS/EIP
charges accruing — an SCP/IAM deny action similarly blocks *new* API calls
(e.g., launching more instances) but does nothing to resources that are
already running and were not explicitly targeted.

**Action evaluation runs against the same lagged cost/billing data as
budget alerts — not real-time.** AWS does not publish a separate, faster
data pipeline for Budget Actions distinct from ordinary budget threshold
evaluation; Budget Actions attach to the same alert-threshold mechanism
described in §1, fed by budget data documented to refresh "up to three
times a day," "typically 8–12 hours" apart, with the explicit caveat that
"you might incur additional costs or usage that exceed your budget
notification threshold before AWS Budgets can notify you." Sources:
[Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html);
action-attachment mechanics in
[Configuring a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html).
AWS does not state this lag applies to actions in a dedicated sentence —
this is a direct inference from the shared mechanism, not a separate AWS
admission, and should be read as such.

### What AWS does NOT support / open questions

- No AWS-documented mechanism stops **all** account-wide billing when a
  threshold is crossed (see [§4](#4-explicit-aws-statements-on-hard-limits)
  and [§2](#2-aws-budget-actions)).
- No explicit current-FAQ sentence disclaiming a hard spending limit was
  found (see [§4](#4-explicit-aws-statements-on-hard-limits)) — treat the
  absence of the capability as established by the mechanism, not by an AWS
  admission.
- Whether Budget Actions' "up to 3x/day, 8–12 hours apart" cadence has a
  faster path available anywhere (e.g., via Cost and Usage Report or
  Cost Explorer APIs feeding a custom enforcement Lambda instead of native
  Budget Actions) was out of scope for this spike and would need separate
  research if issue #228 wants to pursue a custom-built enforcement path
  instead of native Budget Actions.
