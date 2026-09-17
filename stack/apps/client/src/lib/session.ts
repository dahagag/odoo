/**
 * The signed-in prospect's own session (#200 User Story 12): an org id and the Seat-scoped org
 * token `verifyMagicLink` minted for it. Kept in `localStorage` only - this app has no cookie
 * jar of its own to manage, and losing this on a cleared browser just means signing in again via
 * a fresh magic link (#200 User Story 13's own expectation, not a regression).
 */
export interface Session {
  orgId: string;
  orgToken: string;
}

const STORAGE_KEY = 'stack.client.session';

export function loadSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed.orgId !== 'string' || typeof parsed.orgToken !== 'string') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Returns whether the session actually persisted. A caller that's about to burn a single-use
 * magic link on the strength of this call (`VerifyPage`) needs to know before it redirects
 * somewhere that only reads from `localStorage` - otherwise a private window or a full storage
 * quota silently strands the visitor with no session and no link left to retry with
 * (CodeRabbit, PR #318). */
export function saveSession(session: Session): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveSession above.
  }
}
