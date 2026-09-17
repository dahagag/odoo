import type { StackApiError } from '@stack/api-client';
import { useState } from 'react';
import { newIdempotencyKey, publicApi } from '../lib/apiClient';

/**
 * Requests a magic link (#200 User Stories 4, 6, 12): the same form works for an existing
 * teammate signing back in and for an Open Invite Link's first-ever visitor confirming their
 * company email (ADR-0026) - the API decides which case it is, this page just asks for an email
 * and reports whatever comes back clearly (User Stories 5, 7).
 */
export function SignInPage({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');
    setErrorDetail(undefined);
    try {
      await publicApi.requestMagicLink(orgId, email, newIdempotencyKey());
      setStatus('sent');
    } catch (error) {
      setStatus('error');
      setErrorDetail((error as StackApiError).problem?.detail ?? (error as StackApiError).message);
    }
  }

  if (status === 'sent') {
    return (
      <main className="o_page">
        <h1>Check your email</h1>
        <p>
          If <strong>{email}</strong> can sign in here, we just sent it a link. It expires in 15
          minutes.
        </p>
      </main>
    );
  }

  return (
    <main className="o_page">
      <h1>Sign in</h1>
      <p>Enter your work email and we'll send you a link to sign in - no password needed.</p>
      <form onSubmit={onSubmit}>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@yourcompany.com"
        />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send me a link'}
        </button>
      </form>
      {status === 'error' && <p role="alert">{errorDetail ?? 'That email cannot sign in here.'}</p>}
    </main>
  );
}
