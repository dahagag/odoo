import { randomUUID } from 'node:crypto';
import type { AwsGateway, QueryInput } from '@stack/aws-gateway';
import { ConditionalCheckFailedError, TransactionCanceledError } from '@stack/aws-gateway';
import type { InviteType, OrgAction, OrgState, OrgType } from '@stack/domain';
import { DnsSubdomainLabelSchema, slugifyDnsLabel } from '@stack/domain';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  IllegalTransitionError,
  InvalidDnsLabelError,
  OrgNotFoundError,
  ProvisionerFailedError,
} from './errors';
import { callProvisioner, type Provisioner } from './provisioner';

/** The org record store's key schema (docs/dynamodb-access-patterns.md): a single-item org
 * record under `org#<orgId>`, plus one `dnslabel#<label>` reservation item per unique
 * `dnsSubdomainLabel` in the same table - the mechanism that makes uniqueness atomic at create
 * time (this ticket's Acceptance Criteria) rather than a racy separate check. */
export const ORGS_TABLE = 'orgs';

/** The idle timeout docs/adr/0014 sets for a Trial Org's compute: "stopped after an idle timeout
 * (~30 min)" - mirrors `IDLE_TIMEOUT_MINUTES`
 * (`custom_addons/hosting_admin/models/trial_org.py`) one language over. Checked only by the
 * idle-suspend sweep (#282), never inline on request. */
export const IDLE_TIMEOUT_MINUTES = 30;

/** The snapshot retention window Auto-Destroy always records a marker for (docs/contexts/
 * hosting/CONTEXT.md's Auto-Destroy entry: "A short-lived (7-day) database snapshot is retained
 * afterward in case of revival") - mirrors `SNAPSHOT_RETENTION_DAYS`
 * (`custom_addons/hosting_admin/models/provisioner.py`) one language over. Lives here (not
 * `awsProvisioner.ts`, which already imports from this module) so both `applyTransition`'s own
 * marker and `AwsProvisioner.destroy`'s execution input agree on the same figure. */
export const SNAPSHOT_RETENTION_DAYS = 7;

/** GSI1 (docs/dynamodb-access-patterns.md pattern 2: "List orgs by state"): partitioned on
 * `state#<state>`, with the org's own `pk` projected as the sort key for stable pagination. */
export const STATE_INDEX = 'gsi1';
/** GSI2 (docs/dynamodb-access-patterns.md pattern 3: "List orgs by expiry date"): a single fixed
 * partition, so the auto-destroy sweep queries `gsi2sk <= now` instead of a full-table scan.
 * Only ever written for a Trial Org (`toItem` below) - a Client Org, which never carries an
 * `expiryDate`, never gets a `gsi2sk` to be indexed under, so it can never be selected by this
 * index's query regardless of any other date field it carries (#282's Acceptance Criteria). */
export const EXPIRY_SWEEP_INDEX = 'gsi2';
/** `gsi2pk`'s single fixed value - exported so `sweeps.ts` queries the same partition this
 * module itself writes, without hardcoding it independently. */
export const EXPIRY_SWEEP_PARTITION = 'expiry-sweep';

/** Exported so `sweeps.ts` can build the same `gsi1pk` value this module itself writes, without
 * either module hardcoding the `state#` prefix independently. */
export function statePartition(state: OrgState): string {
  return `state#${state}`;
}

/** Exported so every reader/writer of the org item (this module, and the org-facing
 * `orgRegistration.ts` read path) derives the same key the same way, rather than each
 * re-deriving `` `org#${orgId}` `` independently. */
export function orgPk(orgId: string): string {
  return `org#${orgId}`;
}

function dnsLabelPk(dnsSubdomainLabel: string): string {
  return `dnslabel#${dnsSubdomainLabel}`;
}

export interface OrgRecord {
  orgId: string;
  type: OrgType;
  state: OrgState;
  region: string;
  dnsSubdomainLabel: string;
  name: string;
  domain: string;
  seatsUsed: number;
  seatsTotal: number;
  /** Which invitation path (ADR-0026) this org accepts: `targeted` (the default, matching
   * `hosting.trial.org.invite_type`'s own default) or `open`. `org/seat.ts`'s `joinOpenInvite`
   * rejects an org that isn't `open` (this ticket's Acceptance Criteria: "Joining via the
   * open-invite path on an org configured for targeted invites only is rejected"). */
  inviteType: InviteType;
  opportunityId?: string;
  /** Absent for a Client Org (this ticket's Acceptance Criteria: "no expiry date field
   * populated") - only a Trial Org ever carries one. */
  expiryDate?: string;
  /** Deployment Version (ADR-0024) - blank until a provisioner populates them; this ticket
   * writes no real AWS integration, so they stay blank through this ticket's own lifecycle
   * (this ticket's Acceptance Criteria). */
  amiId?: string;
  tofuModuleGitSha?: string;
  pendingAmiId?: string;
  pendingTofuModuleGitSha?: string;
  /** ADR-0019 job identity: the most recently minted job id/action, written together with the
   * state it caused - never reused across calls. */
  lastJobId?: string;
  lastJobAction?: OrgAction;
  /** That job's own outcome (#281, ADR-0019: "`_apply_transition()` writes the new state
   * together with `last_job_status: 'running'` in the same call that starts the job") - written
   * `running` by `applyTransition` itself, then settled to `succeeded`/`failed` only once
   * `Provisioner.checkStatus` observes a terminal Step Functions status. Blank under
   * `StubProvisioner`, which starts nothing to poll. */
  lastJobStatus?: 'running' | 'succeeded' | 'failed';
  /** A clear, actionable reason for `lastJobStatus`'s most recent `failed` outcome
   * (`checkStatus`, #281) - `''` whenever the last observed outcome wasn't a failure, mirroring
   * `hosting.trial.org.last_job_error` (`False` there for the same "no error" case). */
  lastJobError?: string;
  /** The Step Functions execution `AwsProvisioner` (#280) most recently started or reattached
   * to for this org - written by the provisioner itself, not by `applyTransition`, since it's
   * populated (or reconstructed, on an `ExecutionAlreadyExists` retry) only once the
   * `StartExecution` call actually resolves. Blank under `StubProvisioner`. */
  lastExecutionArn?: string;
  /** The org's EC2 instance id (mirrors `hosting.trial.org.instance_id`,
   * `custom_addons/hosting_admin/models/trial_org.py`) - `suspend`/`wake` (#280, ADR-0021) read
   * this to target the right instance and fail fast when it's still blank rather than starting
   * an execution that can only fail deep inside AWS. Nothing in this ticket populates it; a
   * later ticket wires it up once `issue` can read the instance id RunTofu created. */
  instanceId?: string;
  /** Last recorded activity on this org's compute, checked by the idle-suspend sweep (#282)
   * against `IDLE_TIMEOUT_MINUTES`. Set to the moment the org reaches `active` (`issue` or
   * `wake`) so a freshly-issued or just-woken org gets a full idle window before the next sweep
   * run, rather than being immediately eligible - mirrors `hosting.trial.org.last_activity_at`. */
  lastActivityAt?: string;
  /** Auto-Destroy always records a snapshot-retention marker (docs/contexts/hosting/CONTEXT.md's
   * Auto-Destroy entry), regardless of what triggered it - the auto-destroy sweep (#282) or a
   * manual `destroy` call alike. Mirrors `hosting.trial.org.snapshot_retention_until`. */
  snapshotRetentionUntil?: string;
}

/** Exported so `awsProvisioner.ts` can strip `undefined` extras out of an execution input the
 * same way this module strips them out of a DynamoDB item - one definition of "missing means
 * absent, not `undefined`" for both. */
export function compact<T extends Record<string, unknown>>(item: T): T {
  // Real DynamoDB has no `undefined` attribute value - `marshalValue` (aws-gateway) rejects it
  // outright. Blank/absent optional fields (Deployment Version at creation, a Client Org's
  // `expiryDate`) must be *missing* attributes, not attributes holding `undefined`.
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as T;
}

function toItem(org: OrgRecord): Record<string, unknown> {
  return compact({
    pk: orgPk(org.orgId),
    ...org,
    // Derived from the item's own state/type/expiryDate, never tracked as separate mutable
    // fields, so a GSI attribute can never drift from what the record itself says (docs/
    // dynamodb-access-patterns.md patterns 2-3).
    gsi1pk: statePartition(org.state),
    gsi1sk: orgPk(org.orgId),
    ...(org.type === 'trial' && org.expiryDate
      ? { gsi2pk: EXPIRY_SWEEP_PARTITION, gsi2sk: org.expiryDate }
      : {}),
  });
}

function fromItem(item: Record<string, unknown>): OrgRecord {
  const { pk: _pk, gsi1pk: _gsi1pk, gsi1sk: _gsi1sk, gsi2pk: _gsi2pk, gsi2sk: _gsi2sk, ...rest } = item;
  // `inviteType` postdates this field's introduction - an org created by an earlier `createOrg`
  // has no such attribute stored at all. Defaulted here (before the spread, so a stored value
  // always wins) rather than left missing, since every later reader (`OrgSchema.parse` in
  // `server.ts`) requires it: a pre-existing org would otherwise fail its next DNS-label change
  // or lifecycle transition (CodeRabbit, PR #296). `'targeted'` matches `createOrg`'s own default
  // and `hosting.trial.org.invite_type`'s.
  return { inviteType: 'targeted', ...rest } as unknown as OrgRecord;
}

export interface CreateOrgInput {
  type: OrgType;
  name: string;
  domain: string;
  seatsTotal: number;
  /** Defaults to a slugified `name` when omitted (`_slugify_dns_label`,
   * `custom_addons/hosting_admin/models/trial_org.py`'s own `create()` default) - an explicit
   * value is always used as-is, never overridden. */
  dnsSubdomainLabel?: string;
  /** Defaults to `targeted` (`hosting.trial.org.invite_type`'s own default), matching how most
   * Trial Orgs are issued for a specific known prospect rather than shared as an open link. */
  inviteType?: InviteType;
  opportunityId?: string;
}

export interface CreateOrgConfig {
  defaultRegion: string;
  /** CONTEXT.md: a Trial Org "runs for a fixed window (default 14 days)". Never consulted for
   * a Client Org, which never carries an `expiryDate` at all. */
  trialDurationDays: number;
}

/** Creates an org in the `issued` state (this ticket's Acceptance Criteria). The org item and
 * its `dnsSubdomainLabel` reservation are written in one `transactWrite` so a second org racing
 * to claim the same label can never both succeed (Acceptance Criteria: "the rejection cannot
 * race a concurrent creation into both succeeding") - `attribute_not_exists` on the reservation
 * item's own `pk` is what DynamoDB itself atomically enforces. */
export async function createOrg(gateway: AwsGateway, input: CreateOrgInput, config: CreateOrgConfig): Promise<OrgRecord> {
  const orgId = randomUUID();
  const expiryDate = input.type === 'trial'
    ? new Date(Date.now() + config.trialDurationDays * 24 * 60 * 60 * 1000).toISOString()
    : undefined;
  // An explicit label is always used as-is; an omitted one is derived from `name` the same way
  // `_slugify_dns_label` (`custom_addons/hosting_admin/models/trial_org.py`) does. Either way
  // this same value is what the reservation transaction below checks for availability - an
  // auto-derived label gets no bypass of that uniqueness guard.
  const dnsSubdomainLabel = input.dnsSubdomainLabel ?? slugifyDnsLabel(input.name);
  if (!input.dnsSubdomainLabel && !DnsSubdomainLabelSchema.safeParse(dnsSubdomainLabel).success) {
    // An explicit label already gets this same shape guarantee at the API boundary
    // (`CreateOrgRequestSchema`); a derived one needs the check here since nothing else in this
    // path validates it - mirrors `_check_dns_subdomain_label`'s constraint catching a bad
    // derived value (e.g. a punctuation-only `name`) the same way it catches a bad explicit one.
    throw new InvalidDnsLabelError(input.name, dnsSubdomainLabel);
  }

  const org: OrgRecord = {
    orgId,
    type: input.type,
    state: 'issued',
    // Region *selection* is explicitly out of scope until #207 (#196: "Nothing selects it
    // yet.") - every org gets the configured default, with no caller-supplied override.
    region: config.defaultRegion,
    dnsSubdomainLabel,
    name: input.name,
    domain: input.domain,
    seatsUsed: 0,
    seatsTotal: input.seatsTotal,
    inviteType: input.inviteType ?? 'targeted',
    opportunityId: input.opportunityId,
    expiryDate,
  };

  try {
    await gateway.dynamoDb.transactWrite({
      items: [
        {
          put: {
            table: ORGS_TABLE,
            item: toItem(org),
            condition: { type: 'attribute_not_exists', attribute: 'pk' },
          },
        },
        {
          put: {
            table: ORGS_TABLE,
            item: { pk: dnsLabelPk(dnsSubdomainLabel), orgId },
            condition: { type: 'attribute_not_exists', attribute: 'pk' },
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof TransactionCanceledError && error.cancellationReasons[1]) {
      throw new DnsLabelInUseError(dnsSubdomainLabel);
    }
    throw error;
  }

  return org;
}

export async function getOrgRecord(gateway: AwsGateway, orgId: string, options: { consistentRead?: boolean } = {}): Promise<OrgRecord | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId) }, consistentRead: options.consistentRead });
  return item ? fromItem(item) : undefined;
}

/** Changes `dnsSubdomainLabel` while `issued`, rejected once state has left `issued` (this
 * ticket's Acceptance Criteria). Re-checks `state === 'issued'` as part of the same
 * `transactWrite` that moves the label reservation - not just against the value this call
 * happened to read - so a concurrent transition out of `issued` cannot race a label change into
 * landing after it (docs/dynamodb-access-patterns.md's uniqueness reasoning, applied to the
 * immutability rule too). */
export async function updateDnsSubdomainLabel(gateway: AwsGateway, orgId: string, dnsSubdomainLabel: string): Promise<OrgRecord> {
  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);
  if (org.state !== 'issued') throw new DnsLabelImmutableError(orgId);
  if (dnsSubdomainLabel === org.dnsSubdomainLabel) return org;

  try {
    await gateway.dynamoDb.transactWrite({
      items: [
        {
          update: {
            table: ORGS_TABLE,
            key: { pk: orgPk(orgId) },
            set: { dnsSubdomainLabel },
            condition: { type: 'attribute_equals', attribute: 'state', value: 'issued' },
          },
        },
        {
          put: {
            table: ORGS_TABLE,
            item: { pk: dnsLabelPk(dnsSubdomainLabel), orgId },
            condition: { type: 'attribute_not_exists', attribute: 'pk' },
          },
        },
        {
          delete: {
            table: ORGS_TABLE,
            key: { pk: dnsLabelPk(org.dnsSubdomainLabel) },
            condition: { type: 'attribute_equals', attribute: 'orgId', value: orgId },
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof TransactionCanceledError) {
      const [orgReason, newLabelReason] = error.cancellationReasons;
      if (newLabelReason) throw new DnsLabelInUseError(dnsSubdomainLabel);
      if (orgReason) throw new DnsLabelImmutableError(orgId);
    }
    throw error;
  }

  return { ...org, dnsSubdomainLabel };
}

/** The legal transition graph (this ticket's What to build): `issue: issued->active`,
 * `suspend: active->suspended`, `wake: suspended->active`, `destroy: {active,suspended}->destroyed`.
 * No action is ever legal from `destroyed` - it appears in no `from` list. */
const TRANSITIONS: Record<OrgAction, { from: OrgState[]; to: OrgState }> = {
  issue: { from: ['issued'], to: 'active' },
  suspend: { from: ['active'], to: 'suspended' },
  wake: { from: ['suspended'], to: 'active' },
  destroy: { from: ['active', 'suspended'], to: 'destroyed' },
};

/**
 * Polls `orgId`'s currently-running job to a terminal status, if it has one (#298: production
 * entry point for `Provisioner.checkStatus`, #281). Re-reads the record after the call so a
 * caller observes whatever `checkStatus` actually wrote (status promotion on success, failure
 * reason on failure) rather than the pre-poll snapshot - `checkStatus` itself is a safe no-op
 * when there's nothing running to check (#281), so this needs no pre-filtering either.
 *
 * That re-read asks for a strongly consistent read (CodeRabbit, PR #299): it lands immediately
 * after `checkStatus`'s own conditional write, and an eventually-consistent read here could still
 * observe the pre-write `running` status - which `respondWithOrg` would then store as this
 * request's idempotency result and keep replaying, permanently masking the promotion this
 * endpoint exists to surface.
 */
export async function checkOrgStatus(gateway: AwsGateway, provisioner: Provisioner, orgId: string): Promise<OrgRecord> {
  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);

  await provisioner.checkStatus(org);

  return (await getOrgRecord(gateway, orgId, { consistentRead: true })) ?? org;
}

/**
 * Applies one lifecycle action (this ticket's What to build/Acceptance Criteria).
 *
 * Ordering matters and is deliberate: the provisioner is called *before* the conditional state
 * write, mirroring `AwsProvisioner`/`_apply_transition`'s job-id discipline (ADR-0019) - a job id
 * is minted fresh in memory and only persisted, together with the new state, once its call
 * succeeds. A provisioner failure therefore never partially writes (Acceptance Criteria: "a
 * provisioner failure ... prevents the state change entirely - no partial write"): either the
 * call throws and nothing is written, or it resolves and the write is attempted.
 *
 * The final write is a single `updateItem` conditioned on `state` still being one of `from`
 * (`attribute_in`, checked against whatever is actually current at write time, not the value
 * this call read earlier) - this is what makes two genuinely concurrent transitions on the same
 * org resolve to exactly one persisted winner (Acceptance Criteria) without a separate lock:
 * DynamoDB's own conditional-write atomicity is the seam this relies on
 * (`stack/packages/aws-gateway`), the same primitive the seat-counter increment
 * (docs/dynamodb-access-patterns.md) already depends on. A losing call's provisioner may still
 * have been invoked (both calls read the same pre-race state before either committed) - safe
 * with the no-op `StubProvisioner` this ticket ships; avoiding a real double-provision on the
 * loser is `AwsProvisioner`'s port (#280) and ADR-0020's lock, layered on top of this seam, not
 * a gap in it.
 */
export async function applyTransition(gateway: AwsGateway, provisioner: Provisioner, orgId: string, action: OrgAction): Promise<OrgRecord> {
  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);

  const { from, to } = TRANSITIONS[action];
  if (!from.includes(org.state)) throw new IllegalTransitionError(orgId, action, org.state);

  const jobId = randomUUID();
  try {
    await callProvisioner(provisioner, action, org, jobId);
  } catch (error) {
    // Wrapped so the route layer can map *specifically* a provisioner failure to 502 - a later
    // failure in this same function (the conditional write below) is a different kind of
    // problem and must not be reported the same way (CodeRabbit, PR #284).
    throw new ProvisionerFailedError(orgId, action, error);
  }

  // Issue and Wake both start (or restart) the idle-timeout clock; Destroy always records a
  // snapshot-retention marker, whatever triggered it - the auto-destroy sweep (#282) or a manual
  // `destroy` call alike (docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry). Mirrors
  // `_apply_transition`'s own `values[...]` branches (`custom_addons/hosting_admin/models/
  // trial_org.py`).
  const extra: Record<string, string> = {};
  if (to === 'active') extra.lastActivityAt = new Date().toISOString();
  if (to === 'destroyed') {
    extra.snapshotRetentionUntil = new Date(Date.now() + SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    await gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(orgId) },
      // lastJobStatus/lastJobError are written here, in the same call as state/lastJobId/
      // lastJobAction (ADR-0019) - not by the provisioner itself - so a same-action retry
      // always fails source-state validation before it could ever reach a reuse check (ADR-0019:
      // "by design there's no window where a second top-level call finds a prior job for the
      // same action still outstanding"). `gsi1pk` moves with `state` in the same write so the
      // state-index (`STATE_INDEX`) can never observe a stale partition for this org.
      set: {
        state: to,
        gsi1pk: statePartition(to),
        lastJobId: jobId,
        lastJobAction: action,
        lastJobStatus: 'running',
        lastJobError: '',
        ...extra,
      },
      condition: { type: 'attribute_in', attribute: 'state', values: from },
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedError) throw new ConcurrentWriteError(orgId, action);
    throw error;
  }

  return { ...org, state: to, lastJobId: jobId, lastJobAction: action, lastJobStatus: 'running', lastJobError: '', ...extra };
}

/** A DynamoDB GSI always projects the base table's own primary key attributes, whatever its
 * declared projection type (docs/dynamodb-access-patterns.md's "this ticket does not decide" on
 * projection width) - so `item.pk` is the one thing every query result against `STATE_INDEX`/
 * `EXPIRY_SWEEP_INDEX` can be trusted to carry, and is all `queryOrgIds` below ever reads off a
 * result item. */
function orgIdFromPk(pk: unknown): string {
  const value = String(pk);
  return value.startsWith('org#') ? value.slice('org#'.length) : value;
}

/** Pages `input` (a `STATE_INDEX`/`EXPIRY_SWEEP_INDEX` query, this ticket's What to build: "a
 * small, additive extension to the record store's query capability") to exhaustion, returning
 * just the matched org ids - `sweeps.ts` re-reads each one's full record itself rather than
 * trusting any other attribute a sparsely-projected index might not carry. */
export async function queryOrgIds(gateway: AwsGateway, input: Omit<QueryInput, 'table' | 'cursor'>): Promise<string[]> {
  const orgIds: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await gateway.dynamoDb.query({ table: ORGS_TABLE, ...input, cursor });
    for (const item of page.items) orgIds.push(orgIdFromPk(item.pk));
    cursor = page.nextCursor;
  } while (cursor);
  return orgIds;
}
