import type { AwsGateway } from '@stack/aws-gateway';
import { ConcurrentWriteError, IllegalTransitionError } from './errors';
import type { Provisioner } from './provisioner';
import {
  EXPIRY_SWEEP_INDEX,
  EXPIRY_SWEEP_PARTITION,
  IDLE_TIMEOUT_MINUTES,
  STATE_INDEX,
  applyTransition,
  getOrgRecord,
  queryOrgIds,
  statePartition,
} from './record';

export interface SweepResult {
  action: 'suspend' | 'destroy';
  orgIds: string[];
}

/** A candidate org id from either sweep's own query can legitimately have moved on by the time
 * this function gets to it - another sweep run, a manual action, or a genuinely concurrent call
 * (`applyTransition`'s own `attribute_in` condition, `record.ts`). Both are exactly what
 * `applyTransition` already rejects with; a sweep tolerates either as "someone else already
 * handled it" and moves on to the next candidate, rather than failing the whole sweep over one
 * org that's no longer eligible. */
function isAlreadyHandled(error: unknown): boolean {
  return error instanceof IllegalTransitionError || error instanceof ConcurrentWriteError;
}

/**
 * Sweeps every `active` org for idle compute, suspending it (#282's What to build). Never wakes a
 * suspended org - it only ever queries the `active` partition of `STATE_INDEX` and only ever
 * calls the `suspend` action, so a suspended org is never even a candidate here (Acceptance
 * Criteria: "the idle-suspend sweep never wakes a suspended org - only the explicit `wake` action
 * does").
 *
 * Applies uniformly to any org type - unlike the auto-destroy sweep, nothing in #282's Acceptance
 * Criteria (or docs/contexts/hosting/CONTEXT.md's Active/Suspended entry) scopes idle-suspend to
 * a Trial Org alone.
 */
export async function sweepIdleSuspend(
  gateway: AwsGateway,
  provisioner: Provisioner,
  options: { idleTimeoutMinutes?: number; now?: Date } = {},
): Promise<SweepResult> {
  const idleTimeoutMinutes = options.idleTimeoutMinutes ?? IDLE_TIMEOUT_MINUTES;
  const cutoff = new Date((options.now ?? new Date()).getTime() - idleTimeoutMinutes * 60_000).toISOString();

  const candidateOrgIds = await queryOrgIds(gateway, {
    indexName: STATE_INDEX,
    partitionKey: { name: 'gsi1pk', value: statePartition('active') },
  });

  const suspended: string[] = [];
  for (const orgId of candidateOrgIds) {
    const org = await getOrgRecord(gateway, orgId);
    // Re-checked against the freshly-read record, not the query result: `state` may have moved
    // on since the query ran, and `lastActivityAt` is never projected into the query result at
    // all (`queryOrgIds`'s own docstring) - every org reaching `active` always has one (issue/
    // wake both set it), so a missing value here is left alone rather than treated as "idle
    // forever".
    if (!org || org.state !== 'active' || !org.lastActivityAt || org.lastActivityAt > cutoff) continue;

    try {
      await applyTransition(gateway, provisioner, orgId, 'suspend');
      suspended.push(orgId);
    } catch (error) {
      if (isAlreadyHandled(error)) continue;
      throw error;
    }
  }

  return { action: 'suspend', orgIds: suspended };
}

/**
 * Sweeps every Trial Org past its expiry date for Auto-Destroy (#282's What to build). A Client
 * Org is never a candidate at all: it never carries an `expiryDate`, so `record.ts`'s `toItem`
 * never writes it a `gsi2sk` to be indexed under `EXPIRY_SWEEP_INDEX` in the first place
 * (Acceptance Criteria: "a Client Org is never selected by the auto-destroy sweep's query,
 * regardless of any date field it carries"). An `issued` (never provisioned) org *is* indexed
 * here - it still carries an `expiryDate` from creation - but is filtered out below before
 * `destroy` is ever attempted (Acceptance Criteria: "an issued org is ignored by it"), the one
 * part of this sweep's selection that `EXPIRY_SWEEP_INDEX`'s own key shape (partition + expiry
 * date only) cannot express.
 */
export async function sweepAutoDestroy(
  gateway: AwsGateway,
  provisioner: Provisioner,
  options: { now?: Date } = {},
): Promise<SweepResult> {
  const nowIso = (options.now ?? new Date()).toISOString();

  const candidateOrgIds = await queryOrgIds(gateway, {
    indexName: EXPIRY_SWEEP_INDEX,
    partitionKey: { name: 'gsi2pk', value: EXPIRY_SWEEP_PARTITION },
    sortKeyAtMost: { name: 'gsi2sk', value: nowIso },
  });

  const destroyed: string[] = [];
  for (const orgId of candidateOrgIds) {
    const org = await getOrgRecord(gateway, orgId);
    if (!org || (org.state !== 'active' && org.state !== 'suspended')) continue;

    try {
      await applyTransition(gateway, provisioner, orgId, 'destroy');
      destroyed.push(orgId);
    } catch (error) {
      if (isAlreadyHandled(error)) continue;
      throw error;
    }
  }

  return { action: 'destroy', orgIds: destroyed };
}
