import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_KEY_HEADER } from '@stack/domain';
import { problem } from '../problem';
import { IdempotencyKeyReusedError, IdempotencyStillProcessingError } from './errors';
import type { IdempotencyRecord, IdempotencyStore } from './store';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

/** The API's own request timeout budget is on this order (this ticket's Further Notes) - long
 * enough to cover a real `compute()` call, including a lifecycle action's provisioner
 * invocation, short enough that an abandoned claim doesn't wedge a key for long. */
const DEFAULT_LEASE_MS = 30_000;
/** A bounded window, well under `DEFAULT_LEASE_MS`, that a concurrent caller spends waiting for
 * a `pending` claim to resolve before failing fast (this ticket's Implementation Decisions: "on
 * the order of a few seconds"). */
const DEFAULT_POLL_WINDOW_MS = 3_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
/** Leaves at least two renewal attempts inside a single lease window before it would expire
 * (this ticket's, #287, Implementation Decisions), so one slow or missed tick doesn't itself let
 * the lease lapse. */
const DEFAULT_RENEW_INTERVAL_FRACTION = 3;

/** Fires the moment a renewal attempt reports this leader has been demoted (#287) - `compute()`
 * can't be cancelled once started, so this is the operational signal that a real
 * double-invocation risk may be underway, not an error `withIdempotency` itself can act on. */
function defaultOnDemoted(info: { key: string }): void {
  console.error(`idempotency: claim ${info.key} was reclaimed while compute() was still running - a demoted leader's compute() will still finish, but its result will not be stored`);
}

/** Injected for tests to observe/assert on a renewal-loop failure without depending on
 * `console.error` (this ticket, #287). Defaults to a loud `console.error` - fired once if
 * `sleep`, `store.renew()`, or `onDemoted` itself throws before the loop has settled. */
function defaultOnRenewalError(info: { key: string; error: unknown }): void {
  console.error(`idempotency: lease renewal loop for claim ${info.key} failed`, info.error);
}

/** `signal` lets a caller actually cancel the pending timer (rather than just outliving it) -
 * the renewal loop aborts it the instant `compute()` settles, instead of leaving it to fire on
 * its own up to `renewIntervalMs` later (#289 review). */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Deterministic across key order, so two requests carrying the same fields in a different
 * order (still the "same" request as far as a caller is concerned) fingerprint identically. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface IdempotencyContext {
  /** Opaque, already scoped by principal + method + route + the client's raw header value -
   * `withIdempotency` and `IdempotencyStore` never need to know what went into it. */
  key: string;
  fingerprint: string;
}

/**
 * Scopes the client-supplied `Idempotency-Key` header by the authenticated admin principal
 * (`request.adminPrincipal.arn`, the same trusted identity source the admin surface already
 * establishes per docs/adr/0036 - not a second, weaker notion of caller identity) and by HTTP
 * method + registered route template (`request.routeOptions.url`, e.g.
 * `/v1/admin/orgs/:orgId/suspend` - the *template*, not the raw path with `orgId` already
 * substituted in, so `suspend` and `destroy` on the very same org never collide even though only
 * their final path segment differs).
 *
 * This closes #285's gap (b): a `createOrg` and a later unrelated `suspend` can never share a
 * stored claim even if the client reuses the same raw header value, because their scoped keys
 * differ by method and route alone before the raw key is even considered.
 *
 * The request body's fingerprint travels separately (`IdempotencyContext.fingerprint`) rather
 * than folded into `key` itself, because route scoping alone doesn't disambiguate two different
 * calls to the *same* route (`createOrg` has no `orgId` segment) - `withIdempotency` compares it
 * against whatever fingerprint an existing claim/record stored, and a mismatch is a `409`.
 */
export function idempotencyContext(request: FastifyRequest): IdempotencyContext {
  const rawKey = idempotencyKeyOf(request);
  const principal = request.adminPrincipal?.arn;
  if (!principal) {
    throw new Error('request.adminPrincipal is unset - did requireAdminPrincipal run as a preHandler?');
  }
  const route = request.routeOptions.url;
  if (!route) {
    // Only unset for a 404 (no route matched) - unreachable from inside a registered route
    // handler, which is the only place this runs. A silent fallback to `request.url` (the raw
    // path, `orgId` already substituted in) would reintroduce exactly the collision this
    // function exists to prevent (`suspend`/`destroy` on the same org colliding), so this is a
    // wiring bug to surface loudly, not a case to paper over.
    throw new Error('request.routeOptions.url is unset - idempotencyContext must run from inside a matched route handler');
  }
  const scoped = createHash('sha256')
    .update(stableStringify([principal, request.method, route, request.params, rawKey]))
    .digest('hex');
  const fingerprint = createHash('sha256').update(stableStringify(request.body)).digest('hex');
  return { key: scoped, fingerprint };
}

export interface WithIdempotencyOptions {
  leaseMs?: number;
  pollWindowMs?: number;
  pollIntervalMs?: number;
  /** How often the leader renews its own claim while `compute()` is running (this ticket, #287).
   * Defaults to a fraction of `leaseMs` so a single slow tick still leaves headroom. */
  renewIntervalMs?: number;
  /** Injected for tests to observe/assert on demotion without depending on `console.error`
   * (this ticket, #287). Defaults to a loud `console.error` - fired once when a renewal attempt
   * reports this leader is no longer the owner. */
  onDemoted?: (info: { key: string }) => void;
  /** Injected for tests to observe/assert on a renewal-loop failure without depending on
   * `console.error` (this ticket, #287). Defaults to a loud `console.error` - fired once if the
   * renewal loop rejects before it has settled. */
  onRenewalError?: (info: { key: string; error: unknown }) => void;
  /** Injected for tests; defaults to the real clock/timer. `signal`, when supplied by the
   * renewal loop, aborts an in-flight wait immediately once `compute()` settles (#289 review) -
   * an injected `sleep` may ignore it, in which case that wait simply runs to completion. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Every state-changing endpoint calls this instead of writing its response directly (#195's
 * Implementation Decisions: "every state-changing endpoint takes an idempotency key").
 *
 * Grown from #195's plain `get`/`putIfAbsent` into a claim/lease state machine (#285): `claim`
 * either makes this call the leader (fresh key, or a stale abandoned one reclaimed), hands back
 * an already-`succeeded` record to replay, reports a live `pending` claim to wait out, or flags
 * a fingerprint mismatch to reject outright. Closes #195's explicitly-deferred gap - "two calls
 * that race in true parallel with the same never-seen-before key can both pass the fast-path
 * `get` and both run `compute`" - because only the caller that wins `claim`'s atomic write ever
 * runs `compute` at all; every other racer waits for that claim to resolve instead. */
export async function withIdempotency(
  store: IdempotencyStore,
  context: IdempotencyContext,
  compute: () => Promise<IdempotencyRecord>,
  options: WithIdempotencyOptions = {},
): Promise<IdempotencyRecord> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const pollWindowMs = options.pollWindowMs ?? DEFAULT_POLL_WINDOW_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const renewIntervalMs = options.renewIntervalMs ?? Math.max(1, Math.floor(leaseMs / DEFAULT_RENEW_INTERVAL_FRACTION));
  if (!Number.isFinite(renewIntervalMs) || renewIntervalMs <= 0 || renewIntervalMs >= leaseMs) {
    throw new Error(`withIdempotency: renewIntervalMs (${renewIntervalMs}) must be a finite positive number less than leaseMs (${leaseMs})`);
  }
  const onDemoted = options.onDemoted ?? defaultOnDemoted;
  const onRenewalError = options.onRenewalError ?? defaultOnRenewalError;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  const deadline = now() + pollWindowMs;
  for (;;) {
    const outcome = await store.claim(context.key, context.fingerprint, { leaseMs, now: now() });

    if (outcome.kind === 'mismatch') throw new IdempotencyKeyReusedError(context.key);
    if (outcome.kind === 'record') return outcome.record;

    if (outcome.kind === 'claimed') {
      const ownerToken = outcome.ownerToken;
      // Keeps this leader's claim alive for as long as `compute()` genuinely runs, so a slow
      // provisioner call outliving `leaseMs` isn't mistaken for an abandoned one (#287). Runs
      // concurrently with `compute()` below, stopped unconditionally once it settles either way.
      let settled = false;
      let demoted = false;
      // Aborts the renewal loop's in-flight wait the instant `compute()` settles, rather than
      // leaving that wait's timer to fire on its own up to `renewIntervalMs` later (#289 review).
      const renewalAbort = new AbortController();
      const renewalLoop = async (): Promise<void> => {
        for (;;) {
          await sleep(renewIntervalMs, renewalAbort.signal);
          if (settled) return;
          const renewed = await store.renew(context.key, ownerToken, { leaseMs, now: now() });
          if (settled) return;
          if (!renewed && !demoted) {
            // Demoted: someone else already reclaimed or completed this claim. `compute()` can't
            // be cancelled from here, so it keeps running - `complete` below is a no-op against
            // the stale `ownerToken`, so this attempt's result can never clobber the newer
            // leader's. This is just the loud operational signal that happened at all.
            demoted = true;
            onDemoted({ key: context.key });
            return;
          }
        }
      };
      void renewalLoop().catch((error: unknown) => {
        if (settled) return;
        // Guards against a sync throw *and* a rejection from an injected async callback (its
        // return type is `void`, but nothing stops a caller from passing an `async` function
        // there) - either way must not resurrect the unhandled-rejection this boundary exists to
        // prevent (#289 review).
        try {
          void Promise.resolve(onRenewalError({ key: context.key, error })).catch(() => {});
        } catch {
          // Swallowed for the same reason.
        }
      });

      let record: IdempotencyRecord;
      try {
        record = await compute();
      } catch (error) {
        settled = true;
        renewalAbort.abort();
        await store.release(context.key, ownerToken);
        throw error;
      }
      settled = true;
      renewalAbort.abort();
      await store.complete(context.key, ownerToken, record);
      return record;
    }

    // `outcome.kind === 'pending'`: still genuinely in flight elsewhere.
    if (now() >= deadline) {
      const retryAfterSeconds = Math.max(1, Math.ceil(outcome.retryAfterMs / 1000));
      throw new IdempotencyStillProcessingError(context.key, retryAfterSeconds);
    }
    await sleep(pollIntervalMs);
  }
}

/** Fastify `preHandler`: every mutating request must carry the idempotency key header before
 * the route handler runs at all, rather than each handler remembering to check it. */
export function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (!mutatingMethods.has(request.method)) {
    done();
    return;
  }
  const key = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
  if (!key || Array.isArray(key)) {
    reply.code(400).send(problem(400, 'Missing Idempotency-Key', `Every ${request.method} request must carry a unique ${IDEMPOTENCY_KEY_HEADER} header.`));
    return;
  }
  request.idempotencyKey = key;
  done();
}

/** Every mutating route handler needs the key `requireIdempotencyKey` already validated is
 * present, to pass into `withIdempotency` - one accessor instead of each call site re-asserting
 * `request.idempotencyKey as string`. Throwing (rather than returning `undefined`) reflects that
 * reaching a route handler for a mutating method without this hook having run first is a wiring
 * bug in this app, not a client error to report as a 4xx. */
export function idempotencyKeyOf(request: FastifyRequest): string {
  if (!request.idempotencyKey) {
    throw new Error('request.idempotencyKey is unset - did requireIdempotencyKey run as a preHandler?');
  }
  return request.idempotencyKey;
}
