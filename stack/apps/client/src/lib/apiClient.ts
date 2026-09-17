import { StackApiClient } from '@stack/api-client';
import type { Session } from './session';

/** Set at build/deploy time (infra/platform) - points at this org's own Administration Stack
 * API. Falls back to same-origin `/api` for local dev behind a proxy. */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

/** A fresh v4-ish id, good enough as an `Idempotency-Key` (this app never needs to *verify*
 * uniqueness itself - the API does) - one per user-initiated action, never reused across retries
 * of a *different* action. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** No session yet (the public asleep/wake surface, or a not-yet-signed-in visitor requesting or
 * verifying a magic link) - every call these pages make is itself public. */
export const publicApi = new StackApiClient({ baseUrl: API_BASE_URL });

/** Attaches the signed-in prospect's own org token (#200 User Story 12) to every call - the
 * org-facing surface (`/org/:orgId/seats`, `/org/:orgId/seats/invite`) rejects anything else. */
export function orgApi(session: Session): StackApiClient {
  return new StackApiClient({
    baseUrl: API_BASE_URL,
    authorize: (init) => ({
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${session.orgToken}` },
    }),
  });
}
