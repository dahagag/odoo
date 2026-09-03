# DynamoDB per-Trial-Org lock and stale-lock recovery

Part of the job-orchestration design in [ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md).
AWS does not document a built-in mutex/semaphore for standard Step Functions workflows (see
[`docs/research/step-functions-for-provisioning-jobs.md`](../research/step-functions-for-provisioning-jobs.md)),
so serializing two lifecycle actions on the *same* Trial Org needs an explicit mechanism —
covered here, separately from job identity/retry safety
([ADR-0019](0019-step-functions-job-identity-and-retry-safety.md)) and the EC2 power-state
boundary ([ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md)).

**Mutex.** The state machine's first state acquires a DynamoDB item keyed by the Trial Org id via
a conditional `PutItem` (`attribute_not_exists`), storing the current execution's own ARN as an
**owner token** in the item. The release step conditionally deletes the item only when its owner
token still matches this execution's ARN — so an execution that never actually held the lock
(e.g. one that failed *before* acquiring it) can never delete a different execution's live lock by
reaching a shared, unconditional release step. This serializes actions on the *same* Trial Org
while leaving separate Trial Orgs unconstrained, without relying on Odoo's own record locking.

**Stale-lock recovery.** A `Catch` block only handles errors *within* the state machine's own
states — it does not run when an execution is stopped externally (`StopExecution`) or fails at
the top level, so a lock can outlive its execution. An EventBridge rule on that state machine's
execution status changing to `FAILED`/`ABORTED`/`TIMED_OUT` invokes a small cleanup step that
releases the matching lock (same owner-token-conditional delete) promptly. As a backstop for
whatever gap EventBridge doesn't catch, the DynamoDB lock item also carries a TTL attribute (a few
hours out) so a stuck lock self-expires via DynamoDB's native TTL rather than blocking that Trial
Org indefinitely. Both mechanisms are infrastructure-level; Odoo is not a required participant in
lock recovery any more than it is in acquiring the lock.
