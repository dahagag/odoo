import type { AwsGateway } from '@stack/aws-gateway';
import { ORGS_TABLE } from '../org/record';
import type { CostSnapshot } from './dashboard';

const ALERT_STATE_PK = 'cost-alert-state';

export interface CostAlertState {
  /** The highest configured spend threshold `totalSpend` has crossed so far, or `null` before
   * any threshold has been crossed. Spend never decreases within a credit period, so tracking
   * only the highest crossed value is sufficient to fire each threshold exactly once (this
   * ticket's Testing Decisions: "one alert per threshold crossing, not one per evaluation"). */
  highestSpendThresholdCrossed: number | null;
  /** Edge-triggered latch for the horizon alert: `true` while the last evaluation's forecast
   * exhaustion fell within the configured horizon. Reset to `false` once the forecast moves back
   * outside the horizon, so a later re-entry fires again - a genuine new crossing, not a repeat
   * of the same one. */
  horizonAlertActive: boolean;
}

const DEFAULT_STATE: CostAlertState = { highestSpendThresholdCrossed: null, horizonAlertActive: false };

export async function getAlertState(gateway: AwsGateway): Promise<CostAlertState> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: ALERT_STATE_PK } });
  if (!item) return { ...DEFAULT_STATE };
  const { pk: _pk, ...rest } = item;
  return rest as unknown as CostAlertState;
}

export async function putAlertState(gateway: AwsGateway, state: CostAlertState): Promise<void> {
  await gateway.dynamoDb.putItem({ table: ORGS_TABLE, item: { pk: ALERT_STATE_PK, ...state } });
}

export type AlertEvent =
  | { kind: 'spend-threshold'; threshold: number; totalSpend: number }
  | { kind: 'horizon'; forecastExhaustionDate: string; horizonDays: number };

export interface EvaluateAlertsConfig {
  /** Ascending dollar amounts (this ticket's Implementation Decisions: "thresholds are
   * configuration"). */
  spendThresholds: number[];
  horizonDays: number;
}

export interface EvaluateAlertsResult {
  alerts: AlertEvent[];
  nextState: CostAlertState;
}

/**
 * Pure function over the current snapshot, the alert configuration, and the last evaluation's
 * latch state (this ticket's Testing Decisions: assert one alert per crossing, not one per
 * evaluation) - kept apart from the SNS publish call itself (`publishAlerts` below), exactly like
 * `computeFigures`/`projectForecast` are kept apart from their own AWS/storage calls.
 */
export function evaluateAlerts(
  state: CostAlertState,
  snapshot: Pick<CostSnapshot, 'totalSpend' | 'forecastExhaustionDate'>,
  config: EvaluateAlertsConfig,
  today: Date,
): EvaluateAlertsResult {
  const alerts: AlertEvent[] = [];
  const previousHighest = state.highestSpendThresholdCrossed;

  const newlyCrossed = config.spendThresholds
    .filter((threshold) => snapshot.totalSpend >= threshold)
    .filter((threshold) => previousHighest === null || threshold > previousHighest)
    .sort((a, b) => a - b);
  for (const threshold of newlyCrossed) {
    alerts.push({ kind: 'spend-threshold', threshold, totalSpend: snapshot.totalSpend });
  }
  const highestSpendThresholdCrossed = newlyCrossed.length > 0
    ? Math.max(...newlyCrossed)
    : previousHighest;

  const withinHorizon = snapshot.forecastExhaustionDate !== null
    && daysUntil(snapshot.forecastExhaustionDate, today) <= config.horizonDays;
  if (withinHorizon && !state.horizonAlertActive) {
    alerts.push({
      kind: 'horizon',
      forecastExhaustionDate: snapshot.forecastExhaustionDate as string,
      horizonDays: config.horizonDays,
    });
  }

  return {
    alerts,
    nextState: { highestSpendThresholdCrossed, horizonAlertActive: withinHorizon },
  };
}

function daysUntil(isoDate: string, today: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(isoDate).getTime() - today.getTime()) / msPerDay);
}

function describeAlert(alert: AlertEvent): { subject: string; message: string } {
  if (alert.kind === 'spend-threshold') {
    return {
      subject: `AWS spend has crossed $${alert.threshold}`,
      message: `Total AWS spend is now $${alert.totalSpend.toFixed(2)}, past the configured $${alert.threshold} threshold.`,
    };
  }
  return {
    subject: 'AWS credit forecast to exhaust soon',
    message: `AWS credit is forecast to run out on ${alert.forecastExhaustionDate}, within the configured ${alert.horizonDays}-day horizon.`,
  };
}

/** Publishes one SNS message per fired alert (this ticket's Implementation Decisions: "emits to
 * an SNS topic with email subscribed"), so a downstream subscriber sees one notification per
 * crossing rather than a single batched message hiding how many crossed. */
export async function publishAlerts(gateway: AwsGateway, topicArn: string, alerts: AlertEvent[]): Promise<void> {
  for (const alert of alerts) {
    const { subject, message } = describeAlert(alert);
    await gateway.sns.publish({ topicArn, subject, message });
  }
}
