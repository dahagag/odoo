import { useEffect, useState } from 'react';
import { newIdempotencyKey, publicApi } from '../lib/apiClient';
import { saveSession } from '../lib/session';

/**
 * Exchanges a magic-link `token` for a signed-in session (#200 User Stories 12, 13). Single-use
 * and time-boxed on the server - this page just reports whichever outcome comes back, never
 * distinguishing "expired" from "already used" from "never existed" (the API itself doesn't).
 */
export function VerifyPage({ token }: { token: string | undefined }) {
  const [state, setState] = useState<'verifying' | 'failed' | 'save-failed'>('verifying');

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
        // The link is already single-use and just got consumed server-side, regardless of what
        // happens next - so a storage failure here (private browsing, a full quota) must not
        // still redirect to a dashboard that only reads from localStorage and would just show
        // "sign in required" with no session and no link left to retry (CodeRabbit, PR #318).
        if (!saveSession({ orgId: verified.orgId, orgToken: verified.orgToken })) {
          setState('save-failed');
          return;
        }
        window.location.replace('/dashboard');
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
  }, [token]);

  if (state === 'verifying') {
    return (
      <main className="o_page">
        <h1>Signing you in…</h1>
      </main>
    );
  }

  if (state === 'save-failed') {
    return (
      <main className="o_page">
        <h1>Signed in, but couldn't stay signed in</h1>
        <p role="alert">
          Your link worked, but this browser wouldn't let us save your session - private
          browsing or blocked storage can cause this. Allow storage for this site, then ask for
          a new link from your invitation.
        </p>
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
