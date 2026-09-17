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

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A private window or a full storage quota just means the next page load asks the visitor
    // to sign in again - never a reason to crash the page that just successfully signed them in.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveSession above.
  }
}
