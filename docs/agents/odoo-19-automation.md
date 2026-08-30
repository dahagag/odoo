# Odoo 19 Agentic Administration

Use this playbook when an external agent reads, plans, or changes Odoo administrative state. The architecture separates an external control plane from a native execution plane so Odoo remains authoritative for security, transactions, retries, and business invariants.

Read `docs/adr/0002-split-agent-control-from-native-execution.md` before designing an automation interface.

## External control plane

- Prefer Odoo 19 JSON-2: `POST /json/2/<model>/<method>` with a JSON object body.
- Authenticate with an expiring API key belonging to a dedicated least-privilege service user. Never share an administrator's key.
- Send `X-Odoo-Database` when a host serves multiple databases.
- When `api_doc` is installed and the service user belongs to its documentation group, use `/doc` to discover the models, fields, and public methods available to that database and identity.
- Use XML-RPC and legacy JSON-RPC only for compatibility. New integrations use [JSON-2](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html); consult the [legacy RPC notice](https://www.odoo.com/documentation/19.0/developer/reference/external_rpc_api.html) during migration.
- Use browser automation for a human-visible approval step or a workflow that genuinely lacks a supported API, not as the primary data interface.
- Odoo-hosted plans can restrict external API availability. Verify the target edition and plan before promising an integration; this Community source remains authoritative for self-hosted runtime behavior.

## Native execution plane

Durable mutations belong in owned addon methods, scheduled actions, or narrowly constrained server actions.

Every externally callable command validates:

- The caller's group, privilege, and allowed companies.
- The current state and ownership of every target record.
- Argument types, allowed values, target count, and policy thresholds.
- Required approval evidence for the operation class.
- An idempotency key or an equivalent replay check.

Keep business helpers private. A public method exposes a business command, not arbitrary code or unrestricted model access. Return a stable summary containing the operation identifier, status, changed-record count or identifiers appropriate to the caller, warnings, and recovery state.

Scheduled work:

- Processes an explicit batch limit and reports progress with `ir.cron._commit_progress()`.
- Locks a record before mutation and rechecks the selection domain after locking.
- Uses a savepoint for an expected per-record failure so one record does not roll back completed safe work.
- Stops when the cron progress API reports that its time budget is exhausted.
- Makes outbound side effects idempotent or reconciles the remote state before retry.
- Relies on Odoo's failure tracking and produces actionable logs without secrets.

`sudo()` is a local privilege boundary, not the automation architecture. Validate caller authority and input before elevating, elevate the smallest recordset and operation, and test that unprivileged callers cannot widen the scope.

## Authority tiers

### Autonomous

- Reads, searches, analysis, validation, and plan generation.
- Dry runs and previews.
- Operations against disposable development and test databases.

### Pre-approved, reversible writes

An operation can run without per-execution approval only when its operation type, models, domain, companies, maximum record count, and compensation are explicitly allowlisted. Suitable examples include activities, draft annotations, and reversible metadata changes.

### Explicit approval

Require approval for:

- Posting, cancelling, paying, or reconciling financial documents.
- Users, groups, privileges, credentials, API keys, companies, or security configuration.
- Record deletion or a bulk mutation above the allowlisted threshold.
- Module installation or upgrade.
- Scheduled-action, server-action, or automation-rule changes.
- Mass communication.
- An irreversible or financially material external side effect.

Planner and executor identities may be separate. Neither receives general administrator access. Coding agents and test containers never receive production credentials.

## Audit contract

Record for every executable operation:

- Requesting actor and service identity.
- Operation class, target model/domain, company scope, and threshold evaluation.
- Approval decision and approver when required.
- Idempotency key, start/end timestamps, and policy version.
- Before/after summary, warnings, result, and recovery status.

Exclude credentials, tokens, unnecessary personal data, and sensitive payload bodies from logs. Store a payload hash or redacted summary when correlation is required.

Each allowlisted mutation documents retry behavior and a compensating action. An operation without safe compensation belongs in the approval tier.

## Fail closed

Permission errors, stale state, multi-company violations, expired keys, concurrency conflicts, partial batches, timeouts, and external-service failures stop the affected operation and produce an actionable status. They never trigger broader privileges, wider domains, or silent continuation.

The [Odoo 19 security model](https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html) remains authoritative:

- ACL grants are additive.
- Record rules are default-allow after an ACL grants access.
- Global rules intersect; group rules unify within the global boundary.
- Public model methods can be remotely invoked.
- UI visibility is not access control.
- `sudo()` bypasses ACLs and record rules.
