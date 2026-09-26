import { describe, expect, it } from 'vitest';
import { projectForecast, type OrgProjectionInput } from '../src/cost/projection';

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function trialOrg(overrides: Partial<OrgProjectionInput> = {}): OrgProjectionInput {
  return {
    orgId: 'org-1', type: 'trial', state: 'active', expiryDate: '2025-02-01T00:00:00.000Z',
    observedDailyRate: 5, ...overrides,
  };
}

describe('projectForecast (this ticket, #198: state-aware projection)', () => {
  it('projects a Client Org indefinitely - no expiry ever stops its contribution', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 1000, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 400,
      orgs: [{ orgId: 'client-1', type: 'client', state: 'active', observedDailyRate: 10 }],
    });
    // 1000 / 10 = 100 days out.
    expect(result.forecastExhaustionDate).toBe('2025-04-11');
  });

  it('a Trial Org stops contributing at its own expiry date, extending the forecast', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 1000, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 400,
      orgs: [trialOrg({ observedDailyRate: 100, expiryDate: '2025-01-05T00:00:00.000Z' })],
    });
    // Burns 100/day for 4 days (Jan2-Jan5) = 400, then nothing - never reaches 1000 within the cap.
    expect(result.forecastExhaustionDate).toBeNull();
  });

  it('every org suspended: still contributes its own (lower) observed rate, not zero', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 100, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 400,
      orgs: [
        { orgId: 'org-1', type: 'trial', state: 'suspended', expiryDate: '2026-01-01T00:00:00.000Z', observedDailyRate: 5 },
        { orgId: 'org-2', type: 'client', state: 'suspended', observedDailyRate: 5 },
      ],
    });
    expect(result.projectedDailyBurn).toBe(10);
    // 100 / 10 = 10 days out.
    expect(result.forecastExhaustionDate).toBe('2025-01-11');
  });

  it('a destroyed org never contributes to the forward projection', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 1000, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 400,
      orgs: [{ orgId: 'org-1', type: 'trial', state: 'destroyed', expiryDate: '2026-01-01T00:00:00.000Z', observedDailyRate: 999 }],
    });
    expect(result.projectedDailyBurn).toBe(0);
    expect(result.forecastExhaustionDate).toBeNull();
  });

  it('an org expiring mid-horizon: the forecast reflects the drop, not a flat extrapolation', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 150, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 400,
      orgs: [trialOrg({ observedDailyRate: 20, expiryDate: '2025-01-03T00:00:00.000Z' })],
    });
    // Day1 (Jan2): +20=20, day2 (Jan3, still <= expiry): +20=40, then contribution stops.
    // A naive flat extrapolation of 20/day would exhaust in ~8 days; this never exhausts within
    // the cap because the org's own contribution stops on day 2.
    expect(result.forecastExhaustionDate).toBeNull();
  });

  it('no history at all: zero orgs and zero unattributed rate never exhausts', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 100, totalSpendToDate: 0,
      unattributedDailyRate: 0, horizonDays: 30, orgs: [],
    });
    expect(result.projectedDailyBurn).toBe(0);
    expect(result.forecastExhaustionDate).toBeNull();
    expect(result.withinHorizon).toBe(false);
  });

  it('a burn rate of zero (credit already exhausted) reports today as the exhaustion date', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 100, totalSpendToDate: 150,
      unattributedDailyRate: 0, horizonDays: 30, orgs: [],
    });
    expect(result.forecastExhaustionDate).toBe('2025-01-01');
    expect(result.withinHorizon).toBe(true);
  });

  it('withinHorizon is false when the forecast exhaustion date is further out than the horizon', () => {
    const result = projectForecast({
      today: date('2025-01-01'), creditAmount: 1000, totalSpendToDate: 0,
      unattributedDailyRate: 10, horizonDays: 10, orgs: [],
    });
    // 1000 / 10 = 100 days out, horizon is only 10.
    expect(result.forecastExhaustionDate).toBe('2025-04-11');
    expect(result.withinHorizon).toBe(false);
  });
});
