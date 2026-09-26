import type { OrgState, OrgType } from '@stack/domain';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How far forward the day-by-day simulation runs before giving up on ever finding an
 * exhaustion date - a burn rate of zero (or one too small to ever exhaust a finite credit within
 * a sane horizon) must resolve to "never", not loop forever or silently truncate wrong. Three
 * years is comfortably past any horizon this ticket's alerting configures. */
const MAX_SIMULATION_DAYS = 365 * 3;

export interface OrgProjectionInput {
  orgId: string;
  type: OrgType;
  state: OrgState;
  /** Present only for a Trial Org (`OrgRecord.expiryDate`, `org/record.ts`) - absent (`undefined`)
   * for a Client Org, which projects indefinitely. */
  expiryDate?: string;
  /** This org's own observed daily spend, from the same trailing burn-rate window
   * `computeFigures` already uses (`perOrgWindowSpend / windowDays`) - the rate this org is
   * assumed to keep contributing at for as long as it's still "in play" below. A `suspended` org
   * still gets its own (typically much lower, but not assumed to be exactly zero) observed rate,
   * rather than being flattened to 0 - this is what makes the projection state-*aware* rather
   * than state-blind (this ticket's Implementation Decisions). */
  observedDailyRate: number;
}

export interface ProjectForecastInput {
  today: Date;
  creditAmount: number;
  totalSpendToDate: number;
  /** The Unattributed bucket's own observed daily rate (shared foundation/CI infrastructure,
   * ADR-0013) - assumed to continue flat, since it isn't tied to any single org's lifecycle. */
  unattributedDailyRate: number;
  orgs: OrgProjectionInput[];
  /** The alerting horizon (days) - not consulted by the simulation itself, only echoed back as
   * `withinHorizon` for `alerts.ts` to key its horizon alert off of. */
  horizonDays: number;
}

export interface ProjectForecastResult {
  /** Today's own projected daily burn (`unattributedDailyRate` plus every org still in play on
   * day 1) - distinct from `computeFigures`' backward-looking `burnRatePerDay`. */
  projectedDailyBurn: number;
  /** ISO date the credit is forecast to be exhausted on, or `null` if it never is within
   * `MAX_SIMULATION_DAYS`. */
  forecastExhaustionDate: string | null;
  /** Whether `forecastExhaustionDate` falls within `horizonDays` of `today` - `false` both when
   * there's no forecast exhaustion date at all and when one exists but is further out than the
   * horizon. */
  withinHorizon: boolean;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whether `org` still contributes its `observedDailyRate` on `date` - a Trial Org stops once
 * `date` is past its `expiryDate` (mirroring auto-destroy, `org/sweeps.ts`'s
 * `sweepAutoDestroy`); a Client Org, which never carries an `expiryDate`, never stops; a
 * `destroyed` org (of either type) never contributes from today onward regardless of any
 * `expiryDate` it happens to still carry, since there is no compute left running to bill. */
function isInPlay(org: OrgProjectionInput, date: Date): boolean {
  if (org.state === 'destroyed') return false;
  if (org.type === 'trial' && org.expiryDate) {
    return date <= new Date(org.expiryDate);
  }
  return true;
}

/**
 * State-aware forward projection (this ticket's Implementation Decisions: "built from the orgs
 * that currently exist, their states, and an observed cost rate per org-state ... rather than
 * remaining credit divided by a trailing average"), kept as a pure function over the record set
 * and observed rates - apart from any AWS/storage call - exactly like `computeFigures`, so it's
 * testable from fixtures with no real org record store behind it.
 *
 * Simulates forward day by day (rather than an analytic closed form) because each org's own
 * contribution is a step function of time (its full observed rate until its own expiry, then
 * zero) - day-by-day accumulation is what makes "an org expiring mid-horizon" a correct,
 * unsurprising case rather than a special-cased branch.
 */
export function projectForecast(input: ProjectForecastInput): ProjectForecastResult {
  const dailyBurnOn = (date: Date): number => {
    let burn = input.unattributedDailyRate;
    for (const org of input.orgs) {
      if (isInPlay(org, date)) burn += org.observedDailyRate;
    }
    return burn;
  };

  const projectedDailyBurn = dailyBurnOn(input.today);

  let cumulativeSpend = input.totalSpendToDate;
  // Already exhausted as of today's own snapshot - nothing left to simulate forward.
  let forecastExhaustionDate: string | null = cumulativeSpend >= input.creditAmount
    ? input.today.toISOString().slice(0, 10)
    : null;
  for (let day = 1; forecastExhaustionDate === null && day <= MAX_SIMULATION_DAYS; day += 1) {
    const date = addDays(input.today, day);
    cumulativeSpend += dailyBurnOn(date);
    if (cumulativeSpend >= input.creditAmount) {
      forecastExhaustionDate = date.toISOString().slice(0, 10);
      break;
    }
  }

  const withinHorizon = forecastExhaustionDate !== null
    && new Date(forecastExhaustionDate) <= addDays(input.today, input.horizonDays);

  return { projectedDailyBurn, forecastExhaustionDate, withinHorizon };
}
