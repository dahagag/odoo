# AWS Step Functions as job execution machinery for OpenTofu provisioning

Research date: 2026-09-03. Scope: whether AWS Step Functions is a viable way to
get queueing (no two lifecycle actions racing on the same Trial Org), bounded
subprocess timeouts, retry limits/behavior, and idempotency keys for the
`hosting_admin` addon's OpenTofu (`tofu plan`/`tofu apply`/`tofu destroy`)
subprocess calls — the execution-semantics gap a PR reviewer flagged against
[ADR-0016](../adr/0016-opentofu-for-static-and-per-trial-provisioning.md),
which the repo owner asked to research as an alternative to hand-rolling that
machinery in Python inside `hosting_admin`. This note compares what AWS's own
documentation says Step Functions provides against that hand-rolled
alternative. It does not recommend a choice — it exists to inform a follow-up
decision, matching the style of
[`docs/research/aws-hosting-foundation-tooling.md`](aws-hosting-foundation-tooling.md).

Every claim below is tied to the primary source it came from. Where AWS's own
documentation did not clearly answer something, it is listed under
[Unverified / could not confirm](#unverified--could-not-confirm) instead of
being stated as fact.

## 1. What Step Functions provides natively

### Per-execution idempotency via the `name` parameter

`StartExecution`'s own API reference states this explicitly:

> "`StartExecution` is idempotent for `STANDARD` workflows. For a `STANDARD`
> workflow, if you call `StartExecution` with the same name and input as a
> running execution, the call succeeds and return the same response as the
> original request. If the execution is closed or if the input is different,
> it returns a `400 ExecutionAlreadyExists` error. You can reuse the name 90
> days after it closes."
>
> "`StartExecution` isn't idempotent for `EXPRESS` workflows."

The `name` parameter is optional (Step Functions generates a UUID if omitted),
must be unique per AWS account/region/state machine, and is capped at 80
characters with a restricted character set (no whitespace, brackets,
wildcards, or most special characters; CloudWatch Logs integration further
restricts it to `0-9 A-Z a-z - _`). The corresponding `ExecutionAlreadyExists`
error is defined as: "The execution has the same `name` as another execution
(but a different `input`). Executions with the same `name` and `input` are
considered idempotent."
Source: [Step Functions API Reference — `StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html).

This idempotency is scoped to a **Standard** workflow specifically — Express
workflows explicitly do not get it, and execution-name uniqueness/retention
(90 days for Standard) is confirmed as a hard quota, not adjustable, on the
service-quotas page.
Source: [Step Functions Developer Guide — Service quotas, "Quotas related to state machine executions"](https://docs.aws.amazon.com/step-functions/latest/dg/limits-overview.html).

### Retry (`Retry`) and fallback (`Catch`) fields on Task/Parallel/Map states

Both the Amazon States Language spec and AWS's own error-handling guide
define these fields consistently. Per the spec: a Task state "MAY have a
field named 'Retry', whose value MUST be an array of objects, called
Retriers," each requiring `ErrorEquals` (non-empty array of error-name
strings) and accepting optional `IntervalSeconds` (default 1),
`MaxAttempts` (default 3), `BackoffRate` (default 2.0, must be ≥1.0), and
`MaxDelaySeconds`.
Source: [Amazon States Language spec](https://states-language.net/spec.html).

AWS's Developer Guide adds a `JitterStrategy` field (`FULL`/`NONE`, default
`NONE`) not mentioned in the spec excerpt above, and states explicitly that a
`MaxAttempts` value of `0` means "the error is never retried," and that
`MaxDelaySeconds` "must specify a value greater than 0 and less than
31622401." It also documents the reserved wildcard error names
`States.ALL` (matches any error, must appear alone and last) and
`States.TaskFailed` (matches any Task error except `States.Timeout`). When a
state has no `Retry` field, or its retries are exhausted, Step Functions
"defaults to failing the **entire** state machine execution" unless a
`Catch` field is present to redirect to a fallback state.
Source: [Step Functions Developer Guide — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html).

Note a discrepancy between the two primary sources on `TimeoutSeconds`: the
Amazon States Language spec states a default of 60 seconds, while AWS's own
Task-state reference page states:

> "`TimeoutSeconds` (Optional) ... The timeout value must be positive,
> non-zero integer. **The default value is 99,999,999.**"

and the same default (99,999,999) for `HeartbeatSeconds`, which "must be a
positive, non-zero integer value less than the `TimeoutSeconds` field value."
99,999,999 seconds (~3.17 years) exceeds Standard workflows' own 1-year
maximum execution time, so in practice an unset `TimeoutSeconds` on a
Standard-workflow Task is bounded by the execution-level limit, not by the
field's own numeric default. AWS's Task-state page is the more authoritative,
service-specific source for this discrepancy — see Unverified.
Sources: [Amazon States Language spec](https://states-language.net/spec.html), [Step Functions Developer Guide — Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html).

### A `Retry` on the `ecs:runTask.sync` Task needs its own dedup, separate from `StartExecution`'s

`Retry`/`Catch` retry the *Task state*, not the whole execution — if `RunTask` succeeds but its
response is lost before Step Functions records it, a `Retry` re-entering the same Task calls
`RunTask` again. Whether that launches a second, duplicate ECS task depends entirely on ECS's own
idempotency mechanism, not on anything Step Functions itself provides:

> "If you retry a request with the same client token and identical parameters after a successful
> initial request, the service returns the result of the original, successful operation... The
> client token has a TTL of 24 hours."

Source: [Amazon ECS Developer Guide — Amazon ECS idempotency](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_Idempotency.html).

This means a `Retry` on the `ecs:runTask.sync` Task is only safe from duplicate task launches if
the `RunTask` call underneath it passes the *same* `ClientToken` on every attempt — an
auto-generated (random) token per attempt would defeat this. It also means retry-safety here has
a 24-hour boundary: a retry arriving after that window is a fresh, undeduplicated `RunTask` call
as far as ECS is concerned. Separately, the DynamoDB mutex (Section 3) is acquired once, by an
earlier state, before this Task runs — a Task-level `Retry` re-entering `ecs:runTask.sync` does
not reacquire it, since the lock is scoped to the whole execution, not to any single Task.

## 2. How a state machine would actually invoke OpenTofu

Step Functions Task states call AWS service APIs, Lambda, activities (workers
you host and poll), or HTTPS endpoints — there is no native "run a shell
command" task type. AWS documents two standard paths for running a CLI-style
process from a state machine:

### Lambda (optimized integration)

`arn:aws:states:::lambda:invoke` is AWS's documented, recommended optimized
integration for invoking a Lambda function from a Task state.
Source: [Step Functions Developer Guide — Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html).

Lambda's own quotas page states the constraints this path would have to fit
inside, as of this session:

- **Function timeout**: 900 seconds (15 minutes) — a hard quota.
- **Deployment package (.zip) size**: 50 MB zipped (uploaded via API/console;
  larger via S3), 250 MB unzipped including layers.
- **Container image code package size**: 10 GB (maximum uncompressed image
  size, including all layers) — a separate path from the .zip limit, for
  functions packaged as container images.
- **`/tmp` directory storage**: 512 MB–10,240 MB, configurable in 1 MB
  increments.
- **Function layers**: 5 layers per function.

Source: [AWS Lambda Developer Guide — Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

A bundled `tofu` binary (the OpenTofu CLI is a single static-ish Go binary)
would fit well within the 250 MB unzipped package limit or the 10 GB
container-image limit. The binding constraint is the **15-minute hard
timeout**: `tofu apply` for creating a new Trial Org's EC2 instance and
supporting resources is not documented by AWS as bounded by any number here —
this is a property of the workload, not something either AWS or OpenTofu's
own docs state a typical duration for — but a plan/apply that runs longer
than 15 minutes would be forcibly killed mid-operation, which is a materially
different failure mode than a normal `tofu apply` failure (partial state
writes are more likely under a hard container kill than under a soft error
return). This 900-second ceiling is not configurable upward; it is listed
under the "can't be changed" section of Lambda's quotas.
Source: [AWS Lambda Developer Guide — Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

### ECS/Fargate `RunTask.sync`

Step Functions documents a native, optimized ECS/Fargate integration for
exactly this "run a job and wait for it to complete" shape:

> "The following includes a `Task` state that runs an Amazon ECS task and
> waits for it to complete... `"Resource": "arn:aws:states:::ecs:runTask.sync"`"

This is the `Run a Job (.sync)` [service integration
pattern](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-sync),
which AWS states is supported for the ECS/Fargate integration specifically.
The page also documents a callback-token variant
(`ecs:runTask.waitForTaskToken`) for cases needing an external signal rather
than task-completion polling, and lists the IAM policy Step Functions
generates for the caller (`ecs:RunTask`, `ecs:StopTask`, `ecs:DescribeTasks`,
plus an EventBridge rule Step Functions manages internally to learn when the
task finishes).
Source: [Step Functions Developer Guide — Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html).

Because an ECS/Fargate task is a container running until it exits (not bound
by Lambda's 15-minute ceiling), this is the documented pattern that does not
share Lambda's hard timeout problem for a `tofu apply` of unknown/variable
duration. AWS's own ECS docs page for this integration does not state a
maximum task-runtime quota comparable to Lambda's — no such ceiling was found
in the pages fetched in this session (see Unverified for the scope of what
was and wasn't checked here).

**Which is the standard documented pattern:** both are AWS-documented,
native integrations for "run a job from a Task state and wait for it," but
they target different execution shapes — Lambda is for short functions,
ECS/Fargate `RunTask.sync` is AWS's documented pattern specifically for
longer-running containerized job execution from a state machine. Given
`tofu apply` for EC2 instance creation could plausibly exceed 15 minutes
(no AWS or OpenTofu source found stating typical duration), ECS/Fargate
`RunTask.sync` is the pattern whose documented constraints better fit an
open-ended-duration CLI job; Lambda is the pattern requiring the caller to
independently guarantee sub-15-minute completion or add extra
orchestration (e.g., splitting one `tofu apply` into a Lambda that starts it
async and a separate polling Task) that Step Functions does not itself
document as a built-in feature.

## 3. Serializing operations on the same Trial Org

**What AWS documents:** nothing under a name like "mutex" or "semaphore" for
serializing arbitrary work on a caller-chosen key, for standard state-machine
usage. Two Step Functions Developer Guide pages fetched in this session
(the state-machine concepts page and the error-handling page) contain no
mention of a mutual-exclusion or distributed-locking construct.
Source: [Step Functions Developer Guide — Learn about state machines in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html).

The one documented mechanism that touches this shape of problem is the
execution-name idempotency behavior from Section 1: because a Standard
workflow's execution `name` must be unique per account/region/state machine
(names in use, or closed for under 90 days, are rejected with
`ExecutionAlreadyExists`), a caller that derives the execution name
deterministically from the Trial Org's id alone (not the id plus the action)
would get this behavior *as a side effect* of `StartExecution`'s documented
idempotency contract — not because AWS frames it as a locking primitive.
This has real gaps for this use case: it doesn't stop a *second, different*
lifecycle action from queuing behind the first if the caller retries with a
fresh name; it offers no ordering guarantee (which of two colliding
`StartExecution` calls "wins" is a race decided by API-call arrival order,
not documented as deterministic); and a closed execution's name becomes
reusable only after Step Functions' fixed 90-day retention window, which is
irrelevant to "is this specific org busy right now" and would need
application logic to interpret correctly regardless.
Source: [Step Functions API Reference — `StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html).

An AWS Compute blog post surfaced while researching this ("Handle
unpredictable processing times with operational consistency...") uses a
DynamoDB conditional write (`ConditionExpression:
attribute_not_exists(id)`) inside a Step Functions workflow — but for
deduplicating task-token callback registrations, not for excluding
concurrent executions from touching the same resource; it is not a documented
mutex pattern either.
Source: [AWS Compute Blog — "Handle unpredictable processing times with operational consistency..."](https://aws.amazon.com/blogs/compute/handle-unpredictable-processing-times-with-operational-consistency-when-integrating-asynchronous-aws-services-with-an-aws-step-functions-state-machine/).

**Explicitly not confirmed as an AWS-documented construct:** a built-in
semaphore/mutex primitive for standard (non-Distributed-Map) state machines.
Distributed-Map-specific concurrency controls exist (`MaxConcurrency`
throttling for parallel *iterations within one Map Run*) but that constrains
fan-out within a single execution, not mutual exclusion between separate
`StartExecution` calls keyed by an external identifier like a Trial Org id —
so it does not answer this question. See Unverified.

## 4. Cost and operational overhead

### Standard Workflows pricing

Per AWS's own pricing page: 4,000 free state transitions per month, and
"$0.000025" per state transition in US East (N. Virginia) beyond the free
tier. Retries count as state transitions and are billed the same way:

> "Retries are treated as state transitions. For information about how state
> transitions affect billing, see [Step Functions Pricing]."

Source (retry-as-transition statement): [Step Functions Developer Guide — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html); (pricing figures): [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/).

### Express Workflows pricing

$1.00 per million requests, plus $0.00001667 per GB-second of duration (with
tiered duration discounts at higher committed volume shown separately on the
pricing page). Express workflows are explicitly **not** idempotent per the
`StartExecution` reference (Section 1), which matters for this use case since
idempotent retry-safety was one of the reviewer's stated goals.
Source: [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/); [Step Functions API Reference — `StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html).

### Scale relevant here

At 1–5 concurrent Trial Orgs each triggering ~4–5 lifecycle actions over
their life, and each lifecycle action driving a small, fixed number of state
transitions (a handful of states: acquire, invoke Lambda/ECS task, handle
result, maybe one retry), this is on the order of tens of state transitions
per month — far under the 4,000/month Standard-workflow free tier. No
per-request minimum or reserved-capacity charge is stated on the pricing page
for Standard workflows beyond the per-transition rate; at this volume the
dollar cost of Step Functions itself would round to negligible regardless of
workflow type chosen.

### Defining/deploying the state machine

A Step Functions state machine is defined as an Amazon States Language JSON
document (Section 1) and is itself an AWS resource that needs its own
deployment story, separate from the OpenTofu module invocations it would
orchestrate. Two documented IaC paths exist:

- **Terraform/OpenTofu**: the `aws_sfn_state_machine` resource (Terraform AWS
  provider — the same provider OpenTofu consumes, per
  [`aws-hosting-foundation-tooling.md`](aws-hosting-foundation-tooling.md#1-iac-tool-choice-for-per-tenant-dynamic-stack-instantiation))
  takes a required `definition` argument ("The Amazon States Language
  definition of the state machine") and a required `role_arn`, with optional
  `type` (`STANDARD` default, or `EXPRESS`), `logging_configuration`, and
  `encryption_configuration` arguments. This means the state machine
  definition (and the IAM role it runs as) could be defined inside the same
  OpenTofu foundation ADR-0016 already established, rather than as a
  separate CloudFormation stack or hand-deployed resource.
  Source: [`terraform-provider-aws` — `sfn_state_machine` resource docs](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sfn_state_machine.html.markdown).
- **CloudFormation**: AWS documents a native `AWS::StepFunctions::StateMachine`
  resource type in the CloudFormation Template Reference (page located but
  not fetched in full in this session — see Unverified) — a separate IaC
  path from OpenTofu that this repo does not otherwise use.

Either path is a normal declarative-resource definition, not fundamentally
more or less involved to deploy than any other OpenTofu-managed AWS
resource (an IAM role, an S3 bucket, etc.) already in the foundation module —
but it is an additional resource type and a new ASL-authoring skill/format
(not HCL) layered on top of the OpenTofu foundation, plus (per Section 2) a
Lambda function or an ECS task definition/cluster to actually run `tofu`
inside, each with their own deployment and IAM-permissioning surface.

## 5. The hand-rolled alternative, for comparison

Structurally, hand-rolling this in `hosting_admin` — the option this note's
own findings weighed against Step Functions, and which
[ADR-0016](../adr/0016-opentofu-for-static-and-per-trial-provisioning.md) did
**not** ultimately adopt — would have looked like:

- **Mutex**: a database row per Trial Org (or a dedicated "in-progress job"
  row referencing the Trial Org) that records the current in-progress
  lifecycle action and a start timestamp, written under a row-level lock
  (e.g. Odoo's ORM-provided `SELECT ... FOR UPDATE`-style lock on the Trial
  Org record) before the subprocess starts, cleared when it finishes. A
  second lifecycle action arriving while the row shows "in progress" is
  rejected or queued at the application layer.
- **Timeout**: the Python subprocess call to `tofu` wrapped with a hard
  wall-clock timeout (e.g. `subprocess.run(..., timeout=N)`), killing the
  child process if it runs too long, with the in-progress row's start
  timestamp usable to detect and recover a stuck/orphaned lock (e.g. a
  lifecycle action whose process died without clearing the row) on a
  subsequent attempt or a periodic sweep.
- **Idempotency/retry**: application-level retry logic (a fixed number of
  attempts, optionally with backoff) around the subprocess call. The
  deterministic per-Trial-Org state key this note describes elsewhere
  (`trial-orgs/<trial_org_id>/terraform.tfstate`) would still isolate a
  retry to the correct Trial Org's state — but, per the state-isolation-vs-
  idempotency distinction ADR-0016 draws, that alone doesn't make *running
  `tofu` twice* safe; this hand-rolled sketch would need its own explicit
  idempotency mechanism for that (e.g. a dedicated attempt/job id, the same
  shape ADR-0016 ended up giving Step Functions instead).

ADR-0016's actual choice — Step Functions with a DynamoDB conditional lock,
an EventBridge stale-lock-cleanup rule, a TTL backstop, and a persisted
per-job id reused as both the execution name and the ECS `RunTask`
`ClientToken` — is documented in the ADR itself, not here; this section
stays as a structural comparison point only.

This is presented only as a structural point of comparison — it is what the
reviewer's flagged gap would need to be closed by in Python, not a
recommendation.

## Unverified / could not confirm

- **Whether AWS documents any built-in mutex/semaphore construct for
  standard (non-Distributed-Map) Step Functions workflows, beyond the
  execution-name-idempotency side effect described in Section 3.** No such
  construct was found in the Step Functions Developer Guide pages fetched in
  this session. A widely-cited *non-AWS* pattern (`theburningmonk.com`,
  2018, and a related community npm/PyPI package `state-machine-semaphore`)
  implements a DynamoDB-backed semaphore using Step Functions constructs, but
  this is a third-party pattern, not AWS's own documented feature — flagged
  per the research brief's instruction to say so explicitly rather than
  assume a built-in construct exists.
- **Whether ECS/Fargate `RunTask.sync` tasks have any AWS-documented maximum
  task-runtime quota**, comparable to Lambda's 900-second hard limit. The
  Step Functions ECS integration page fetched in this session states the
  `.sync` pattern and IAM policies but does not state a task-duration quota;
  ECS/Fargate's own task-timeout behavior (if any) was not separately
  checked against ECS's own quotas documentation in this session.
- **The exact ASL-spec-vs-AWS-docs `TimeoutSeconds` default discrepancy's
  practical resolution.** The Amazon States Language spec text fetched
  states a 60-second default; AWS's own Step Functions Task-state page states
  99,999,999. Both were fetched as primary sources in this session and
  directly disagree; this note treats the AWS Step Functions Developer Guide
  page as authoritative for AWS's actual service behavior since it is
  AWS's own service documentation rather than the generic community-governed
  spec, but this was not independently confirmed by testing an actual
  execution in this session.
- **The `AWS::StepFunctions::StateMachine` CloudFormation resource's exact
  argument shape.** The page's existence was confirmed via search result
  title only (`docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html`);
  its content was not fetched in this session.
- **Typical/expected wall-clock duration of a `tofu apply` creating one Trial
  Org's EC2 instance and supporting resources.** No AWS or OpenTofu primary
  source states this — it is a property of this specific module's own design
  (VPC/subnet/EC2/tags per ADR-0016), not something either tool's
  documentation would state generically. This note treats "plausibly exceeds
  15 minutes" as an open question the reviewer's own comment raised, not a
  confirmed fact.
- **Whether `aws_sfn_state_machine` is available through the OpenTofu
  Registry under the same schema as the Terraform Registry page cited.**
  This note cites the upstream `terraform-provider-aws` resource docs
  (the provider OpenTofu itself consumes, per
  [`aws-hosting-foundation-tooling.md`](aws-hosting-foundation-tooling.md#1-iac-tool-choice-for-per-tenant-dynamic-stack-instantiation)),
  not a fetch of `registry.opentofu.org`'s own rendering of the same
  resource, which returned only client-side-rendered chrome when fetched
  directly in this session.

## Sources

- [Step Functions API Reference — `StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [Amazon States Language spec](https://states-language.net/spec.html)
- [Step Functions Developer Guide — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Step Functions Developer Guide — Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)
- [Step Functions Developer Guide — Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/limits-overview.html)
- [AWS Lambda Developer Guide — Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Step Functions Developer Guide — Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)
- [Step Functions Developer Guide — Learn about state machines in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html)
- [AWS Compute Blog — "Handle unpredictable processing times with operational consistency when integrating asynchronous AWS services with an AWS Step Functions state machine"](https://aws.amazon.com/blogs/compute/handle-unpredictable-processing-times-with-operational-consistency-when-integrating-asynchronous-aws-services-with-an-aws-step-functions-state-machine/)
- [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/)
- [`terraform-provider-aws` — `sfn_state_machine` resource docs](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/sfn_state_machine.html.markdown)
