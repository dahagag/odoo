/**
 * Per-org rate limiting for the public Wake endpoint (#200's User Story 16 and Further Notes:
 * "the meaningful limit is per org, not just per IP - the cost being protected is EC2 start-stop
 * churn rather than request volume"). A per-IP limit is close to useless here (a link shared in
 * a group chat has many IPs pressing the same org's button); a per-org one bounds the actual
 * cost regardless of how many distinct visitors trigger it.
 *
 * `InMemoryWakeRateLimiter` is the only implementation this ticket ships - a single process's
 * memory is enough to bound *this* process's own EC2 calls, and losing counters on a restart
 * only ever relaxes the limit, never breaks the underlying "one wake per suspended org" safety
 * property `org/record.ts`'s own state check already enforces.
 */
/** Raised by the public wake route's own idempotent `op` (`server.ts`) when `WakeRateLimiter.
 * attempt` refuses this attempt - deliberately checked *inside* the idempotency-replay boundary
 * (docs/adr/0036's idempotency seam), not before it: a genuine retry of the same click (the same
 * `Idempotency-Key`) replays the stored result without calling `attempt()` again, so it can never
 * itself consume another slot in the window - only a distinct new attempt (a fresh key) can. */
export class WakeRateLimitedError extends Error {
  constructor(readonly orgId: string, readonly retryAfterSeconds: number) {
    super(`Too many wake attempts for org ${orgId}; retry after ${retryAfterSeconds}s`);
    this.name = 'WakeRateLimitedError';
  }
}

export interface WakeRateLimiter {
  /** Records an attempt for `orgId` and reports whether it's allowed. Called once per incoming
   * request, before checking whether the org is actually suspended - a flood of requests must
   * not reach even that state-check for free. */
  attempt(orgId: string, now?: number): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

/** A small burst allowance (a legitimate double/triple click on a slow connection) within a
 * cooldown window, rather than a strict one-per-window limit that would itself misfire on
 * perfectly ordinary UI behaviour. */
export const WAKE_RATE_LIMIT_WINDOW_MS = 60_000;
export const WAKE_RATE_LIMIT_MAX_ATTEMPTS = 3;

export class InMemoryWakeRateLimiter implements WakeRateLimiter {
  private readonly attemptTimestampsByOrgId = new Map<string, number[]>();

  attempt(orgId: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const windowStart = now - WAKE_RATE_LIMIT_WINDOW_MS;
    const attempts = (this.attemptTimestampsByOrgId.get(orgId) ?? []).filter((timestamp) => timestamp > windowStart);

    if (attempts.length >= WAKE_RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterMs = (attempts[0] ?? now) + WAKE_RATE_LIMIT_WINDOW_MS - now;
      this.attemptTimestampsByOrgId.set(orgId, attempts);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    attempts.push(now);
    this.attemptTimestampsByOrgId.set(orgId, attempts);
    return { allowed: true };
  }
}
