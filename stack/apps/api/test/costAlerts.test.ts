import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { evaluateAlerts, getAlertState, publishAlerts, putAlertState, type CostAlertState } from '../src/cost/alerts';

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const NO_STATE: CostAlertState = { highestSpendThresholdCrossed: null, horizonAlertActive: false };
const CONFIG = { spendThresholds: [50, 100, 150], horizonDays: 14 };

describe('evaluateAlerts', () => {
  it('fires no alert when nothing has crossed', () => {
    const result = evaluateAlerts(NO_STATE, { totalSpend: 10, forecastExhaustionDate: null }, CONFIG, date('2025-01-01'));
    expect(result.alerts).toEqual([]);
    expect(result.nextState).toEqual(NO_STATE);
  });

  it('fires exactly one alert the first time a threshold is crossed', () => {
    const result = evaluateAlerts(NO_STATE, { totalSpend: 60, forecastExhaustionDate: null }, CONFIG, date('2025-01-01'));
    expect(result.alerts).toEqual([{ kind: 'spend-threshold', threshold: 50, totalSpend: 60 }]);
    expect(result.nextState.highestSpendThresholdCrossed).toBe(50);
  });

  it('does not re-fire the same threshold on the next evaluation (one alert per crossing, not per evaluation)', () => {
    const afterFirst = evaluateAlerts(NO_STATE, { totalSpend: 60, forecastExhaustionDate: null }, CONFIG, date('2025-01-01'));
    const second = evaluateAlerts(afterFirst.nextState, { totalSpend: 65, forecastExhaustionDate: null }, CONFIG, date('2025-01-02'));
    expect(second.alerts).toEqual([]);
  });

  it('fires once per threshold when spend jumps past two thresholds in a single evaluation', () => {
    const result = evaluateAlerts(NO_STATE, { totalSpend: 120, forecastExhaustionDate: null }, CONFIG, date('2025-01-01'));
    expect(result.alerts).toEqual([
      { kind: 'spend-threshold', threshold: 50, totalSpend: 120 },
      { kind: 'spend-threshold', threshold: 100, totalSpend: 120 },
    ]);
    expect(result.nextState.highestSpendThresholdCrossed).toBe(100);
  });

  it('fires the horizon alert on the false-to-true edge and not again while it stays true', () => {
    const first = evaluateAlerts(NO_STATE, { totalSpend: 0, forecastExhaustionDate: '2025-01-10' }, CONFIG, date('2025-01-01'));
    expect(first.alerts).toEqual([{ kind: 'horizon', forecastExhaustionDate: '2025-01-10', horizonDays: 14 }]);
    expect(first.nextState.horizonAlertActive).toBe(true);

    const second = evaluateAlerts(first.nextState, { totalSpend: 0, forecastExhaustionDate: '2025-01-09' }, CONFIG, date('2025-01-02'));
    expect(second.alerts).toEqual([]);
  });

  it('re-fires the horizon alert after it clears and crosses back in', () => {
    const active: CostAlertState = { highestSpendThresholdCrossed: null, horizonAlertActive: true };
    const cleared = evaluateAlerts(active, { totalSpend: 0, forecastExhaustionDate: null }, CONFIG, date('2025-01-01'));
    expect(cleared.alerts).toEqual([]);
    expect(cleared.nextState.horizonAlertActive).toBe(false);

    const reEntered = evaluateAlerts(cleared.nextState, { totalSpend: 0, forecastExhaustionDate: '2025-01-10' }, CONFIG, date('2025-01-05'));
    expect(reEntered.alerts).toEqual([{ kind: 'horizon', forecastExhaustionDate: '2025-01-10', horizonDays: 14 }]);
  });

  it('does not fire the horizon alert when the forecast exhaustion date is further out than the horizon', () => {
    const result = evaluateAlerts(NO_STATE, { totalSpend: 0, forecastExhaustionDate: '2025-06-01' }, CONFIG, date('2025-01-01'));
    expect(result.alerts).toEqual([]);
  });
});

describe('publishAlerts', () => {
  it('publishes one SNS message per fired alert', async () => {
    const gateway = new InMemoryAwsGateway();

    await publishAlerts(gateway, 'arn:aws:sns:us-east-1:000000000000:cost-alerts', [
      { kind: 'spend-threshold', threshold: 50, totalSpend: 60 },
      { kind: 'horizon', forecastExhaustionDate: '2025-01-10', horizonDays: 14 },
    ]);

    expect(gateway.sns.publishedMessages).toHaveLength(2);
    expect(gateway.sns.publishedMessages[0]).toMatchObject({ topicArn: 'arn:aws:sns:us-east-1:000000000000:cost-alerts' });
    expect(gateway.sns.publishedMessages[0].message).toMatch(/50/);
    expect(gateway.sns.publishedMessages[1].message).toMatch(/2025-01-10/);
  });
});

describe('getAlertState/putAlertState', () => {
  it('defaults to no crossings yet when nothing is stored', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(getAlertState(gateway)).resolves.toEqual(NO_STATE);
  });

  it('round-trips a stored state', async () => {
    const gateway = new InMemoryAwsGateway();
    await putAlertState(gateway, { highestSpendThresholdCrossed: 100, horizonAlertActive: true });
    await expect(getAlertState(gateway)).resolves.toEqual({ highestSpendThresholdCrossed: 100, horizonAlertActive: true });
  });
});
