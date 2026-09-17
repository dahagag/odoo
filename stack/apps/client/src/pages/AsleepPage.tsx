import type { AsleepStatus, PublicOrg } from '@stack/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey, publicApi } from '../lib/apiClient';
import './AsleepPage.css';

/** Mirrors `custom_addons/hosting_admin/controllers/asleep.py`'s own `COPY` and `WAKE_STEPS` -
 * the approved design's exact wording (docs/design/174-asleep-wake-page), ported here since this
 * app now owns the asleep page (ADR-0030's amendment). */
const COPY: Record<AsleepStatus['phase'], [string, string]> = {
  idle: [
    'This trial is taking a nap',
    'It suspended itself after a while idle, to save cost. Click Wake Up and it will be back in about a minute or two.',
  ],
  waking: ['Waking up your trial', "Bringing your trial's instance back online. Hang tight."],
  awake: ['You\'re all set!', 'Your trial is back up and running — right where you left it.'],
};

const WAKE_STEPS = [
  { endsAt: 5, label: 'Preparing to wake your trial…', note: 'Getting everything ready to bring your instance back online.' },
  { endsAt: 55, label: 'Starting your trial’s server…', note: 'Powering your instance back on.' },
  { endsAt: 88, label: 'Getting your workspace ready…', note: 'Your server is booting up and starting your apps.' },
  { endsAt: 100, label: 'Almost there…', note: 'Just confirming your trial is responding.' },
] as const;

const LAST_WAKE_STEP = WAKE_STEPS[WAKE_STEPS.length - 1]!;

function stepForProgress(progress: number) {
  return WAKE_STEPS.find((step) => progress < step.endsAt) ?? LAST_WAKE_STEP;
}

const POLL_INTERVAL_MS = 4000;

/** The asleep/Wake-Up page (#200 User Stories 1, 8-11): rendered whenever this app is reached by
 * `Host` alone via Route53 failover (ADR-0030). Visiting never itself wakes the org (`App.tsx`
 * only calls `asleep-status`, never `wake`, on mount/poll) - only the button below does. */
export function AsleepPage({ org }: { org: PublicOrg }) {
  const [status, setStatus] = useState<AsleepStatus | undefined>(undefined);
  const [waking, setWaking] = useState(false);
  const [wakeError, setWakeError] = useState<string | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>();

  const poll = useCallback(async () => {
    try {
      const next = await publicApi.publicAsleepStatus(org.orgId);
      setStatus(next);
      if (next.phase === 'waking') {
        pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    } catch {
      // A transient blip (network, or this very app restarting) must not leave the page stuck -
      // retry instead of dying silently, mirroring controllers/asleep.py's own poll() catch.
      pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }, [org.orgId]);

  useEffect(() => {
    void poll();
    return () => clearTimeout(pollTimer.current);
  }, [poll]);

  const onWake = useCallback(async () => {
    setWaking(true);
    setWakeError(undefined);
    try {
      await publicApi.publicWake(org.orgId, newIdempotencyKey());
    } catch {
      // A failed call (a 429 from the rate limiter, a 502 provisioner failure, a network blip)
      // never actually started waking, so `poll()` below will keep reporting 'idle' - `waking`
      // must come back down or the button stays disabled with no way to retry (CodeRabbit, PR
      // #318).
      setWaking(false);
      setWakeError('Could not start your instance. Try again.');
    }
    void poll();
  }, [org.orgId, poll]);

  const phase = status?.phase;
  const [headline, copy] = phase ? COPY[phase] : ['', ''];

  return (
    <div className="o_asleep_page">
      <div className="o_asleep_card">
        <div className={`o_asleep_icon_ring ${phase === 'awake' ? 'o_asleep_icon_ring_awake' : ''}`}>
          {phase === 'awake' ? <AwakeIcon /> : <SleepIcon />}
        </div>
        <p className="o_asleep_org_name">{org.name}</p>
        <h1 className="o_asleep_headline">{headline}</h1>
        <p className="o_asleep_copy">{copy}</p>

        {phase === 'idle' && (
          <>
            <button type="button" className="o_asleep_btn" onClick={onWake} disabled={waking}>
              Wake Up
            </button>
            {wakeError && <p role="alert" className="o_asleep_step_note">{wakeError}</p>}
          </>
        )}

        {phase === 'waking' && status && <WakingProgress status={status} />}

        {phase === 'awake' && (
          <a className="o_asleep_btn o_asleep_btn_success" href="/web/login">
            Go to your instance →
          </a>
        )}

        <p className="o_asleep_footer">Idle trials suspend automatically to save cost — nothing was lost.</p>
      </div>
    </div>
  );
}

function WakingProgress({ status }: { status: AsleepStatus }) {
  const withinEstimate = status.elapsedSeconds <= status.expectedSeconds;
  const progress = withinEstimate ? Math.min(99, Math.round((status.elapsedSeconds / status.expectedSeconds) * 100)) : undefined;
  const step = stepForProgress(progress ?? 100);

  return (
    <div className="o_asleep_progress">
      <div className="o_asleep_progress_labels">
        <span>{step.label}</span>
        {progress !== undefined && <span className="o_asleep_progress_pct">{progress}%</span>}
      </div>
      <div className="o_asleep_progress_track">
        <div
          className={`o_asleep_progress_fill ${progress === undefined ? 'o_asleep_progress_fill_indeterminate' : ''}`}
          style={progress !== undefined ? { width: `${progress}%` } : undefined}
        />
      </div>
      <p className="o_asleep_step_note">
        {progress !== undefined ? step.note : 'This is taking a little longer than usual, but we’re still on it.'}
      </p>
      <p className="o_asleep_waking_note">This can take a minute or two — this page updates on its own.</p>
    </div>
  );
}

function SleepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />
    </svg>
  );
}

function AwakeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
