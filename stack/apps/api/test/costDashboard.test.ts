import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { computeFigures, getLatestSnapshot, refreshSnapshot, type DailyCostRow } from '../src/cost/dashboard';
import { CostExplorerFailedError } from '../src/cost/errors';
import { applyTransition, createOrg } from '../src/org/record';
import { StubProvisioner } from '../src/org/provisioner';

const DAY = 24 * 60 * 60 * 1000;
function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function row(dateIso: string, orgId: string | null, amount: number): DailyCostRow {
  return { date: dateIso, orgId, amount };
}

describe('computeFigures (ported from HostingCostDashboardSnapshot._compute_figures)', () => {
  it('sums total spend across every row', () => {
    const figures = computeFigures(
      [row('2025-01-01', 'org-1', 10), row('2025-01-02', 'org-1', 5), row('2025-01-02', null, 2)],
      1000, date('2025-01-01'), date('2025-01-02'),
    );
    expect(figures.totalSpend).toBe(17);
  });

  it('groups per-org spend, keying the Unattributed bucket with null', () => {
    const figures = computeFigures(
      [row('2025-01-01', 'org-1', 10), row('2025-01-01', 'org-2', 3), row('2025-01-01', null, 2)],
      1000, date('2025-01-01'), date('2025-01-01'),
    );
    expect(figures.perOrgSpend).toEqual(new Map([['org-1', 10], ['org-2', 3], [null, 2]]));
  });

  it('averages burn rate over the trailing 7-day window', () => {
    const rows: DailyCostRow[] = [];
    for (let i = 0; i < 7; i += 1) {
      rows.push(row(new Date(date('2025-01-08').getTime() - i * DAY).toISOString().slice(0, 10), 'org-1', 7));
    }
    const figures = computeFigures(rows, 1000, date('2024-12-01'), date('2025-01-08'));
    expect(figures.burnRatePerDay).toBe(7);
  });

  it('ignores spend older than the trailing window', () => {
    const rows: DailyCostRow[] = [
      row('2024-12-01', 'org-1', 1000), // far outside the window
      row('2025-01-08', 'org-1', 14),
    ];
    const figures = computeFigures(rows, 100000, date('2024-01-01'), date('2025-01-08'));
    expect(figures.burnRatePerDay).toBe(2); // 14 / 7
  });

  it('clamps the window to days elapsed since the credit started, for a young credit period', () => {
    // Credit started 2 days ago: window is 2 days, not 7.
    const rows: DailyCostRow[] = [
      row('2025-01-07', 'org-1', 10),
      row('2025-01-08', 'org-1', 10),
    ];
    const figures = computeFigures(rows, 1000, date('2025-01-07'), date('2025-01-08'));
    expect(figures.windowDays).toBe(2);
    expect(figures.burnRatePerDay).toBe(10); // 20 / 2
  });

  it('projects days-remaining-on-credit from the burn rate', () => {
    const figures = computeFigures(
      [row('2025-01-01', 'org-1', 10)], 110, date('2025-01-01'), date('2025-01-01'),
    );
    expect(figures.daysRemainingOnCredit).toBe(10); // (110 - 10) / 10
  });

  it('reports zero days remaining once the credit is already exhausted', () => {
    const figures = computeFigures(
      [row('2025-01-01', 'org-1', 200)], 100, date('2025-01-01'), date('2025-01-01'),
    );
    expect(figures.daysRemainingOnCredit).toBe(0);
  });

  it('reports null days-remaining when there is no spend at all (zero burn rate)', () => {
    const figures = computeFigures([], 100, date('2025-01-01'), date('2025-01-01'));
    expect(figures.daysRemainingOnCredit).toBeNull();
    expect(figures.totalSpend).toBe(0);
  });
});

const CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };
const REFRESH_CONFIG = { creditAmount: 200, creditStartDate: date('2025-01-01'), groupByTagKey: 'TrialOrgId', projectionHorizonDays: 30 };

describe('refreshSnapshot', () => {
  it('re-running the same day overwrites rather than duplicating the snapshot', async () => {
    const gateway = new InMemoryAwsGateway();
    gateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 10, unit: 'USD', tagValue: '' }];

    await refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01'));
    gateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 25, unit: 'USD', tagValue: '' }];
    const second = await refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01'));

    const stored = await getLatestSnapshot(gateway);
    expect(stored?.totalSpend).toBe(25);
    expect(second.totalSpend).toBe(25);
  });

  it('two concurrent refreshes for the same day leave exactly one internally-consistent snapshot', async () => {
    const gateway = new InMemoryAwsGateway();
    gateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 42, unit: 'USD', tagValue: '' }];

    const [a, b] = await Promise.all([
      refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01')),
      refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01')),
    ]);

    expect(a.totalSpend).toBe(42);
    expect(b.totalSpend).toBe(42);
    const stored = await getLatestSnapshot(gateway);
    expect(stored?.totalSpend).toBe(42);
    expect(stored?.lines).toHaveLength(1);
  });

  it('a tagged spend with no matching org record degrades to Unattributed', async () => {
    const gateway = new InMemoryAwsGateway();
    gateway.costExplorer.amounts = [
      { start: '2025-01-01', end: '2025-01-02', unblendedCost: 9, unit: 'USD', tagValue: 'no-such-org-id' },
    ];

    const snapshot = await refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01'));

    expect(snapshot.lines).toEqual([{ orgId: null, orgLabel: 'Unattributed', spend: 9 }]);
  });

  it('attributes spend to a real org by its tagged id', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, { type: 'trial', name: 'Acme Evaluation', domain: 'acme.example', seatsTotal: 5 }, CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    gateway.costExplorer.amounts = [
      { start: '2025-01-01', end: '2025-01-02', unblendedCost: 11, unit: 'USD', tagValue: org.orgId },
    ];

    const snapshot = await refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01'));

    expect(snapshot.lines).toEqual([{ orgId: org.orgId, orgLabel: 'Acme Evaluation', spend: 11 }]);
  });

  it('surfaces a CostExplorerFailedError naming the AWS error and leaves the prior snapshot untouched', async () => {
    const gateway = new InMemoryAwsGateway();
    gateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 5, unit: 'USD', tagValue: '' }];
    await refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-01'));

    const failure = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    gateway.costExplorer.getCostAndUsage = async () => { throw failure; };

    await expect(refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-02')))
      .rejects.toMatchObject({ awsErrorCode: 'ThrottlingException' });
    await expect(refreshSnapshot(gateway, REFRESH_CONFIG, date('2025-01-02')).catch((e) => e))
      .resolves.toBeInstanceOf(CostExplorerFailedError);

    // Yesterday's snapshot is still there, labeled with its own (now stale) as-of date, rather
    // than the failed refresh having blanked or corrupted it (this ticket's Implementation
    // Decisions: "retry on the next scheduled run rather than failing the whole refresh").
    const stored = await getLatestSnapshot(gateway);
    expect(stored).toMatchObject({ snapshotDate: '2025-01-01', totalSpend: 5 });
  });
});
