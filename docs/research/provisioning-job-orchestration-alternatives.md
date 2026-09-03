# SQS, AWS Batch, and OCA queue_job as job execution machinery for OpenTofu provisioning

Research date: 2026-09-03. Scope: three further candidates for the same
execution-semantics gap covered in
[`step-functions-for-provisioning-jobs.md`](step-functions-for-provisioning-jobs.md)
— a mutex so two lifecycle actions never race on the same Trial Org, a
bounded timeout on the `tofu plan`/`tofu apply`/`tofu destroy` subprocess, and
retry/idempotency so a retried attempt doesn't double-apply or target the
wrong org's state, for the `hosting_admin` addon's Trial Org lifecycle
actions (Issue/Extend/Suspend/Wake/Destroy) against
[ADR-0016](../adr/0016-opentofu-for-static-and-per-trial-provisioning.md).
That note already covered two options — hand-rolling the machinery in Python
inside `hosting_admin`, and AWS Step Functions + ECS/Fargate
`RunTask.sync` — and found Step Functions documents no built-in mutex for
standard workflows. This note is a direct follow-up covering three more
candidates the repo owner asked to have researched before deciding: SQS
(FIFO queue + worker), AWS Batch, and the OCA `queue_job` Odoo addon. It
closes with a five-way comparison table across all options researched so
far. Like the prior note, this one does not recommend a choice — it exists
to inform a follow-up decision.

Every claim below is tied to the primary source it came from — AWS's own
developer/user guides and API reference for SQS and Batch, and the OCA
`queue_job` addon's own README files, read from its GitHub repository. Where
a vendor's docs were thin or didn't answer the question, that is listed
under [Unverified / could not confirm](#unverified--could-not-confirm)
instead of being stated as fact.

## 1. SQS (FIFO queue + worker) using visibility timeout as a lease

### Visibility timeout: what it actually locks

AWS's own definition is message-scoped, not resource-scoped:

> "When you receive a message from an Amazon SQS queue, it remains in the
> queue but becomes temporarily invisible to other consumers. This
> invisibility is controlled by the visibility timeout, which ensures that
> other consumers cannot process the same message while you are working on
> it."

and, on standard queues specifically:

> "The visibility timeout in standard queues prevents multiple consumers
> from processing the same message at the same time. However, because of
> the at-least-once delivery model, Amazon SQS doesn't guarantee that a
> message won't be delivered more than once within the visibility timeout
> period."

The timeout defaults to 30 seconds, is adjustable per-queue or per-message
via `ChangeMessageVisibility`, and is hard-capped: "the visibility timeout
has a maximum limit of 12 hours from when the message is first received.
Extending the timeout doesn't reset this 12-hour limit." AWS's own
recommendation for a task that might exceed this is to use Step Functions or
split the task into smaller steps.
Source: [Amazon SQS Developer Guide — Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).

This confirms the research brief's framing exactly: visibility timeout is a
**message**-level lock (one message, one consumer, for the timeout's
duration), not automatically a Trial-Org-level lock. It would only become a
Trial-Org mutex if the caller's own design guarantees at most one
in-flight/unprocessed message exists per Trial Org at a time — which is not
a property SQS itself provides for a plain (non-FIFO) queue; a second
lifecycle-action message for the same org could sit in the queue and be
picked up by a second free consumer concurrently, since the message-level
lock says nothing about other messages.

### FIFO queues: message group ID as per-key ordering + serialization

AWS's FIFO-specific page states message-group behavior directly, and frames
per-group serialization as a documented mechanism (not merely an emergent
property of visibility timeout):

> "Each message group ID represents a distinct, ordered group of messages.
> Within a message group ID, all messages are sent and received in strict
> order. Messages with different message group IDs may arrive or be
> processed out of order relative to one another."

and on retrieval:

> "You may receive multiple messages from the same message group ID in one
> batch... However, you can't receive additional messages from the same
> message group ID in subsequent requests until: The currently received
> messages are deleted, or They become visible again (for example, after the
> visibility timeout expires)."
>
> "No additional messages from the same message group ID are returned until
> the first message is deleted or becomes visible again."

Source: [Amazon SQS Developer Guide — FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html).

Using the Trial Org id as `MessageGroupId` would therefore make AWS's own
documented FIFO mechanics do double duty: strict per-org ordering (a second
lifecycle action for the same org can't be delivered to any consumer ahead
of, or concurrently with, the first) and single-consumer-at-a-time
processing per org, for as long as the in-flight message stays undeleted and
within the visibility timeout. AWS's own retrying-multiple-times section for
FIFO queues states this composes cleanly with retries: producer retries
using the same `MessageDeduplicationId`, and consumer `ReceiveMessage`
retries, are both documented as order-preserving and non-duplicating as long
as an acknowledgment lands before the relevant window expires.
Source: [Amazon SQS Developer Guide — FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html).

**`MessageGroupId` alone is not a complete mutex, though — the same page's own delivery-logic
text has two caveats a real implementation must handle.** First, `ReceiveMessage` "may receive
multiple messages from the same message group ID in one batch" — a worker must still process
messages from one group serially itself, not assume SQS hands them out one at a time. Second, a
message becomes eligible for redelivery once its visibility timeout expires, even if the worker
is still actively processing it (e.g. still running a long `tofu apply`) — so a worker running
`tofu` for longer than the queue's configured visibility timeout must extend it
(`ChangeMessageVisibility`) periodically while work is in flight, and must delete the message only
after `tofu` actually completes, not on receipt. Skipping either of these would let a second
worker pick up the same group while the first is still working.
Source: [Amazon SQS Developer Guide — FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html).

Note this is still bounded by the same 12-hour visibility-timeout ceiling
documented above — it constrains how long one message (and thus one
Trial Org's group) can stay "locked" before SQS makes it visible again for
redelivery, which is not itself a `tofu apply` process timeout but is a hard
outer bound on how long a stuck lock can persist undetected.

### Redrive policy / DLQ for retry-limit enforcement

> "Use a redrive policy to specify the `maxReceiveCount`. The
> `maxReceiveCount` is the number of times a consumer can receive a message
> from a source queue before it is moved to a dead-letter queue. For
> example, if the `maxReceiveCount` is set to a low value such as 1, one
> failure to receive a message would cause the message to move to the
> dead-letter queue."

The dead-letter queue itself is a separate, ordinary SQS queue that must be
created first, in the same account/region as the source queue; a **redrive
allow policy** on the DLQ controls which source queues may target it
(`allowAll`, `byQueue` up to 10 source-queue ARNs, or `denyAll`). AWS's own
note flags a FIFO-specific caveat: "Don't use a dead-letter queue with a
FIFO queue if you don't want to break the exact order of messages or
operations" — relevant here since a Trial Org's lifecycle actions are
themselves order-sensitive (e.g., a Suspend should not be reordered ahead of
an Extend for the same org).
Source: [Amazon SQS Developer Guide — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).

### Deduplication (idempotency)

> "`MessageDeduplicationId` is a token used only in Amazon SQS FIFO queues
> to prevent duplicate message delivery. It ensures that within a 5-minute
> deduplication window, only one instance of a message with the same
> deduplication ID is processed and delivered."
>
> "If Amazon SQS has already accepted a message with a specific
> deduplication ID, any subsequent messages with the same ID will be
> acknowledged but not delivered to consumers."

This is enqueue-time deduplication (stopping a second, identical
`SendMessage` call from creating a redundant message within 5 minutes) — it
is neither the state *isolation* the deterministic per-org OpenTofu state key
gives (which guarantees a retry can't cross-target another org's state, but
says nothing about whether running `tofu` twice is itself safe) nor the
execution-level idempotency ADR-0016's job-identity design gives (a persisted
per-job id reused as both the Step Functions execution name and the ECS
`RunTask` `ClientToken`). Content-based deduplication
(SQS computing a SHA-256 hash of the message body as the dedup ID when the
caller doesn't supply one) is named on this same page's linked topics but
its own mechanics were not fetched in this session — see Unverified.
Source: [Amazon SQS Developer Guide — Using the message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagededuplicationid-property.html).

### What this option still requires beyond SQS itself

SQS delivers messages; it does not run `tofu`. A worker process (long-poll
consumer) that actually shells out to `tofu` would still need to be hosted
somewhere (ECS/Fargate task, EC2, or a long-running process inside
`hosting_admin` itself) — SQS's own docs describe queueing and delivery
semantics only, not compute. The application-level `subprocess.run(...,
timeout=N)` bound on the `tofu` call itself is not something SQS provides;
only the 12-hour visibility-timeout ceiling is, and it is a much coarser
bound than a per-call timeout tuned to expected `tofu apply` duration.

## 2. AWS Batch

### Retry strategy and exit-code-based conditions

AWS Batch's own job-definition parameter reference documents this directly,
confirming the brief's framing (retry only on specific exit codes, vs.
always):

> "By default, each job is attempted one time. If you specify more than one
> attempt, the job is retried if it fails. Examples of a fail attempt
> include the job returns a non-zero exit code or the container instance is
> terminated."
>
> `attempts`: "The number of times to move a job to the RUNNABLE status. You
> can specify between 1 and 10 attempts."
>
> `evaluateOnExit`: "Array of up to 5 objects that specify conditions under
> which the job is retried or failed. If this parameter is specified, then
> the `attempts` parameter must also be specified. If `evaluateOnExit` is
> specified but none of the entries match, then the job is retried."

Each `evaluateOnExit` entry has `action` (`RETRY` or `EXIT`, required) plus
optional glob-pattern matches on `onExitCode` (numeric only, up to 512
chars, optional trailing `*`), `onReason`, and `onStatusReason` — i.e., a
job definition can be configured to retry only when the container's exit
code matches a specific pattern, and fail-fast (no more attempts) on others.
Source: [AWS Batch User Guide — Job definition parameters, "Retry strategy"](https://docs.aws.amazon.com/batch/latest/userguide/job_definition_parameters.html).

### Timeout: configurable, not Lambda-style hard-capped

> "You can configure a timeout duration for your jobs so that if a job runs
> longer than that, AWS Batch terminates the job... If a job is terminated
> because of a timeout, it isn't retried."
>
> `attemptDurationSeconds`: "The time duration in seconds (measured from the
> job attempt's `startedAt` timestamp) after AWS Batch terminates unfinished
> jobs. The minimum value for the timeout is 60 seconds."

No maximum value is stated on this page — only the 60-second minimum. This
matches the research brief's framing: Batch's timeout is a caller-configured
ceiling with a documented floor, not a fixed hard limit imposed by the
service the way Lambda's 900-second ceiling is (per
[`step-functions-for-provisioning-jobs.md`](step-functions-for-provisioning-jobs.md#lambda-optimized-integration)).
An explicit timeout terminates the job outright and disables its own retry
for that termination — the caller's `evaluateOnExit`/`attempts` retry
machinery does not apply to a timeout kill, only to a process that actually
exits with a code.
Source: [AWS Batch User Guide — Job definition parameters, "Timeout"](https://docs.aws.amazon.com/batch/latest/userguide/job_definition_parameters.html).

### No native per-key concurrency control on job queues

AWS Batch's own `JobQueueDetail` API reference — the full documented shape
of a job queue's configuration and state — lists only
`computeEnvironmentOrder`, `jobQueueArn`/`jobQueueName`, `priority`,
`state` (`ENABLED`/`DISABLED`), `jobQueueType`, `jobStateTimeLimitActions`,
`schedulingPolicyArn` (fair-share scheduling), `status`/`statusReason`, and
`tags`. Nothing in this list constrains concurrency by an
application-defined key (such as "only one job for Trial Org X at a time");
`priority` only orders which queue is evaluated first across queues sharing
a compute environment, and explicitly "doesn't guarantee that a particular
job executes before a job in a lower priority queue." A scheduling policy
(fair-share) governs relative scheduling weight between users/keys, not
mutual exclusion.
Source: [AWS Batch API Reference — `JobQueueDetail`](https://docs.aws.amazon.com/batch/latest/APIReference/API_JobQueueDetail.html).

This means AWS Batch, like Step Functions, would still need an external lock
(a DynamoDB-conditional-write lock like the one ADR-0016 actually adopted for
Step Functions, an Odoo DB-row lock, or an SQS-FIFO-style mechanism) layered
on top to serialize actions on the same Trial Org — Batch gives retry and
timeout natively, but not per-key mutual exclusion.

### Fargate-backed compute environments

> "Fargate is a technology that you can use with AWS Batch to run
> containers without having to manage servers or clusters of Amazon EC2
> instances. With Fargate, you no longer have to provision, configure, or
> scale clusters of virtual machines to run containers. This removes the
> need to choose server types, decide when to scale your clusters, or
> optimize cluster packing."

This is the AWS-documented way to avoid the EC2-management overhead
mentioned in the research brief; the same page states Fargate is only
available for Batch compute environments using Amazon ECS as the
orchestrator (not for Batch-on-EKS).
Source: [AWS Batch User Guide — Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html).

### What this option still requires beyond ADR-0016

A job queue, one or more compute environments (Fargate-backed, per above),
and a job definition (container image bundling `tofu`, IAM role, retry
strategy, timeout) are all new AWS resources distinct from anything ADR-0016
already establishes, plus the IAM surface for `batch:SubmitJob` and related
actions from `hosting_admin`. Unlike Step Functions, no new
authoring-language surface (ASL) is introduced — job definitions are plain
JSON parameter objects — but the mutex gap is identical to Step Functions':
neither service documents one.

## 3. Odoo-native async job queuing — OCA `queue_job`

### Whether it is already present in this repo

Checked by search, not assumption: `custom_addons/` contains only
`crm_methodology`, `dev_e2e_smoke_test`, and `example_addon` (plus a
top-level `README.md`); a case-insensitive recursive grep for `queue_job`
across `custom_addons/` returned no matches, and `requirements.txt` at the
repo root contains no `queue_job`/OCA entry. **`queue_job` is not currently
a dependency anywhere in this repo.** Odoo core's own scheduled-task
machinery (`ir.cron`) is present as part of the vendored Odoo source tree in
`odoo/` (this is upstream Odoo itself, not an addon choice), but `ir.cron`
runs on a fixed schedule/interval, not per lifecycle-action event, so it was
not researched further here as a fit for this per-action trigger shape.

### Identity key: per-key job-creation dedup, not a running-job lock

The addon's own usage docs describe `identity_key` as an enqueue-time
option:

> "identity_key: key uniquely identifying the job, if specified and a job
> with the same key has not yet been run, the new job will not be created"

Source: [`OCA/queue` — `queue_job/readme/USAGE.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/USAGE.md).

This is the addon's own name for the feature the research brief asked about
— confirmed as `identity_key`, not "mutex" or "semaphore" in the addon's own
vocabulary. Read literally, its documented behavior stops a **second job
record with the same key from being created** while an existing one with
that key has not yet run to completion — the closest documented analogue to
a per-Trial-Org mutex among these three new options, expressed at
job-creation time rather than as a lock a running process holds and
releases.

### Retry/backoff configuration

> "max_retries: default is 5, maximum number of retries before giving up
> and set the job state to 'failed'. A value of 0 means infinite retries."
>
> "When a job fails with a retryable error type, it is automatically
> retried later. By default, the retry is always 10 minutes later."

A per-job-function `retry_pattern` overrides the flat 10-minute default,
expressed as "from X tries, postpone to Y seconds" — the addon's own
example:

```python
{1: 10, 5: 20, 10: 30, 15: 300}
```

configured via a `queue.job.function` XML record's `retry_pattern` field
(the older `@job` decorator's inline configuration is documented as
obsolete, replaced by `queue.job.function`/`queue.job.channel` records).
Retries apply only to failures the addon classifies as a "retryable error
type" — the exact error-classification mechanism (which Python exceptions
count as retryable vs. terminal) was not further traced in this session; see
Unverified.
Source: [`OCA/queue` — `queue_job/readme/USAGE.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/USAGE.md).

### Execution model, timeout, and subprocess fit

Jobs run inside the Odoo process itself, dispatched by a `Jobrunner`:

> "Jobs are executed in the background by a `Jobrunner`, in their own
> transaction."
>
> "Channels: give a capacity for the root channel and its sub-channels and
> segregate jobs in them. Allow for instance to restrict heavy jobs to be
> executed one at a time while little ones are executed 4 at a times."

Source: [`OCA/queue` — `queue_job/readme/DESCRIPTION.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/DESCRIPTION.md).

Channel capacity is a concurrency **budget** (e.g., "at most 1 job from
channel X runs at a time, across all keys in that channel"), not a per-key
mutex — routing all Trial Org lifecycle actions to a single-capacity channel
would serialize *all* Trial Orgs against each other globally, which
ADR-0016 explicitly does not want ("separate Trial Orgs must be able to
provision in parallel"); it does not by itself give one mutex per Trial Org
the way `identity_key` or a DB row lock does.

No job-level timeout/kill mechanism (comparable to Batch's
`attemptDurationSeconds` or a Python `subprocess.run(..., timeout=N)`) is
documented in the README fragments fetched in this session (`USAGE.md`,
`DESCRIPTION.md`, `CONFIGURE.md`, `ROADMAP.md`, `CONTEXT.md`) — the addon
documents job *retry* and *scheduling* behavior extensively but not a
duration cap on a single job's execution. The one documented
crash-recovery behavior found is:

> "Jobs that remain in `enqueued` or `started` state (because, for
> instance, their worker has been killed) will be automatically
> re-queued."

Source: [`OCA/queue` — `queue_job/readme/ROADMAP.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/ROADMAP.md).

This is a stuck-job recovery mechanism (a killed worker's job gets
re-queued), not a bounded-wall-clock-timeout mechanism — it says nothing
about a hung-but-still-running `tofu apply` (a subprocess that hasn't
crashed, just hasn't returned) being force-terminated after N seconds,
which is what the research brief's requirement 2 asks for. Achieving that
would still require the same `subprocess.run(..., timeout=N)` wrapping
ADR-0016's hand-rolled option already uses, with `queue_job` handling only
the outer job-retry/dispatch layer around it. Because jobs execute inside
an Odoo worker process rather than an isolated container, a long-running
`tofu apply` job would also occupy that worker (or a queue_job-channel slot)
for its full duration — the addon's own docs frame this as normal ("as soon
as the Jobrunner has a free bucket"), but it is a different resource-sharing
model than an isolated ECS/Fargate task or Lambda invocation.

### What this option still requires beyond ADR-0016

Adding `queue_job` as a new addon dependency to `hosting_admin` (it is not
currently installed anywhere in this repo, confirmed above), plus its own
setup: `--workers` greater than 1 (or the threaded server, which the
addon's own docs flag as "obviously not for production purposes"),
`server_wide_modules = web,queue_job`, and channel configuration. Unlike the
AWS-hosted options, this introduces no new AWS resource or IAM surface —
it runs inside the existing Odoo deployment — but it is a new Odoo-level
runtime dependency and process-management requirement (the addon's own
ROADMAP notes Odoo must be restarted after installing `queue_job` on an
existing database for the runner to detect it).

## 4. Comparison table

All five options researched (here and in
[`step-functions-for-provisioning-jobs.md`](step-functions-for-provisioning-jobs.md)),
purely factual/comparative — no recommendation:

| Option | Mutex / serialization | Timeout bound | Retry | New infrastructure/dependency beyond ADR-0016 |
|---|---|---|---|---|
| Hand-rolled in `hosting_admin` (rejected — see ADR-0016) | Odoo ORM row-level lock (`SELECT ... FOR UPDATE`-style) on the Trial Org record | `subprocess.run(..., timeout=N)` around the `tofu` call, app-defined | App-level retry loop keyed to the deterministic per-org state key (`trial-orgs/<id>/terraform.tfstate`) | None — pure Python inside the existing addon |
| Step Functions + ECS/Fargate `RunTask.sync` (chosen — see ADR-0016) | Not documented by AWS as a built-in construct; ADR-0016 closes the gap with an explicit DynamoDB conditional-write lock (owner-token-guarded release, EventBridge stale-lock cleanup, TTL backstop) | No documented ceiling on ECS/Fargate `RunTask.sync` task duration itself (open-ended, unlike Lambda's 900s hard cap); the EC2-API Suspend/Wake Task additionally waits for the target instance state | `Retry`/`Catch` fields on Task states (`MaxAttempts`, `BackoffRate`, `IntervalSeconds`); execution-name and `RunTask` `ClientToken` both derived from a persisted per-job id (ADR-0016's Job identity design), not from `StartExecution`'s idempotency alone | A state machine (ASL authoring, new IAM role/policy), a DynamoDB lock table, an EventBridge rule, and an ECS/Fargate task definition and cluster; all declared in the same OpenTofu foundation |
| SQS FIFO queue + worker | `MessageGroupId` = Trial Org id gets per-group ordering and single-in-flight-message-per-group delivery from AWS, but is not a complete mutex on its own — the worker must still process same-group messages serially, extend visibility while `tofu` runs, and delete only after completion (see caveats above) | 12-hour hard ceiling on visibility timeout (a coarse outer bound, not a per-`tofu`-call timeout — the worker still needs its own `subprocess.run(..., timeout=N)`) | Redrive policy `maxReceiveCount` to a DLQ; `MessageDeduplicationId` gives 5-minute enqueue-time dedup (a different guarantee than execution-level idempotency — see ADR-0016's job-identity design) | A FIFO queue + DLQ, plus a worker process/compute (not provided by SQS itself) to actually run `tofu` |
| AWS Batch | Not documented — `JobQueueDetail`'s full parameter set (priority, state, scheduling policy, tags) has no per-key concurrency control; needs the same external lock as the hand-rolled or SQS options | `timeout.attemptDurationSeconds`, minimum 60s, no documented maximum; a timeout kill is not retried | `retryStrategy` (`attempts` 1–10) with `evaluateOnExit` glob-matching on exit code/reason to choose `RETRY` vs `EXIT` per attempt | A job queue, a Fargate-backed compute environment, and a job definition (container image bundling `tofu`) — new AWS resources and IAM surface, no new authoring language (plain JSON) |
| OCA `queue_job` | `identity_key`: a second job with the same key is not *created* while an unfinished one with that key exists (per-Trial-Org key) — closest of the three new options to a per-org mutex; channels give a global concurrency budget, not a per-key lock | Not documented in the README fragments fetched — no job-level wall-clock kill mechanism found; only a killed-worker requeue behavior, unrelated to a hung-but-alive subprocess | `max_retries` (default 5) with a configurable `retry_pattern` ("after try N, wait Y seconds"); default flat 10-minute retry delay otherwise | Not currently a dependency anywhere in this repo (confirmed by search) — would be a new Odoo addon dependency, `--workers`>1, and jobrunner/channel configuration; no new AWS resource or IAM surface |

## Unverified / could not confirm

- **SQS content-based deduplication's exact mechanics** (as opposed to an
  explicit `MessageDeduplicationId`). Its existence was confirmed as a
  linked topic on the `MessageDeduplicationId` page fetched in this
  session, but that linked page's own content (how the SHA-256 hash is
  computed, exact scope) was not fetched.
- **Whether ECS/Fargate task-level or SQS in-flight-message quotas (the
  "approximately 120,000 in-flight messages" figure for standard queues,
  and the FIFO note that "limits depend on active message groups") would
  meaningfully constrain this use case's scale (1–5 concurrent Trial
  Orgs).** The fetched page states the limit exists and that FIFO's version
  is active-group-dependent, but does not give a concrete number for FIFO
  queues, and this note did not compute whether a handful of concurrent
  Trial Orgs could approach either limit (almost certainly not, but not
  independently confirmed against a stated FIFO-specific quota).
- **AWS Batch's exact IAM policy surface for `SubmitJob`/`DescribeJobs`
  from `hosting_admin`.** Not fetched in this session — only the job
  queue's own parameter shape (`JobQueueDetail`) and job-definition
  parameters (retry/timeout) were checked; the IAM/permissions page itself
  was out of scope for this pass.
- **`queue_job`'s exact error-classification mechanism** — which Python
  exception types the addon treats as "retryable" (triggering
  `retry_pattern`/`max_retries`) versus terminal. The `USAGE.md` fragment
  fetched in this session names "retryable error type" without defining
  the class hierarchy; the addon's Python source (e.g. a
  `RetryableJobError` class) was not read in this session.
- **Whether `queue_job`'s `identity_key` check is itself race-free under
  concurrent enqueue attempts** (i.e., whether two near-simultaneous
  `with_delay()` calls with the same `identity_key` are guaranteed to
  produce exactly one job via a DB-level uniqueness constraint, or whether
  there is a narrow TOCTOU window in the check-then-create logic). The
  README text quoted above states the *intended* behavior but not the
  underlying implementation guarantee; the addon's model/SQL definitions
  were not read in this session.
- **AWS Batch job-to-compute-environment scheduling latency** under this
  workload's low volume (1–5 concurrent Trial Orgs) — whether a Fargate-backed
  compute environment has any documented cold-start delay comparable to
  ECS/Fargate `RunTask.sync`'s own behavior (covered, but not fully
  resolved, in the prior note). Not separately re-checked here.

## Sources

- [Amazon SQS Developer Guide — Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS Developer Guide — FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html)
- [Amazon SQS Developer Guide — Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS Developer Guide — Using the message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagededuplicationid-property.html)
- [AWS Batch User Guide — Job definition parameters](https://docs.aws.amazon.com/batch/latest/userguide/job_definition_parameters.html)
- [AWS Batch API Reference — `JobQueueDetail`](https://docs.aws.amazon.com/batch/latest/APIReference/API_JobQueueDetail.html)
- [AWS Batch User Guide — Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html)
- [`OCA/queue` — `queue_job/readme/USAGE.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/USAGE.md)
- [`OCA/queue` — `queue_job/readme/DESCRIPTION.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/DESCRIPTION.md)
- [`OCA/queue` — `queue_job/readme/CONFIGURE.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/CONFIGURE.md)
- [`OCA/queue` — `queue_job/readme/ROADMAP.md` (18.0 branch)](https://github.com/OCA/queue/blob/18.0/queue_job/readme/ROADMAP.md)
- [`step-functions-for-provisioning-jobs.md`](step-functions-for-provisioning-jobs.md) (prior note this one follows up on)
- [ADR-0016 — OpenTofu for both the static AWS foundation and per-trial-org provisioning](../adr/0016-opentofu-for-static-and-per-trial-provisioning.md)
- Repo search of `custom_addons/` and `requirements.txt` in this repository, confirming `queue_job`/OCA is not currently a dependency.
