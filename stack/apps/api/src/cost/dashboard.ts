import type { AwsGateway } from '@stack/aws-gateway';
import type { OrgType } from '@stack/domain';
import { getOrgRecord, ORGS_TABLE } from '../org/record';
import { CostExplorerFailedError } from './errors';
import { projectForecast, type OrgProjectionInput } from './projection';

/** `null` keys the "Unattributed" bucket - AWS spend carrying no `TrialOrgId` tag value at all
 * (the shared foundation/CI infrastructure ADR-0013 keeps outside any single org's own tag), or
 * a tag value that no longer matches any org record. Mirrors the old `trial_org_id: int | None`
 * dict key one language over (a `Map` rather than a plain object, since a plain object's keys
 * are always strings and could never represent this distinction directly). */
export type OrgKey = string | null;

export interface DailyCostRow {
  /** ISO date (`YYYY-MM-DD`), no time component. */
  date: string;
  orgId: OrgKey;
  amount: number;
}

export interface ComputedFigures {
  totalSpend: number;
  /** Average daily spend over the trailing window (docs/adr/0030: clamped to however many days
   * have actually elapsed since `creditStartDate`, so a fresh credit period doesn't understate
   * the rate by averaging over days that don't exist yet). */
  burnRatePerDay: number;
  /** `null` when `burnRatePerDay` is 0 (nothing to project from), `0` once the credit is already
   * exhausted, otherwise `(creditAmount - totalSpend) / burnRatePerDay`. */
  daysRemainingOnCredit: number | null;
  /** Every distinct org key seen, keyed spend since `creditStartDate`. */
  perOrgSpend: Map<OrgKey, number>;
  /** Each org key's own spend within the trailing burn-rate window only - this ticket's own
   * addition (the old Odoo dashboard never needed a per-org rate), the observed daily rate the
   * state-aware projection multiplies forward per org. */
  perOrgWindowSpend: Map<OrgKey, number>;
  /** The window's own length in days - callers divide `perOrgWindowSpend` by this to get a daily
   * rate. */
  windowDays: number;
}

const BURN_RATE_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Pure computation from AWS's own daily cost rows to this snapshot's figures - kept apart from
 * any AWS/storage call (this ticket's Testing Decisions: "assert on computed figures given
 * fixture cost data"), porting `HostingCostDashboardSnapshot._compute_figures`
 * (custom_addons/hosting_admin/models/cost_dashboard.py) one language over, verbatim on the
 * window-clamp and unattributed-bucket behavior docs/adr/0030 documents.
 */
export function computeFigures(
  dailyRows: DailyCostRow[],
  creditAmount: number,
  creditStartDate: Date,
  today: Date,
): ComputedFigures {
  const perOrgSpend = new Map<OrgKey, number>();
  for (const row of dailyRows) {
    perOrgSpend.set(row.orgId, (perOrgSpend.get(row.orgId) ?? 0) + row.amount);
  }
  const totalSpend = [...perOrgSpend.values()].reduce((sum, amount) => sum + amount, 0);

  // Clamp the averaging window to however many days have actually elapsed since the credit
  // started, so a credit period only a few days old doesn't understate the rate by averaging
  // spend over days that don't exist yet.
  const daysElapsed = daysBetween(creditStartDate, today) + 1;
  const windowDays = Math.max(1, Math.min(BURN_RATE_WINDOW_DAYS, daysElapsed));
  const windowStart = addDays(today, -(windowDays - 1));
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  const perOrgWindowSpend = new Map<OrgKey, number>();
  let recentSpend = 0;
  for (const row of dailyRows) {
    if (row.date < windowStartIso || row.date > todayIso) continue;
    recentSpend += row.amount;
    perOrgWindowSpend.set(row.orgId, (perOrgWindowSpend.get(row.orgId) ?? 0) + row.amount);
  }
  const burnRatePerDay = recentSpend / windowDays;

  const remainingCredit = creditAmount - totalSpend;
  let daysRemainingOnCredit: number | null;
  if (remainingCredit <= 0) daysRemainingOnCredit = 0;
  else if (burnRatePerDay <= 0) daysRemainingOnCredit = null;
  else daysRemainingOnCredit = remainingCredit / burnRatePerDay;

  return { totalSpend, burnRatePerDay, daysRemainingOnCredit, perOrgSpend, perOrgWindowSpend, windowDays };
}

export interface CostSnapshotLine {
  orgId: OrgKey;
  /** The org's own name at the time of this refresh, or `'Unattributed'` - a snapshot line is a
   * point-in-time record, so it doesn't follow a later org rename the way a live join would
   * (matches `hosting.cost.dashboard.line.org_label`'s own stored-not-computed choice for this
   * exact reason once `trial_org_id` is later deleted). */
  orgLabel: string;
  spend: number;
}

/** Spend split by org type, so shared/foundation cost never distorts either figure (this
 * ticket's User Stories, #3/#4: "spend attributed to shared infrastructure separated from
 * per-org spend" and "spend split by Trial Org versus Client Org, so that I can see the cost of
 * selling separately from the cost of serving"). `unattributed` carries both the AWS-side
 * Unattributed bucket (`OrgKey` `null`) and any tagged spend whose org record no longer exists -
 * neither is a Trial Org or Client Org's own cost. */
export interface SpendByType {
  trial: number;
  client: number;
  unattributed: number;
}

export interface CostSnapshot {
  snapshotDate: string;
  totalSpend: number;
  burnRatePerDay: number;
  creditAmount: number;
  daysRemainingOnCreditKnown: boolean;
  daysRemainingOnCredit: number;
  lines: CostSnapshotLine[];
  spendByType: SpendByType;
  forecastExhaustionDate: string | null;
  projectedDailyBurn: number;
}

/** A single fixed key, not one per date: the dashboard only ever reads "the latest snapshot"
 * (this ticket's User Stories, #12: "know the figures' as-of time" - carried in `snapshotDate`,
 * a field on the item, not encoded into its key). Keying by date as well would make a failed
 * refresh (this ticket's Implementation Decisions: "retry on the next scheduled run rather than
 * failing the whole refresh") silently blank the dashboard until the next successful run, rather
 * than continuing to show the last good snapshot labeled with its own (now stale) as-of date -
 * exactly the "a stale figure is not mistaken for a current one" story (#11) asks to avoid by
 * being explicit about staleness, not by hiding the data. */
const SNAPSHOT_PK = 'cost-snapshot';

function toItem(snapshot: CostSnapshot): Record<string, unknown> {
  return {
    pk: SNAPSHOT_PK,
    ...snapshot,
    lines: JSON.stringify(snapshot.lines),
  };
}

function fromItem(item: Record<string, unknown>): CostSnapshot {
  const { pk: _pk, lines, ...rest } = item;
  return { ...rest, lines: JSON.parse(lines as string) } as CostSnapshot;
}

export async function getLatestSnapshot(gateway: AwsGateway): Promise<CostSnapshot | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: SNAPSHOT_PK } });
  return item ? fromItem(item) : undefined;
}

/** Best-effort label for why the AWS Cost Explorer call failed, read from the AWS error's own
 * `name` when it looks like a real AWS SDK error - never a guessed cause. Falls back to the
 * exception's own class name otherwise. Mirrors
 * `HostingCostDashboardSnapshot._describe_cost_explorer_failure` one language over. */
function describeCostExplorerFailure(error: unknown): string {
  if (error instanceof Error) return error.name || error.constructor.name;
  return 'UnknownError';
}

export interface RefreshSnapshotConfig {
  creditAmount: number;
  creditStartDate: Date;
  /** The cost-allocation tag `getCostAndUsage` groups by - always `'TrialOrgId'` in production,
   * injectable for tests. */
  groupByTagKey: string;
  /** Horizon (days) the state-aware projection forecasts out to and alerts against - passed
   * straight through to `projectForecast`. */
  projectionHorizonDays: number;
}

/**
 * Scheduled action (daily, reachable by an external scheduler - `POST /v1/admin/cost/
 * refresh-snapshot`, mirroring the sweep routes): pulls AWS's own cost-and-usage data grouped by
 * the configured cost-allocation tag since `creditStartDate`, and upserts today's snapshot from
 * it. Idempotent by construction - see docs/adr/0030's amendment and this ticket's own design
 * decision: the snapshot is one DynamoDB item per date, replaced wholesale by a single
 * unconditional `putItem`, so two concurrent refreshes computing from the same day's AWS data
 * converge on equivalent output regardless of write order, with nothing left to lock.
 */
export async function refreshSnapshot(gateway: AwsGateway, config: RefreshSnapshotConfig, today: Date): Promise<CostSnapshot> {
  const todayIso = today.toISOString().slice(0, 10);
  const startIso = config.creditStartDate.toISOString().slice(0, 10);
  const endIso = addDays(today, 1).toISOString().slice(0, 10);

  let amounts;
  try {
    ({ amounts } = await gateway.costExplorer.getCostAndUsage({
      start: startIso,
      end: endIso,
      granularity: 'DAILY',
      groupByTagKey: config.groupByTagKey,
    }));
  } catch (error) {
    // A transient AWS hiccup (throttling, an IAM permissions blip, or the known
    // cost-allocation-tag activation delay - docs/adr/0030) must not kill the whole refresh with
    // a raw, unclear exception; the daily cron logs this and retries tomorrow, leaving the prior
    // snapshot untouched (this ticket's Implementation Decisions: "retry on the next scheduled
    // run rather than failing the whole refresh").
    throw new CostExplorerFailedError(describeCostExplorerFailure(error), error);
  }

  const dailyRows: DailyCostRow[] = amounts.map((amount) => ({
    date: amount.start,
    // An empty tagValue is AWS's own convention for "no value for this tag key" - Unattributed.
    orgId: amount.tagValue ? amount.tagValue : null,
    amount: amount.unblendedCost,
  }));

  const figures = computeFigures(dailyRows, config.creditAmount, config.creditStartDate, today);

  const orgKeys = [...figures.perOrgSpend.keys()].filter((key): key is string => key !== null);
  const orgLabels = new Map<string, string>();
  const orgTypes = new Map<string, OrgType>();
  const orgProjectionInputs: OrgProjectionInput[] = [];
  for (const orgId of orgKeys) {
    // A stale tag value with no matching org record degrades to Unattributed rather than
    // crashing the refresh (mirrors the old dashboard's `existing_trial_orgs` filter) - and
    // never contributes to the forward projection either, since there's no live org behind it
    // to still be "in play".
    const org = await getOrgRecord(gateway, orgId);
    if (org) {
      orgLabels.set(orgId, org.name);
      orgTypes.set(orgId, org.type);
      const windowSpend = figures.perOrgWindowSpend.get(orgId) ?? 0;
      orgProjectionInputs.push({
        orgId,
        type: org.type,
        state: org.state,
        expiryDate: org.expiryDate,
        observedDailyRate: windowSpend / figures.windowDays,
      });
    }
  }

  const lines: CostSnapshotLine[] = [...figures.perOrgSpend.entries()].map(([orgId, spend]) => ({
    orgId: orgId !== null && orgLabels.has(orgId) ? orgId : null,
    orgLabel: orgId !== null ? (orgLabels.get(orgId) ?? 'Unattributed') : 'Unattributed',
    spend,
  }));

  const spendByType: SpendByType = { trial: 0, client: 0, unattributed: 0 };
  for (const [orgId, spend] of figures.perOrgSpend.entries()) {
    const type = orgId !== null ? orgTypes.get(orgId) : undefined;
    if (type === 'trial') spendByType.trial += spend;
    else if (type === 'client') spendByType.client += spend;
    else spendByType.unattributed += spend;
  }

  const unattributedWindowSpend = figures.perOrgWindowSpend.get(null) ?? 0;
  const forecast = projectForecast({
    today,
    creditAmount: config.creditAmount,
    totalSpendToDate: figures.totalSpend,
    unattributedDailyRate: unattributedWindowSpend / figures.windowDays,
    orgs: orgProjectionInputs,
    horizonDays: config.projectionHorizonDays,
  });

  const snapshot: CostSnapshot = {
    snapshotDate: todayIso,
    totalSpend: figures.totalSpend,
    burnRatePerDay: figures.burnRatePerDay,
    creditAmount: config.creditAmount,
    daysRemainingOnCreditKnown: figures.daysRemainingOnCredit !== null,
    daysRemainingOnCredit: figures.daysRemainingOnCredit ?? 0,
    lines,
    spendByType,
    forecastExhaustionDate: forecast.forecastExhaustionDate,
    projectedDailyBurn: forecast.projectedDailyBurn,
  };

  await gateway.dynamoDb.putItem({ table: ORGS_TABLE, item: toItem(snapshot) });

  return snapshot;
}
