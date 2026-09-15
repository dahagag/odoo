# Trial Org lifecycle parity checklist: `hosting_admin` → administration stack

Deliverable of [#283](https://github.com/dahagag/odoo/issues/283), part of the
[epic](https://github.com/dahagag/odoo/issues/196) that ported the Trial Org / Seat lifecycle
from the Odoo addon `custom_addons/hosting_admin` (Postgres-backed) to the administration stack
under `stack/` (DynamoDB-backed, [ADR-0034](../../adr/0034-administration-stack-owns-org-record-of-truth.md)).

This is what [#197](https://github.com/dahagag/odoo/issues/197) (shrinking `hosting_admin`) is
reviewed against. Every Odoo test below is mapped to a stack counterpart, or named as an explicit
gap with a reason — nothing is silently missing.

Sub-tickets covered: #278 (org record store, state machine, seats), #279 (seat invitations, seat
cap concurrency), #280 (Step Functions provisioner), #281 (pending-job polling, audit trail),
#282 (idle-suspend / auto-destroy sweeps).

## How to read this

- **Stack counterpart** cites the `it(...)` description in `stack/apps/api/test/*.test.ts` or
  `stack/packages/aws-gateway/test/*.test.ts` that asserts the same behaviour, or **GAP** with a
  reason.
- Rows for the same behaviour tested twice in Odoo (e.g. once directly, once through an ACL lens)
  are folded into one stack row where the stack test covers both.
- Two rows are flagged **⚠ unverified** rather than confidently called in-scope or out-of-scope —
  see [Open questions](#open-questions-before-197).

## Test-by-test mapping

### `test_trial_org_state_machine.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_new_trial_org_starts_issued` | New org starts in `issued` | `orgRecord.test.ts`: "creates a Trial Org in the issued state with a defaulted region, unique label, and blank deployment fields" |
| `test_issue_moves_issued_to_active` | `issue`: issued→active | `orgRecord.test.ts`: "issue moves issued -> active and calls the provisioner with a freshly minted job id" |
| `test_full_lifecycle_issued_active_suspended_active_destroyed` | Full lifecycle walk | `orgRecord.test.ts`: "runs the full lifecycle: issued -> active -> suspended -> active -> destroyed"; `orgAdminApi.test.ts`: "runs issue/suspend/wake/destroy end to end through the API" |
| `test_suspend_from_active` | suspend legal from active | Transition table test above + `sweeps.test.ts`: "suspends an active org idle past the timeout" |
| `test_destroy_from_suspended` | destroy legal from suspended | `orgRecord.test.ts`: "destroy is legal directly from suspended too" |
| `test_issue_from_active_is_rejected`, `test_suspend_from_issued_is_rejected`, `test_wake_from_issued_is_rejected`, `test_wake_from_active_is_rejected`, `test_destroy_from_issued_is_rejected` | Illegal source state rejected (one guard per Odoo test, table-driven in the stack) | `orgAdminApi.test.ts`: "rejects an illegal transition with 409 and leaves state unchanged"; enforced by the `TRANSITIONS` table (`stack/apps/api/src/org/record.ts:298-303`) via an `attribute_in` write condition |
| `test_any_action_from_destroyed_is_rejected` | `destroyed` is terminal | `orgRecord.test.ts`: "rejects every action once destroyed" |
| `test_rejected_transition_leaves_state_unchanged` | No partial state mutation on rejection | `orgRecord.test.ts`: "a provisioner failure prevents the state change entirely - no partial write" |
| `test_direct_write_of_state_is_rejected` | ORM write-guard: `state` isn't directly writable | **GAP, structural.** No separate "write path" to guard against — `state` is set only inside `applyTransition`'s single `updateItem` call. |
| `test_direct_create_with_state_is_rejected` | Can't `create()` with a non-issued state | **GAP, structural.** `createOrg` hardcodes `state: 'issued'` (`record.ts:196`) and takes no caller-supplied state. |
| `test_apply_transition_can_still_write_state` | Internal path exempted from the guard | N/A — no such guard layer exists to have an exemption. |
| `test_state_write_guard_cannot_be_forged_via_context` | Odoo context-flag bypass hardening | **GAP, Odoo-ORM-specific.** No context-dict-equivalent forgery surface in the stack. |
| `test_dns_subdomain_label_change_allowed_while_issued` | Label mutable pre-issue | `orgRecord.test.ts`: "allows the label to change while issued" |
| `test_dns_subdomain_label_change_rejected_once_issued` | Label immutable after issue | `orgRecord.test.ts`: "rejects a change once the org has left issued" |
| `test_batch_transition_is_all_or_nothing` | ORM recordset batch write is all-or-nothing under one savepoint | **GAP, confirmed absent by design** — see [Engine-level translations](#engine-level-translations). |

### `test_trial_org_validation.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_create_within_seat_cap_succeeds` | Positive `seat_cap` accepted | `seat.test.ts`: "succeeds when an invite lands exactly at the cap" (+ create-path validation in `orgAdminApi.test.ts`) |
| `test_create_above_system_wide_seat_cap_is_rejected`, `test_write_above_system_wide_seat_cap_is_rejected` | System-wide seat cap of 25 (`SYSTEM_WIDE_SEAT_CAP`, `trial_org.py:13`) enforced on create and write | **⚠ GAP, unverified as accepted.** No global seat-cap ceiling exists in `stack/packages/domain/src/index.ts` — only per-org `seatsTotal` positivity is validated. Not on the epic's Out-of-Scope list. Flagged for owner confirmation, see [Open questions](#open-questions-before-197). |
| `test_create_with_non_positive_seat_cap_is_rejected` | `seatsTotal` must be positive | Zod schema, exercised via `orgAdminApi.test.ts`: "rejects a malformed request body" |
| `test_create_with_valid_domain_succeeds`, `test_create_with_domain_missing_a_dot_is_rejected`, `test_create_with_domain_containing_invalid_characters_is_rejected`, `test_create_with_domain_having_leading_hyphen_label_is_rejected`, `test_create_with_empty_domain_is_rejected` | Prospect domain shape validation | Zod schema on `domain`, exercised generically via `orgAdminApi.test.ts`: "rejects a malformed request body" |
| `test_new_trial_org_starts_issued_with_blank_deployment_version` | Fresh org has no deployment version | `orgRecord.test.ts`: "creates a Trial Org in the issued state with a defaulted region, unique label, and blank deployment fields"; `awsProvisioner.test.ts`: "fails fast without calling AWS when no deployment version has ever been recorded" |
| `test_dns_subdomain_label_defaults_to_a_slugified_name` | Auto-slug default from Org Name (`trial_org.py:285-297`) | **⚠ GAP, unverified as accepted.** `createOrg` requires a caller-supplied `dnsSubdomainLabel` (`record.ts:200`); no slugify-from-name fallback. Presumed to be Odoo's responsibility as the REST caller under [ADR-0036](../../adr/0036-odoo-to-stack-contract-is-rest-with-generated-openapi.md), but that ADR doesn't say so explicitly — see [Open questions](#open-questions-before-197). |
| `test_dns_subdomain_label_explicit_value_is_kept` | Explicit value respected | Implicit — `createOrg` always uses the caller's value |
| `test_dns_subdomain_label_with_invalid_characters_is_rejected`, `test_dns_subdomain_label_with_leading_hyphen_is_rejected`, `test_dns_subdomain_label_too_long_is_rejected` | RFC1123 label rules, 63-char max | `DnsSubdomainLabelSchema` (`stack/packages/domain/src/index.ts:58-67`), exercised via `orgAdminApi.test.ts`: "rejects a malformed request body" |

### `test_trial_org_seat_invite.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_accepted_seat_can_invite_same_domain_teammate` | Targeted invite from an accepted seat | `seat.test.ts`: "lets an accepted seat invite a same-domain teammate, starting invited" |
| `test_invite_to_cross_domain_email_is_rejected` | Domain guard | `seat.test.ts`: "rejects a cross-domain invite and creates no seat" |
| `test_invite_beyond_seat_cap_is_rejected` | Cap enforcement | `seat.test.ts`: "rejects an invite that would exceed the seat cap" |
| `test_invite_at_cap_exactly_succeeds` | Boundary | `seat.test.ts`: "succeeds when an invite lands exactly at the cap" |
| `test_invited_seat_cannot_invite`, `test_invited_seat_can_invite_after_accepting` | Only an accepted seat may invite | `seat.test.ts`: "rejects an invite from a still-invited seat, then allows it once accepted" |
| `test_invite_with_malformed_email_is_rejected` | Email format guard | `seat.test.ts`: "rejects a malformed invite email before creating any seat" |

### `test_trial_org_open_invite.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_matching_domain_first_login_creates_accepted_seat` | Open invite, matching domain → accepted seat | `seat.test.ts`: "gives a matching-domain first login an accepted seat with no inviter" |
| `test_mismatched_domain_first_login_is_rejected_and_creates_no_seat` | Domain guard on open path | `seat.test.ts`: "rejects a mismatched-domain join and creates no seat" |
| `test_second_use_of_the_link_follows_the_self_service_invite_rules`, `test_cross_domain_second_use_is_still_rejected` | Repeat use of the link follows the same rules | `seat.test.ts`: "a second use of the link follows the same seat-cap rules, and a mismatched domain is still rejected on that later use" |
| `test_join_open_invite_rejected_for_a_targeted_invite_trial_org` | Open path blocked on a targeted-only org | `seat.test.ts`: "rejects joining via the open-invite path on a targeted-only org" (`joinOpenInvite`, `stack/apps/api/src/org/seat.ts:143`, throws `OpenInviteNotEnabledError`) |
| `test_ordinary_user_has_no_direct_access_to_platform_only_models`, `test_ordinary_user_can_join_via_open_invite_despite_no_direct_model_access`, `test_ordinary_user_mismatched_domain_is_still_rejected` | Odoo ACL isolation: an ordinary `res.users` has no direct model access, yet can join through the controlled controller path | **GAP, Odoo-ORM/ACL-specific.** The stack's auth boundary is a bearer-token check (`authBoundary.test.ts`), not model-level ACL — there's no "direct model access" concept to guard. The domain-guard behaviour itself is covered above regardless of caller identity. |

### `test_trial_org_open_invite_concurrency.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_join_open_invite_row_lock_blocks_a_concurrent_transaction` | Row lock serializes concurrent joins (simulated with two DB cursors in one process, not real concurrent callers — the Odoo suite's own docstring notes a true two-thread reproduction was impractical, issue #134) | `seat.test.ts`: "lets exactly cap-many concurrent open-invite joins succeed, and never overshoots seatsUsed" — 10 genuinely concurrent `joinOpenInvite` calls via `Promise.allSettled` against a 4-seat cap; exactly 4 succeed. See [Engine-level translations](#engine-level-translations). |

### `test_trial_org_dns_label_transition_concurrency.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_apply_transition_row_lock_blocks_a_concurrent_transaction` | Row lock before the provisioner call serializes a concurrent transition (same two-cursor simulation) | `orgRecord.test.ts`: "two genuinely concurrent identical transitions on the same org resolve to exactly one winner" |
| `test_locked_read_after_commit_sees_the_winning_transitions_state` | Post-commit re-read sees the winner's state, never a stale one | `orgRecord.test.ts`: "re-reads with a strongly consistent read, so a stale eventually-consistent read can never mask the promotion" (same invariant, applied to `checkStatus`'s post-poll re-read) |
| `test_dns_label_guard_row_lock_blocks_a_concurrent_transaction` | Row lock also protects the label-uniqueness guard | `orgRecord.test.ts`: "never lets two concurrent creations with the same dnsSubdomainLabel both succeed" |

### `test_trial_org_provisioner.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_default_provisioner_is_the_stub`, `test_default_provisioner_falls_back_to_stub_when_unconfigured` | No config → `StubProvisioner` | `awsProvisioner.test.ts`: "stays on StubProvisioner when no state machine ARN is configured, unchanged from #278" |
| `test_stub_provisioner_makes_every_transition_a_no_op_call` | Stub does nothing | `StubProvisioner` (`provisioner.ts`): `issue`/`suspend`/`wake`/`destroy` are empty no-ops — structural, nothing to assert |
| `test_transition_calls_provisioner_with_record_and_job_id` | Provisioner called with `(org, jobId)` | `awsProvisioner.test.ts`: "starts an execution with the expected name/input, stages pending version fields, and records the execution ARN" |
| `test_each_transition_generates_a_distinct_job_id`, `test_new_job_id_is_always_a_fresh_uuid` | Fresh job id per call | `orgRecord.test.ts`: "two calls to the same action mint distinct job ids" |
| `test_provisioner_is_called_once_per_record_in_a_batch` | ORM batch semantics | **GAP** — part of the confirmed batch-all-or-nothing absence, see [Engine-level translations](#engine-level-translations). |
| `test_provisioner_failure_prevents_state_change` | Provisioner error blocks the state write | `orgRecord.test.ts`: "a provisioner failure prevents the state change entirely - no partial write" |
| `test_provisioner_failure_on_one_record_rolls_back_the_whole_batch` | Multi-record all-or-nothing rollback | **GAP, confirmed absent by design.** |
| `test_stale_cached_state_is_rejected_under_the_lock_before_a_second_provisioner_call` | Lock re-checks live state, not a cached read | `orgRecord.test.ts`: "two genuinely concurrent identical transitions..." — the `attribute_in` condition re-checks live state at write time (`record.ts:396`) |
| `test_provisioner_is_aws_backed_once_state_machine_arn_is_configured` | Config flips provisioner selection | `awsProvisioner.test.ts`: "switches every org to AwsProvisioner once a state machine ARN is configured" |
| `test_cron_poll_pending_jobs_calls_check_status_on_running_jobs_only` | Poller only touches running jobs | `awsProvisioner.test.ts`: "ignores an org with no running job", "leaves a still-running execution alone" |

### `test_trial_org_aws_provisioner.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_issue_starts_execution_with_expected_input_and_name` | `StartExecution` shape | `awsProvisioner.test.ts`: "starts an execution with the expected name/input, stages pending version fields, and records the execution ARN" |
| `test_issue_without_dns_domain_suffix_raises_a_clear_error_instead_of_calling_aws`, `test_issue_without_base_ami_id_raises_a_clear_error_instead_of_calling_aws`, `test_issue_without_module_git_sha_raises_a_clear_error_instead_of_calling_aws`, `test_suspend_without_an_instance_id_raises_a_clear_error_instead_of_calling_aws`, `test_wake_without_an_instance_id_raises_a_clear_error_instead_of_calling_aws` | Fail fast on missing required config, before any AWS call | `awsProvisioner.test.ts`: "requires a stateMachineArn to construct at all" (config/precondition fail-fast family) |
| `test_destroy_includes_the_dns_record_name`, `test_destroy_forwards_the_org_s_own_recorded_deployment_version`, `test_destroy_includes_a_snapshot_retention_step_in_execution_input` | Destroy input shape (DNS name, recorded version, 7-day retention marker) | `awsProvisioner.test.ts`: "includes the DNS record name, the recorded deployment version, and the snapshot retention window" (`SNAPSHOT_RETENTION_DAYS = 7`, `record.ts:33`) |
| `test_issue_stages_ami_and_git_sha_as_pending_without_touching_the_audit_fields` | Pending vs. committed version fields | Same test as above: "...stages pending version fields... leaving audit fields untouched" |
| `test_destroy_falls_back_to_pending_deployment_version_when_audit_fields_are_blank` | Fallback logic | `awsProvisioner.test.ts`: "falls back to the pending deployment version when nothing has been recorded yet" |
| `test_issue_records_the_execution_arn_returned_by_start_execution` | ARN persisted | Covered by "starts an execution..." (records the execution ARN) |
| `test_suspend_and_wake_omit_module_version_fields` | Version fields only present on issue/destroy input | No dedicated stack test title, but confirmed by reading `awsProvisioner.ts:80-88`: `suspend`/`wake` build their execution input from `{ instanceId }` only — no `amiId`/`tofuModuleGitSha` in scope at all (the class doc comment at `awsProvisioner.ts:52-53` states this explicitly). Structurally impossible for those fields to leak in; treat as accepted. |
| `test_start_execution_already_exists_is_treated_as_a_successful_retry`, `test_execution_already_exists_strips_a_version_or_alias_qualifier` | ADR-0019 retry safety | `awsProvisioner.test.ts`: "treats a name collision as a successful retry rather than an error"; `aws-gateway/test/awsSdk.test.ts`: "maps ExecutionAlreadyExists to ExecutionAlreadyExistsError, reconstructing the execution ARN"; `inMemory.test.ts`: "rejects a second startExecution with the same name (ExecutionAlreadyExists, ADR-0019 retry safety)" |
| `test_start_execution_other_failure_raises_a_clear_user_error` | Non-retry failure surfaced | `awsProvisioner.test.ts`: "surfaces any other StartExecution failure as a clear, actionable error" |
| `test_check_status_ignores_records_with_no_running_job` | Poll no-op | `awsProvisioner.test.ts`: "ignores an org with no running job" |
| `test_check_status_surfaces_succeeded` | Success promotion | `awsProvisioner.test.ts`: "promotes the pending deployment version and marks the job succeeded" |
| `test_check_status_surfaces_failed_with_a_clear_error` | Failure reason surfaced | `awsProvisioner.test.ts`: "surfaces a clear failure reason and does not mark the job running" |
| `test_check_status_leaves_running_executions_alone` | No premature write | `awsProvisioner.test.ts`: "leaves a still-running execution alone", "leaves the job running when describeExecution itself fails (transient AWS trouble)" |

### `test_trial_org_audit_trail.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_stub_provisioner_has_no_audit_trail`, `test_provisioner_default_has_no_audit_trail`, `test_stub_backed_record_has_no_audit_trail` | `StubProvisioner` has no audit trail | `StubProvisioner.getAuditTrail()` returns `{ available: false }` (`provisioner.ts:70-71`) — structural |
| `test_no_recorded_execution_is_unavailable_without_calling_aws` | No execution → unavailable, no AWS call | `awsProvisioner.test.ts`: "renders unavailable for an org with no recorded execution" |
| `test_describe_execution_failure_degrades_to_unavailable` | AWS error → unavailable, not a throw | `awsProvisioner.test.ts`: "renders unavailable when describeExecution itself fails, rather than raising" |
| `test_renders_status_timing_and_steps_from_fixture_responses`, `test_available_trail_populates_every_field` | Full trail rendering | `awsProvisioner.test.ts`: "renders overall status, timing, and step detail (including a failed step) from the execution history" |
| `test_failed_execution_step_carries_error_and_cause`, `test_failed_step_is_rendered_with_error_and_cause` | Failed step detail | Same test as above |
| `test_history_failure_keeps_status_but_marks_steps_unavailable`, `test_history_failure_reason_reads_the_aws_error_code_when_available` | Partial degrade: status survives, steps marked unavailable, reason from the AWS error | `awsProvisioner.test.ts`: "keeps overall status but marks steps unavailable, with the AWS error name as the reason, when history alone fails" |
| `test_get_execution_history_follows_the_pagination_token` | Pagination followed to completion | `awsProvisioner.test.ts`: "follows a paginated execution history to completion rather than stopping at the first page" |
| `test_steps_unavailable_leaves_steps_text_blank` | UI text left blank when steps are unavailable | **Partial GAP.** The underlying data condition is covered (see the history-failure row above), but the stack returns structured JSON, not rendered UI text — there's no "is blank" text assertion to make. |

### `test_trial_org_scheduled_actions.py`

| Odoo test | Behaviour | Stack counterpart |
|---|---|---|
| `test_issue_seeds_last_activity_at` | `issue` seeds `last_activity_at` | `orgRecord.test.ts`: "issue and wake both (re)start the idle-timeout clock by setting lastActivityAt (#282)" |
| `test_cron_suspend_idle_leaves_recently_active_org_alone` | Idle-suspend skips recent activity | `sweeps.test.ts`: "leaves an active org with recent activity alone" |
| `test_cron_suspend_idle_suspends_after_timeout` | Idle-suspend triggers past timeout | `sweeps.test.ts`: "suspends an active org idle past the timeout"; also asserted via the route in `orgAdminApi.test.ts` |
| `test_cron_suspend_idle_ignores_non_active_orgs` | Only `active` orgs are candidates | `sweeps.ts` queries only the `active` partition of `STATE_INDEX` (structural); `sweeps.test.ts`: "tolerates an org that raced away from active between the query and the transition" |
| `test_wake_only_via_explicit_action` | Idle sweep never wakes | `sweeps.test.ts`: "never wakes a suspended org - only the explicit wake action does" |
| `test_cron_auto_destroy_expired_leaves_unexpired_org_alone` | Expiry guard | `sweeps.test.ts`: "leaves an unexpired org alone" |
| `test_cron_auto_destroy_expired_destroys_active_org_past_expiry` | Destroys `active` past expiry | `sweeps.test.ts`: "destroys an active Trial Org past its expiry date, setting the snapshot-retention marker" |
| `test_cron_auto_destroy_expired_destroys_suspended_org_past_expiry` | Destroys `suspended` past expiry too | `sweeps.test.ts`: "destroys a suspended Trial Org past its expiry date" |
| `test_auto_destroy_records_snapshot_retention_marker`, `test_manual_destroy_also_records_snapshot_retention_marker` | 7-day snapshot-retention marker, regardless of trigger | `orgRecord.test.ts`: "destroy always sets a snapshot-retention marker, whatever triggered it (#282)" (`record.ts:373-375`) |
| `test_cron_auto_destroy_expired_ignores_issued_org` | A never-provisioned org is untouched | `sweeps.test.ts`: "ignores an issued (never provisioned) org past its expiry date" |
| *(no Odoo test — Client Org doesn't exist there yet)* | Client Org is never selected by the auto-destroy sweep | `sweeps.test.ts`: "never selects a Client Org, regardless of any date field it carries" — new invariant, added because Client Orgs (which #196 introduced) never get an `expiryDate` (`record.ts:189-191`) |

### `test_trial_org_asleep_page.py` (12 tests) — GAP, stays in Odoo

`custom_addons/hosting_admin/controllers/asleep.py` renders an HTML page (wake button,
host-based redirect, a wake-progress status endpoint) served to a browser hitting a suspended
org's own hostname. This is client-facing presentation on top of the ported `wake` action and job
status — not record-of-truth logic. The stack exposes `wake` (`applyTransition`) and job status
(`checkStatus`) as API primitives; no stack code renders a page or does host-based routing (no
`asleep` hit anywhere under `stack/`). [ADR-0030](../../adr/0030-asleep-page-served-via-route53-failover-to-platform.md)
confirms the Asleep Page is served via Route53 failover to the platform account, i.e. it's
expected to keep living outside the stack indefinitely — a permanent, accepted gap, not a
temporary omission.

### `test_trial_org_log_webhook.py` (10 tests), `test_trial_org_log_channel_authorization.py` (4 tests) — GAP, stays in Odoo

`controllers/log_webhook.py` (HMAC-authenticated CloudWatch→Odoo-bus relay) and
`models/ir_websocket.py`'s channel-subscription guard implement a live log viewer entirely on
Odoo's own bus/websocket infrastructure — no DynamoDB or record-store dimension. Neither
"log_webhook" nor "log_bus" appears anywhere under `stack/`. Not in the epic's "Behaviour to
reproduce" list, and not backed by any ADR the epic cites (0016/0019/0020/0021/0024/0031/0033).
Accepted, out of this epic's scope.

## Engine-level translations

### Postgres row locks → DynamoDB conditional writes

**Odoo**: `_apply_transition()` and `action_join_open_invite()` take a `SELECT ... FOR UPDATE` row
lock on the `hosting_trial_org` row before touching the provisioner, a seat, or the label. The
concurrency tests that prove this (`test_trial_org_dns_label_transition_concurrency.py`,
`test_trial_org_open_invite_concurrency.py`) open two DB cursors *in the same test process* and
assert the second cursor's `FOR UPDATE NOWAIT` raises `psycopg2.errors.LockNotAvailable` — a
documented simplification (see the test file's own docstring, issue #134), not a full multi-thread
race reproduction.

**Stack**: no row to lock — DynamoDB conditional writes replace the lock entirely.

- **Seat cap** (`stack/apps/api/src/org/seat.ts:78-107`, `createSeatTransactionally`): one
  `gateway.dynamoDb.transactWrite` puts the new seat item (`attribute_not_exists` on `pk`) *and*
  increments `seatsUsed` on the org item in the same atomic transaction
  (`numeric_less_than_or_equal` against `seatsTotal - 1`, line 95). The code comment states the
  reason directly: a read-then-write lets "two concurrent calls each read a `seatsUsed` that
  still has room and both commit past the cap." A `TransactionCanceledError` maps to
  `SeatCapExceededError`.
- **State transitions** (`record.ts:349-401`, `applyTransition`): the final `updateItem`
  (lines 378-397) is guarded by `attribute_in` on `state` against the transition table's legal
  source states (line 396) — checked against whatever is *actually current* at write time, not a
  value read earlier. `ConditionalCheckFailedError` → `ConcurrentWriteError`.
- **DNS label uniqueness** (`record.ts:210-234` `createOrg`, `:256-290`
  `updateDnsSubdomainLabel`): both use `transactWrite` with a separate `dnslabel#<label>`
  reservation item guarded by `attribute_not_exists`, so two orgs racing for the same label
  structurally cannot both succeed. `updateDnsSubdomainLabel` additionally re-checks
  `state === 'issued'` inside the same transaction, closing the same "state moved on mid-check"
  race the Odoo lock covered for label mutability.

**The stack's concurrency tests fire genuinely concurrent operations**, not a lock-acquisition
simulation: `orgRecord.test.ts` and `seat.test.ts` race real `Promise.allSettled` batches (two
concurrent `createOrg` calls, two concurrent `applyTransition` calls, ten concurrent
`joinOpenInvite`/`inviteTargeted` calls against a capped org) against the same
`InMemoryAwsGateway` and assert on the outcome distribution (exactly N succeed, the rest reject
with the expected typed error, the counter never overshoots).

**Honest caveat**: this is Node's single-threaded event-loop interleaving of awaited I/O against
an in-memory fake — a genuine race on shared mutable state (stronger than Odoo's two-cursor lock
simulation), but it proves the *conditional-write logic* is race-safe, not that DynamoDB's own
`TransactWriteItems` behaves this way under real network-level concurrency (that's DynamoDB's own
contract). Matching the epic's testing rule ("All tests run against the `AwsGateway` fake. No
live AWS"), the fake's own conditional-write engine is separately unit-tested in
`stack/packages/aws-gateway/test/inMemory.test.ts` ("rejects a conditional put when
attribute_not_exists is violated", "applies a transactWrite all-or-nothing: one failing item
leaves every item unapplied"), and request-shape-only assertions against the real SDK client live
in `awsSdk.test.ts` (mocked, no live calls).

### ORM batch-is-all-or-nothing: confirmed absent, deliberate gap

Odoo lets a caller invoke a transition on a *multi-record* recordset in one call;
`_apply_transition()` runs inside one savepoint, so a failure partway through rolls back **every**
record in that call, including ones that had already transitioned successfully.
`test_batch_transition_is_all_or_nothing` and
`test_provisioner_failure_on_one_record_rolls_back_the_whole_batch` prove exactly this.

**The stack has no counterpart, and it's structural, not an oversight.** `applyTransition` takes a
single `orgId: string` — there is no multi-org batch parameter anywhere in its signature, in
`orgAdminApi`'s routes, or in `sweeps.ts` (which loops calling `applyTransition` once per
candidate id and treats each call's success/failure independently — see `isAlreadyHandled`,
`sweeps.ts:20-27` — explicitly *not* rolling back sibling orgs on one failure). Every
`transactWrite` is scoped to one org's own items. This is the right call for a REST API where each
request is naturally single-resource, but the specific "all-or-nothing across an arbitrary
caller-chosen batch" guarantee Odoo's ORM gives for free has **no equivalent and none is
planned**. Record this as an accepted, deliberate design divergence, not a bug to port before
#197.

## Explicit gaps

| Gap | Odoo test(s) | Status |
|---|---|---|
| ORM batch-transition all-or-nothing | `test_batch_transition_is_all_or_nothing`, `test_provisioner_failure_on_one_record_rolls_back_the_whole_batch`, `test_provisioner_is_called_once_per_record_in_a_batch` | **Accepted** — architectural divergence, see above. |
| ORM direct-write/direct-create state guards, context-forgery hardening | `test_direct_write_of_state_is_rejected`, `test_direct_create_with_state_is_rejected`, `test_state_write_guard_cannot_be_forged_via_context`, `test_apply_transition_can_still_write_state` | **Accepted** — no alternate write path exists in the stack to guard against. |
| Ordinary-user ACL isolation on open-invite join | `test_ordinary_user_has_no_direct_access_to_platform_only_models`, `test_ordinary_user_can_join_via_open_invite_despite_no_direct_model_access`, `test_ordinary_user_mismatched_domain_is_still_rejected` | **Accepted** — Odoo `res.groups` ACL has no analogue in the stack's bearer-token boundary; the domain-guard behaviour itself is covered separately. |
| Asleep Page (12 tests) | `test_trial_org_asleep_page.py` | **Accepted, permanent** — stays in Odoo/Route53 per ADR-0030. |
| Log webhook (10 tests), log channel authorization (4 tests) | `test_trial_org_log_webhook.py`, `test_trial_org_log_channel_authorization.py` | **Accepted, out of epic scope** — Odoo-bus-only concern, not in the epic's reproduce list. |
| "Steps unavailable" text-rendering | `test_steps_unavailable_leaves_steps_text_blank` | **Accepted, partial** — underlying data condition is covered; the stack returns JSON, not rendered text. |
| System-wide seat cap ceiling (25) | `test_create_above_system_wide_seat_cap_is_rejected`, `test_write_above_system_wide_seat_cap_is_rejected` | **Open — needs owner confirmation before #197**, see below. |
| Auto-slugified DNS label default | `test_dns_subdomain_label_defaults_to_a_slugified_name` | **Open — needs owner confirmation before #197**, see below. |

## Open questions before #197

Two rows above are marked open rather than accepted, because this checklist could not trace them
to an explicit "deferred to Odoo" decision the way the batch-transaction and ACL gaps were:

1. **System-wide seat cap (25).** Odoo enforces `seat_cap <= 25` on both create and write
   (`SYSTEM_WIDE_SEAT_CAP`, `trial_org.py:13`). No equivalent ceiling exists in the stack's Zod
   schemas or `record.ts` — only per-org positivity is checked. This isn't on the epic's
   Out-of-Scope list. Before #197 removes the Odoo constraint, confirm whether the stack is meant
   to enforce this ceiling itself (in which case it's a real gap to close first) or whether
   Odoo/the staff app UI is meant to keep enforcing it client-side against the stack's plain
   `seatsTotal` field (in which case this row can move to accepted).
2. **Auto-slugified DNS label default.** Odoo defaults `dns_subdomain_label` to a slugified Org
   Name when the caller doesn't supply one. The stack's `createOrg` requires the caller to supply
   it. Under ADR-0036, Odoo is the REST caller, so this is plausibly just Odoo's job now — but
   that isn't stated anywhere. Confirm whether `hosting_admin`'s integration call (the ticket after
   #197) is expected to compute the slug itself before calling the stack.

None of these two block #283 itself — they're the named, checkable gaps this ticket exists to
surface, not silent omissions.

## Scope check: #196's Out of Scope, confirmed untouched

| Out-of-scope item | Status | Evidence |
|---|---|---|
| Promotion mechanics | Not touched | No hit for `promot` under `stack/apps` or `stack/packages` source; `record.ts` only shapes the record for a future promotion (`type` field, no immutability assumption) per the epic's own Implementation Decisions. Promotion's design is deferred to [ADR-0035](../../adr/0035-trial-and-client-orgs-one-provisioning-path-with-promotion.md) and the `/wayfinder` pass it references. |
| Removing/shrinking `hosting_admin` | Not touched | `custom_addons/hosting_admin` is unchanged and still functional; explicitly gated on this checklist and on #197. |
| Cost data | Not touched | No hit for `cost` under `stack/apps` or `stack/packages` source (cost-dashboard work is unrelated Odoo-side history, ADR-0030 "cost-dashboard-daily-snapshot"). |
| Region selection | Not touched | `record.ts:197-199`: `region: config.defaultRegion` with a comment noting selection is deferred; every org gets the single configured default, no caller override exists. |
| OpenTofu modules / Step Functions state machine | Not touched | `git log -- infra/foundation/state_machine.tf infra/modules/trial_org` shows no commit from this epic's chain (#278, #279, #280, #281, #282 and their PRs) touching either path; last change predates the epic. |

## Referenced ADRs

- **ADR-0019** — Step Functions job identity and retry safety: a UUID job id minted before
  `StartExecution`, persisted only after it returns, folded into the execution name and the ECS
  `ClientToken`; state and `last_job_status: running` are written together so a same-action retry
  always fails source-state validation before reaching any reuse check. Preserved verbatim in the
  stack (`record.ts:377-397`) and extended across the new HTTP hop by the stack's own
  `Idempotency-Key` mechanism (`stack/apps/api/test/idempotency.test.ts`) — additive coverage, not
  a ported Odoo test, since Odoo never had this HTTP boundary internally.
- **ADR-0020** — DynamoDB per-trial-org lock and stale-lock recovery.
- **ADR-0021** — Trial org EC2 power-state and instance-profile boundary: OpenTofu owns
  create/destroy, never running/stopped state; Suspend/Wake call the EC2 API directly.
- **ADR-0024** — Per-trial-org deployment versioning: record, don't upgrade.
- **ADR-0030** — Asleep Page served via Route53 failover to the platform account (confirms the
  Asleep Page gap above is permanent by design).
- **ADR-0031** — Per-execution IAM isolation via AssumeRole + session tags, replacing the shared
  `tofu-runner` task role.
- **ADR-0033** — Extends ADR-0031's per-execution IAM isolation to the snapshot-manager and
  power-control Lambdas.
- **ADR-0034** — Administration stack owns the org record of truth (the epic's foundational
  decision).
- **ADR-0035** — Trial and Client Orgs share one provisioning path, with Promotion as a type
  change on the same record (Promotion's mechanics themselves are out of scope here).
- **ADR-0036** — Odoo↔stack contract is REST with a generated, committed OpenAPI document.
