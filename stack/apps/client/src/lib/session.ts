/**
 * The signed-in prospect's own session (#200 User Story 12): an org id and the Seat-scoped org
 * token `verifyMagicLink` minted for it. Held only in the app root's own React state, never
 * persisted to `localStorage`/`sessionStorage`/a cookie - anything written there would stay
 * readable, after the fact, by any same-origin script (e.g. an unrelated XSS bug), for as long
 * as the token stays valid (#323). Losing this on a reload, a new tab, or a closed browser just
 * means signing in again via a fresh magic link - the same recovery path this app already offers
 * for a cleared browser, not a regression.
 */
export interface Session {
  orgId: string;
  orgToken: string;
}

/** The app root's own session-state setter (`useState`'s), threaded down to whichever page needs
 * to start or end a session - named here so every page shares one type instead of writing this
 * function shape out fresh. */
export type SessionSetter = (session: Session | undefined) => void;

/** The one documented way to end a session, so a future page doesn't invent its own. Takes the
 * app root's own `setSession` so there is exactly one place session state actually lives. */
export function clearSession(setSession: SessionSetter): void {
  setSession(undefined);
}
