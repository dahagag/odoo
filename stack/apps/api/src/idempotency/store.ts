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

    // The existing claim is `pending` and its lease has expired: reclaim it, conditioned on
    // nobody having mutated it since we read it (ADR-0020's owner-token-conditional pattern,
    // applied to an idempotency claim instead of a Trial Org's execution lock).
    if (this.claims.get(key) !== existing) return this.claim(key, fingerprint, options);
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
}

/** Idempotency claims share the org record store's single table (#195's Implementation
 * Decisions: single-table design) under `pk = idempotency#<key>` - a distinct item type in the
 * same table, not a table of its own. DynamoDB's native `ttl` attribute is set on every item as
 * a storage-cost backstop only (ADR-0020's role for its own lock's TTL), never as the mechanism
 * that makes reclaim or expiry correct - that's the application-level `expiresAt` check above,
 * performed on the request path, since native TTL sweeps are asynchronous and not immediate. */
export class DynamoIdempotencyStore implements IdempotencyStore {
  /** How long a `succeeded` claim's record stays replayable before it becomes eligible for
   * DynamoDB's TTL sweep - long enough to cover a legitimate client retry well after the
   * original call finished, short enough not to grow the table unbounded. An implementation
   * parameter (this ticket's Further Notes), not an architectural one. */
  private static readonly SUCCEEDED_RETENTION_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly gateway: AwsGateway, private readonly table = 'orgs') {}

  async claim(key: string, fingerprint: string, options: ClaimOptions): Promise<ClaimOutcome> {
    const ownerToken = randomUUID();
    const expiresAt = options.now + options.leaseMs;
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
    if (!existing) return this.claim(key, fingerprint, options); // raced a release/expiry; retry once.

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
          ttl: Math.floor((Date.now() + DynamoIdempotencyStore.SUCCEEDED_RETENTION_MS) / 1000),
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

  private pendingItem(key: string, fingerprint: string, ownerToken: string, expiresAt: number): Record<string, unknown> {
    return {
      pk: this.itemKey(key),
      claimStatus: 'pending',
      fingerprint,
      ownerToken,
      expiresAt,
      ttl: Math.floor(expiresAt / 1000),
    };
  }

  private async getClaim(key: string): Promise<StoredClaim | undefined> {
    const item = await this.gateway.dynamoDb.getItem({ table: this.table, key: { pk: this.itemKey(key) } });
    if (!item) return undefined;
    return {
      status: item.claimStatus as 'pending' | 'succeeded',
      fingerprint: item.fingerprint as string,
      ownerToken: item.ownerToken as string,
      expiresAt: item.expiresAt as number,
      record: item.claimStatus === 'succeeded' ? { status: item.statusCode as number, body: JSON.parse(item.body as string) } : undefined,
    };
  }

  private itemKey(key: string): string {
    return `idempotency#${key}`;
  }
}
