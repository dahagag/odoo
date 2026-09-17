import type { OrgRegistration, Seat, StackApiError } from '@stack/api-client';
import { useCallback, useEffect, useState } from 'react';
import { newIdempotencyKey, orgApi } from '../lib/apiClient';
import type { Session, SessionSetter } from '../lib/session';
import { clearSession } from '../lib/session';

function daysRemaining(expiryDate: string | undefined): number | undefined {
  if (!expiryDate) return undefined;
  const ms = new Date(expiryDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * The signed-in prospect's own org status, seats, and invite form (#200 User Stories 1-4, 14):
 * read scope is strictly this one org, enforced server-side by the org token every call here
 * carries - this page renders whatever the server hands back, never a wider query.
 *
 * `setSession` is the app root's own session-state setter (#323) - this page never persists or
 * reads a session itself, it only asks to end the one it was given.
 */
export function DashboardPage({ session, setSession }: { session: Session; setSession: SessionSetter }) {
  const api = orgApi(session);
  const [registration, setRegistration] = useState<OrgRegistration | undefined>(undefined);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const [reg, seatList] = await Promise.all([api.orgRegistration(session.orgId), api.listSeats(session.orgId)]);
      setRegistration(reg);
      setSeats(seatList);
    } catch (error) {
      setLoadError((error as StackApiError).problem?.detail ?? 'Could not load your org.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) {
    return (
      <main className="o_page">
        <h1>Could not load your org</h1>
        <p>{loadError}</p>
        {/* No page reload needed here (unlike before #323): clearing the in-memory session is
            itself enough to re-render the "Sign in required" branch above this page. */}
        <button type="button" onClick={() => clearSession(setSession)}>
          Sign in again
        </button>
      </main>
    );
  }

  if (!registration) {
    return (
      <main className="o_page">
        <h1>Loading…</h1>
      </main>
    );
  }

  const remaining = daysRemaining(registration.expiryDate);

  return (
    <main className="o_page">
      <h1>{registration.name}</h1>
      <p>
        Status: <strong>{registration.state}</strong>
        {remaining !== undefined && <> · {remaining} day{remaining === 1 ? '' : 's'} remaining</>}
      </p>
      <p>Seats: {registration.seatsUsed} / {registration.seatsTotal}</p>

      <h2>Your team</h2>
      <ul>
        {seats.map((seat) => (
          <li key={seat.seatId}>
            {seat.email} — {seat.state}
          </li>
        ))}
      </ul>

      <InviteForm api={api} orgId={session.orgId} onInvited={reload} />
    </main>
  );
}

function InviteForm({ api, orgId, onInvited }: { api: ReturnType<typeof orgApi>; orgId: string; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');
    setErrorDetail(undefined);
    try {
      await api.inviteSeat(orgId, email, newIdempotencyKey());
      setEmail('');
      setStatus('idle');
      onInvited();
    } catch (error) {
      setStatus('error');
      setErrorDetail((error as StackApiError).problem?.detail ?? (error as StackApiError).message);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="teammate@yourcompany.com"
      />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Inviting…' : 'Invite'}
      </button>
      {status === 'error' && <p role="alert">{errorDetail ?? 'Could not send that invite.'}</p>}
    </form>
  );
}
