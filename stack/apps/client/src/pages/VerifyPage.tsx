import { useEffect, useState } from 'react';
import { newIdempotencyKey, publicApi } from '../lib/apiClient';
import type { Session } from '../lib/session';

/**
 * Exchanges a magic-link `token` for a signed-in session (#200 User Stories 12, 13). Single-use
 * and time-boxed on the server - this page just reports whichever outcome comes back, never
 * distinguishing "expired" from "already used" from "never existed" (the API itself doesn't).
 *
 * Hands the verified session to `onSignedIn` rather than persisting it or navigating anywhere
 * itself (#323) - the app root owns where a session lives and how sign-in transitions to the
 * dashboard.
 */
export function VerifyPage({ token, onSignedIn }: { token: string | undefined; onSignedIn: (session: Session) => void }) {
  const [state, setState] = useState<'verifying' | 'failed'>('verifying');

  useEffect(() => {
    if (!token) {
      setState('failed');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const verified = await publicApi.verifyMagicLink(token, newIdempotencyKey());
        if (cancelled) return;
        onSignedIn({ orgId: verified.orgId, orgToken: verified.orgToken });
      } catch {
        // Surfaced generically (#200's own "clear rejection" is about domain mismatch at
        // *request* time, User Stories 5/7 - a token that's already unknown/used/expired by
        // verify time has nothing more specific to say than "request a new one").
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === 'verifying') {
    return (
      <main className="o_page">
        <h1>Signing you in…</h1>
      </main>
    );
  }

  return (
    <main className="o_page">
      <h1>This link no longer works</h1>
      <p>It may have expired or already been used. Ask for a new one from your invitation.</p>
    </main>
  );
}
