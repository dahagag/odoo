import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { ConditionalCheckFailedError, TransactionCanceledError } from '@stack/aws-gateway';
import type { OrgAction, OrgState, OrgType } from '@stack/domain';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  IllegalTransitionError,
  OrgNotFoundError,
  ProvisionerFailedError,
} from './errors';
import { callProvisioner, type Provisioner } from './provisioner';
import type { LifecycleOperation } from './lifecycleOperation';

/** The org record store's key schema (docs/dynamodb-access-patterns.md): a single-item org
 * record under `org#<orgId>`, plus one `dnslabel#<label>` reservation item per unique
 * `dnsSubdomainLabel` in the same table - the mechanism that makes uniqueness atomic at create
 * time (this ticket's Acceptance Criteria) rather than a racy separate check. */
export const ORGS_TABLE = 'orgs';

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
  /** The most recently accepted client lifecycle operation/action, written with the state it
   * caused. It is stable for retries of that one idempotent request. */
  lastJobId?: string;
  lastJobAction?: OrgAction;
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
  return compact({ pk: orgPk(org.orgId), ...org });
}

function fromItem(item: Record<string, unknown>): OrgRecord {
  const { pk: _pk, ...rest } = item;
  return rest as unknown as OrgRecord;
}

export interface CreateOrgInput {
  type: OrgType;
  name: string;
  domain: string;
  seatsTotal: number;
  dnsSubdomainLabel: string;
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

  const org: OrgRecord = {
    orgId,
    type: input.type,
    state: 'issued',
    // Region *selection* is explicitly out of scope until #207 (#196: "Nothing selects it
    // yet.") - every org gets the configured default, with no caller-supplied override.
    region: config.defaultRegion,
    dnsSubdomainLabel: input.dnsSubdomainLabel,
    name: input.name,
    domain: input.domain,
    seatsUsed: 0,
    seatsTotal: input.seatsTotal,
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
            item: { pk: dnsLabelPk(input.dnsSubdomainLabel), orgId },
            condition: { type: 'attribute_not_exists', attribute: 'pk' },
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof TransactionCanceledError && error.cancellationReasons[1]) {
      throw new DnsLabelInUseError(input.dnsSubdomainLabel);
    }
    throw error;
  }

  return org;
}

export async function getOrgRecord(gateway: AwsGateway, orgId: string): Promise<OrgRecord | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId) } });
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
 * Applies one lifecycle action (this ticket's What to build/Acceptance Criteria).
 *
 * Ordering matters and is deliberate: the provisioner is called *before* the conditional state
 * write. The route derives one stable operation identity from its idempotency context, and this
 * function persists that identity with the new state only after the provisioner succeeds. A
 * provisioner failure therefore never partially writes (Acceptance Criteria: "a
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
export async function applyTransition(
  gateway: AwsGateway,
  provisioner: Provisioner,
  orgId: string,
  action: OrgAction,
  operation: LifecycleOperation,
): Promise<OrgRecord> {
  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);

  const { from, to } = TRANSITIONS[action];
  if (!from.includes(org.state)) throw new IllegalTransitionError(orgId, action, org.state);

  try {
    await callProvisioner(provisioner, action, org, operation);
  } catch (error) {
    // Wrapped so the route layer can map *specifically* a provisioner failure to 502 - a later
    // failure in this same function (the conditional write below) is a different kind of
    // problem and must not be reported the same way (CodeRabbit, PR #284).
    throw new ProvisionerFailedError(orgId, action, error);
  }

  try {
    await gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(orgId) },
      set: { state: to, lastJobId: operation.id, lastJobAction: action },
      condition: { type: 'attribute_in', attribute: 'state', values: from },
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedError) throw new ConcurrentWriteError(orgId, action);
    throw error;
  }

  return { ...org, state: to, lastJobId: operation.id, lastJobAction: action };
}
