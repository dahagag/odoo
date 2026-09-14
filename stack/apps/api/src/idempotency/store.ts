import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { ConditionalCheckFailedError, TransactionCanceledError } from '@stack/aws-gateway';

export interface IdempotencyRecord {
  status: number;
  body: unknown;
}

/** A completed claim's own record has been reached again under the same key + fingerprint - the
 * caller should replay it verbatim rather than running `compute` again. */
export interface ClaimRecord {
  kind: 'record';
  record: IdempotencyRecord;
}

/** This call becomes the leader for `key`: nobody else holds an unexpired claim on it (or the
 * one that did is now stale and this call just reclaimed it). The leader must eventually call
 * `complete` (on success) or `release` (on failure) with the same `ownerToken`, or the claim
 * outlives its own lease and a later caller reclaims it instead. */
export interface ClaimLeader {
  kind: 'claimed';
  ownerToken: string;
}

/** Someone else holds an unexpired claim on `key` with a matching fingerprint - genuinely still
 * in flight. `retryAfterMs` is this store's best estimate of how long until that claim's lease
 * expires (informational only; a caller polling faster than that just sees `pending` again). */
export interface ClaimPending {
  kind: 'pending';
  retryAfterMs: number;
}

/** `key` already has a claim or record whose stored fingerprint differs from the one this call
 * computed - the client reused an `Idempotency-Key` across two different requests. */
export interface ClaimMismatch {
  kind: 'mismatch';
}

export type ClaimOutcome = ClaimRecord | ClaimLeader | ClaimPending | ClaimMismatch;

export interface ClaimOptions {
  /** How long this call's claim is valid for before another caller may treat it as abandoned
   * and reclaim it (this ticket's Implementation Decisions: "long enough to cover a real
   * `compute()` call ... short enough that an abandoned claim doesn't wedge a key for an
   * operationally meaningful amount of time"). */
  leaseMs: number;
  /** Injected rather than read from `Date.now()` internally, so a test can drive expiry/reclaim
   * deterministically without waiting on a real clock (this ticket's Testing Decisions: "the
   * stale-claim reclaim test... by injecting a controllable clock"). */
  now: number;
}

/**
 * A claim/lease state machine in front of the idempotency record store (#285's Implementation
 * Decisions), replacing the plain `get`/`putIfAbsent` shape #195 shipped with the gap it
 * explicitly deferred: "closing that window needs writing 'in-flight' state atomically with
 * starting the downstream job."
 *
 * `withIdempotency` (`middleware.ts`) is the only caller; it owns the state-machine *policy*
 * (replay vs. wait vs. reclaim vs. reject). This interface only owns the *mechanism*: an atomic
 * claim, and the two ways a leader resolves one.
 */
export interface IdempotencyStore {
  /** Attempts to become the leader for `key` + `fingerprint`. */
  claim(key: string, fingerprint: string, options: ClaimOptions): Promise<ClaimOutcome>;
  /** The leader identified by `ownerToken` finished `compute()` successfully: stores `record`
   * and transitions the claim to `succeeded`. A no-op if this attempt no longer owns the claim
   * (it was already reclaimed as stale) - the caller still returns `record` to its own client;
   * this just avoids clobbering whatever a newer attempt has since written. */
  complete(key: string, ownerToken: string, record: IdempotencyRecord): Promise<void>;
  /** The leader identified by `ownerToken` had `compute()` throw: releases the claim so a
   * same-key retry gets a fresh attempt rather than a stuck or memoized failure (this ticket's
   * User Stories, #12) - preserving #195's existing behavior that a thrown error is never
   * memoized. Also a no-op if this attempt no longer owns the claim. */
  release(key: string, ownerToken: string): Promise<void>;
  /** Extends the leader identified by `ownerToken`'s lease while `compute()` is still genuinely
   * running (#287), owner-token-conditional exactly like `complete`/`release`: a stale attempt
   * whose claim was already reclaimed or completed can never resurrect it, because `complete`
   * and a reclaim both mint a fresh `ownerToken`, so the old one no longer matches. Returns
   * whether the lease was actually extended - `false` means this caller has been demoted and
   * should stop renewing (`withIdempotency` owns what that means for the in-flight `compute()`
   * call, this method only reports the fact). */
  renew(key: string, ownerToken: string, options: ClaimOptions): Promise<boolean>;
}

interface StoredClaim {
  status: 'pending' | 'succeeded';
  fingerprint: string;
  ownerToken: string;
  expiresAt: number;
  record?: IdempotencyRecord;
}

function claimOutcomeFor(existing: StoredClaim, fingerprint: string, now: number): ClaimRecord | ClaimPending | ClaimMismatch | undefined {
  if (existing.fingerprint !== fingerprint) return { kind: 'mismatch' };
  if (existing.status === 'succeeded') return { kind: 'record', record: existing.record! };
  if (existing.expiresAt > now) return { kind: 'pending', retryAfterMs: existing.expiresAt - now };
  return undefined;
}

/** Local/dev/test-only store - a single process's plain Map, not durable and not shared across
 * instances. `DynamoIdempotencyStore` is what actually runs against AWS; both implement the
 * same claim/lease contract so tests written against this one are trustworthy evidence for the
 * real store's behavior (this ticket's User Stories, #10). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly claims = new Map<string, StoredClaim>();

  async claim(key: string, fingerprint: string, options: ClaimOptions): Promise<ClaimOutcome> {
    const existing = this.claims.get(key);
    if (!existing) {
      const ownerToken = randomUUID();
      this.claims.set(key, { status: 'pending', fingerprint, ownerToken, expiresAt: options.now + options.leaseMs });
      return { kind: 'claimed', ownerToken };
    }

    const outcome = claimOutcomeFor(existing, fingerprint, options.now);
    if (outcome) return outcome;

    // The existing claim is `pending` and its lease has expired: reclaim it (ADR-0020's
    // owner-token-conditional pattern, applied to an idempotency claim instead of a Trial Org's
    // execution lock). No re-check against a concurrent mutation is needed here the way
    // `DynamoIdempotencyStore.claim` needs one: this whole method body runs synchronously
    // end to end (no `await` above this line), so nothing else can have touched `this.claims`
    // between the `get` at the top of this call and this write.
    const ownerToken = randomUUID();
    this.claims.set(key, { status: 'pending', fingerprint, ownerToken, expiresAt: options.now + options.leaseMs });
    return { kind: 'claimed', ownerToken };
  }

  async complete(key: string, ownerToken: string, record: IdempotencyRecord): Promise<void> {
    const existing = this.claims.get(key);
    if (!existing || existing.ownerToken !== ownerToken) return;
    this.claims.set(key, { ...existing, status: 'succeeded', record, ownerToken: randomUUID() });
  }

  async release(key: string, ownerToken: string): Promise<void> {
    const existing = this.claims.get(key);
    if (!existing || existing.ownerToken !== ownerToken) return;
    this.claims.delete(key);
  }

  async renew(key: string, ownerToken: string, options: ClaimOptions): Promise<boolean> {
    const existing = this.claims.get(key);
    if (!existing || existing.ownerToken !== ownerToken) return false;
    this.claims.set(key, { ...existing, expiresAt: options.now + options.leaseMs });
    return true;
  }
}

/** Idempotency claims share the org record store's single table (#195's Implementation
 * Decisions: single-table design) under `pk = idempotency#<key>` - a distinct item type in the
 * same table, not a table of its own. DynamoDB's native `ttl` attribute is set on every item as
 * a storage-cost backstop only (ADR-0020's role for its own lock's TTL), never as the mechanism
 * that makes reclaim or expiry correct - that's the application-level `expiresAt` check above,
 * performed on the request path, since native TTL sweeps are asynchronous and not immediate. */
export class DynamoIdempotencyStore implements IdempotencyStore {
  /** How far out the storage-cost-backstop `ttl` attribute is set, on both a `pending` and a
   * `succeeded` item alike - "a few hours out", the same order of magnitude ADR-0020 picks for
   * its own lock item's TTL, not a distinct data-retention policy for idempotency records (this
   * store never relied on TTL for correctness before this ticket, and still doesn't - see the
   * class doc above). An implementation parameter (this ticket's Further Notes), not an
   * architectural one. */
  private static readonly TTL_BACKSTOP_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly gateway: AwsGateway, private readonly table = 'orgs') {}

  /** Bounds the "raced a release/expiry between our failed `putItem` and our follow-up `get`"
   * retry below - a handful of attempts is enough to ride out a genuine race without risking
   * unbounded recursion under sustained contention; if every attempt loses, `withIdempotency`'s
   * own poll loop (`middleware.ts`) tries again on its next tick regardless. */
  private static readonly MAX_CLAIM_ATTEMPTS = 5;

  async claim(key: string, fingerprint: string, options: ClaimOptions): Promise<ClaimOutcome> {
    const expiresAt = options.now + options.leaseMs;

    for (let attempt = 0; attempt < DynamoIdempotencyStore.MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const ownerToken = randomUUID();
      try {
        await this.gateway.dynamoDb.putItem({
          table: this.table,
          item: this.pendingItem(key, fingerprint, ownerToken, expiresAt),
          condition: { type: 'attribute_not_exists', attribute: 'pk' },
        });
        return { kind: 'claimed', ownerToken };
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedError)) throw error;
      }

      const existing = await this.getClaim(key);
      if (!existing) continue; // raced a release/expiry between our failed putItem and this get; retry.

      const outcome = claimOutcomeFor(existing, fingerprint, options.now);
      if (outcome) return outcome;

      // Stale claim: reclaim via a compare-and-swap on the owner token we just read. Every write
      // this store makes (claim, reclaim, complete) mints a fresh `ownerToken`, so this condition
      // also implicitly guards against the original leader completing between our `get` and this
      // `putItem` - if it did, the stored token no longer matches and this CAS fails too.
      try {
        await this.gateway.dynamoDb.putItem({
          table: this.table,
          item: this.pendingItem(key, fingerprint, ownerToken, expiresAt),
          condition: { type: 'attribute_equals', attribute: 'ownerToken', value: existing.ownerToken },
        });
        return { kind: 'claimed', ownerToken };
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedError)) throw error;
        // Someone else reclaimed or completed it first; the caller (`withIdempotency`) polls again.
        return { kind: 'pending', retryAfterMs: 0 };
      }
    }

    // Lost every attempt to sustained contention on the same key - let the caller's own poll
    // loop retry rather than recursing further.
    return { kind: 'pending', retryAfterMs: 0 };
  }

  async complete(key: string, ownerToken: string, record: IdempotencyRecord): Promise<void> {
    try {
      await this.gateway.dynamoDb.updateItem({
        table: this.table,
        key: { pk: this.itemKey(key) },
        set: {
          claimStatus: 'succeeded',
          statusCode: record.status,
          body: JSON.stringify(record.body),
          ownerToken: randomUUID(),
          ttl: Math.floor((Date.now() + DynamoIdempotencyStore.TTL_BACKSTOP_MS) / 1000),
        },
        condition: { type: 'attribute_equals', attribute: 'ownerToken', value: ownerToken },
      });
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedError)) throw error;
      // No longer own the claim (reclaimed as stale) - don't clobber whatever's stored now.
    }
  }

  async release(key: string, ownerToken: string): Promise<void> {
    try {
      await this.gateway.dynamoDb.transactWrite({
        items: [
          {
            delete: {
              table: this.table,
              key: { pk: this.itemKey(key) },
              condition: { type: 'attribute_equals', attribute: 'ownerToken', value: ownerToken },
            },
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof TransactionCanceledError)) throw error;
      // Already reclaimed or gone - nothing to release.
    }
  }

  async renew(key: string, ownerToken: string, options: ClaimOptions): Promise<boolean> {
    try {
      await this.gateway.dynamoDb.updateItem({
        table: this.table,
        key: { pk: this.itemKey(key) },
        set: {
          expiresAt: options.now + options.leaseMs,
          ttl: Math.floor((Date.now() + DynamoIdempotencyStore.TTL_BACKSTOP_MS) / 1000),
        },
        condition: { type: 'attribute_equals', attribute: 'ownerToken', value: ownerToken },
      });
      return true;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedError)) throw error;
      // Already reclaimed or completed (both mint a fresh ownerToken) - this caller is demoted.
      return false;
    }
  }

  private pendingItem(key: string, fingerprint: string, ownerToken: string, expiresAt: number): Record<string, unknown> {
    return {
      pk: this.itemKey(key),
      claimStatus: 'pending',
      fingerprint,
      ownerToken,
      expiresAt,
      ttl: Math.floor((Date.now() + DynamoIdempotencyStore.TTL_BACKSTOP_MS) / 1000),
    };
  }

  /** `claimOutcomeFor` treats anything other than `'succeeded'` as `'pending'`, so an
   * unrecognized `claimStatus` would otherwise silently fall through to the reclaim path once
   * `expiresAt` passes - fail closed here instead of ever handing back a status this store
   * doesn't know how to interpret. */
  private static readonly KNOWN_CLAIM_STATUSES = new Set(['pending', 'succeeded']);

  private async getClaim(key: string): Promise<StoredClaim | undefined> {
    const item = await this.gateway.dynamoDb.getItem({ table: this.table, key: { pk: this.itemKey(key) } });
    if (!item) return undefined;
    const status = item.claimStatus as string;
    if (!DynamoIdempotencyStore.KNOWN_CLAIM_STATUSES.has(status)) {
      throw new Error(`idempotency store: unrecognized claimStatus '${status}' for key ${key}`);
    }
    return {
      status: status as 'pending' | 'succeeded',
      fingerprint: item.fingerprint as string,
      ownerToken: item.ownerToken as string,
      expiresAt: item.expiresAt as number,
      record: status === 'succeeded' ? { status: item.statusCode as number, body: JSON.parse(item.body as string) } : undefined,
    };
  }

  private itemKey(key: string): string {
    return `idempotency#${key}`;
  }
}
