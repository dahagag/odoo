/** Errors `withIdempotency` (`middleware.ts`) raises - `server.ts` maps each to its own Problem
 * Details response, distinguishable from the other 409 causes `knownErrorResponse` already maps
 * (`DnsLabelInUseError`, `IllegalTransitionError`, `ConcurrentWriteError`) via its own title. */

/** The scoped key (principal + method + route + the client's raw `Idempotency-Key`) matches an
 * existing claim/record whose request fingerprint does not - the client reused a key across two
 * materially different requests (#285's Implementation Decisions: "a reused key against a
 * request with a materially different body [is] rejected with a clear 409, rather than either
 * silently replayed or silently treated as a fresh key"). */
export class IdempotencyKeyReusedError extends Error {
  constructor(readonly key: string) {
    super(`Idempotency-Key reused with a different request: ${key}`);
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** A concurrent caller's claim is still `pending` and unexpired after the bounded poll window
 * elapsed - the leader hasn't finished yet, so this caller fails fast with a distinct, retryable
 * status rather than holding the connection open past that bound (#285's Implementation
 * Decisions). */
export class IdempotencyStillProcessingError extends Error {
  constructor(readonly key: string, readonly retryAfterSeconds: number) {
    super(`Idempotency-Key is still being processed by another request: ${key}`);
    this.name = 'IdempotencyStillProcessingError';
  }
}
