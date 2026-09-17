import type { OrgRecord } from './record';

/**
 * The asleep/Wake-Up page's own phase and status computation (#200), ported from
 * `custom_addons/hosting_admin/controllers/asleep.py` - the approved design
 * (`docs/design/174-asleep-wake-page`) and its exact phase semantics, one language over.
 */

/** Mirrors `WAKING_PHASE_TIMEOUT_MINUTES` (`controllers/asleep.py`): bounds "waking" uniformly,
 * not just for a stub provisioner - past this, the page shows `awake` regardless of what
 * `lastJobStatus` still says, so a never-resolving job (a stub, or a genuinely stuck one) never
 * shows "Waking up" indefinitely. */
export const WAKING_PHASE_TIMEOUT_MINUTES = 5;

/** Mirrors `WAKE_EXPECTED_DURATION_SECONDS`: the midpoint of ADR-0014's own "~1-2 minutes" Wake
 * Up target, against which the client renders real elapsed time as a progress estimate - there
 * is no continuous percentage to poll from the stack, only discrete state transitions. */
export const WAKE_EXPECTED_DURATION_SECONDS = 90;

export type AsleepPhase = 'idle' | 'waking' | 'awake';

/**
 * 'idle' (suspended, showing the Wake Up affordance), 'waking' (a wake job started recently and
 * hasn't yet settled), or 'awake' (anything else - active with no running wake job).
 *
 * `lastActivityAt` doubles as "when the current job started" here: `applyTransition` (`record.
 * ts`) writes it in the exact same call that starts `issue`/`wake`, mirroring
 * `last_job_started_at` one language over.
 */
export function asleepPhase(org: OrgRecord, now: Date = new Date()): AsleepPhase {
  if (org.state === 'suspended') return 'idle';

  const startedRecently = Boolean(
    org.lastActivityAt
    && now.getTime() - new Date(org.lastActivityAt).getTime() < WAKING_PHASE_TIMEOUT_MINUTES * 60_000,
  );
  const isWaking = org.lastJobAction === 'wake' && org.lastJobStatus === 'running' && startedRecently;
  return isWaking ? 'waking' : 'awake';
}

export interface AsleepStatus {
  phase: AsleepPhase;
  elapsedSeconds: number;
  expectedSeconds: number;
}

export function asleepStatus(org: OrgRecord, now: Date = new Date()): AsleepStatus {
  const phase = asleepPhase(org, now);
  const elapsedSeconds = phase === 'waking' && org.lastActivityAt
    ? Math.max(0, (now.getTime() - new Date(org.lastActivityAt).getTime()) / 1000)
    : 0;
  return { phase, elapsedSeconds, expectedSeconds: WAKE_EXPECTED_DURATION_SECONDS };
}
