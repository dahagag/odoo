import { InMemoryAwsGateway } from '@stack/aws-gateway';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { IdempotencyKeyReusedError, IdempotencyStillProcessingError } from '../src/idempotency/errors';
import { idempotencyContext, requireIdempotencyKey, withIdempotency } from '../src/idempotency/middleware';
import { DynamoIdempotencyStore, InMemoryIdempotencyStore, type IdempotencyStore } from '../src/idempotency/store';

/** Both implementations of the claim/lease contract must behave identically (#285's User
 * Stories, #10) - every store-level test in this file runs against both. */
const STORES: [string, () => IdempotencyStore][] = [
  ['InMemoryIdempotencyStore', () => new InMemoryIdempotencyStore()],
  ['DynamoIdempotencyStore', () => new DynamoIdempotencyStore(new InMemoryAwsGateway())],
];

describe('requireIdempotencyKey (#195)', () => {
  it('rejects a mutating request with no Idempotency-Key header', async () => {
    const app = Fastify({ logger: false });
    app.addHook('preHandler', requireIdempotencyKey);
    app.post('/demo/issue', async () => ({ ok: true }));

    const response = await app.inject({ method: 'POST', url: '/demo/issue', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe.each(STORES)('%s claim/lease contract (#285)', (_name, buildStore) => {
  it('a fresh key claims immediately', async () => {
    const store = buildStore();
    const outcome = await store.claim('key-1', 'fp-1', { leaseMs: 1000, now: 0 });
    expect(outcome.kind).toBe('claimed');
  });

  it('a second claim on the same still-pending key+fingerprint waits rather than re-claims', async () => {
    const store = buildStore();
    await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 0 });

    const second = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 100 });

    expect(second.kind).toBe('pending');
  });

  it('a claim with a different fingerprint on the same key is a mismatch, pending or succeeded', async () => {
    const store = buildStore();
    await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 0 });

    const pendingMismatch = await store.claim('key-1', 'fp-2', { leaseMs: 10_000, now: 100 });
    expect(pendingMismatch.kind).toBe('mismatch');

    const leader = await store.claim('key-2', 'fp-1', { leaseMs: 10_000, now: 0 });
    if (leader.kind !== 'claimed') throw new Error('expected to already be leader');
    await store.complete('key-2', leader.ownerToken, { status: 200, body: { done: true } });

    const succeededMismatch = await store.claim('key-2', 'fp-2', { leaseMs: 10_000, now: 200 });
    expect(succeededMismatch.kind).toBe('mismatch');
  });

  it('claiming again with the same fingerprint after completion replays the stored record', async () => {
    const store = buildStore();
    const leader = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 0 });
    if (leader.kind !== 'claimed') throw new Error('expected to be leader');
    await store.complete('key-1', leader.ownerToken, { status: 201, body: { orgId: 'org-1' } });

    const outcome = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 500 });

    expect(outcome).toEqual({ kind: 'record', record: { status: 201, body: { orgId: 'org-1' } } });
  });

  it('an expired pending claim is reclaimed by the next caller, not replayed as still-pending', async () => {
    const store = buildStore();
    const first = await store.claim('key-1', 'fp-1', { leaseMs: 50, now: 0 });
    if (first.kind !== 'claimed') throw new Error('expected to be leader');

    const reclaimed = await store.claim('key-1', 'fp-1', { leaseMs: 50, now: 10_000 });

    expect(reclaimed.kind).toBe('claimed');
    if (reclaimed.kind === 'claimed') expect(reclaimed.ownerToken).not.toBe(first.ownerToken);
  });

  it('a released claim lets a fresh attempt claim the same key again', async () => {
    const store = buildStore();
    const first = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 0 });
    if (first.kind !== 'claimed') throw new Error('expected to be leader');
    await store.release('key-1', first.ownerToken);

    const second = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 10 });

    expect(second.kind).toBe('claimed');
  });

  it('completing with a stale owner token (already reclaimed) does not clobber the newer claim', async () => {
    const store = buildStore();
    const first = await store.claim('key-1', 'fp-1', { leaseMs: 50, now: 0 });
    if (first.kind !== 'claimed') throw new Error('expected to be leader');
    const reclaimed = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 10_000 });
    if (reclaimed.kind !== 'claimed') throw new Error('expected the reclaim to succeed');

    // The original (now-abandoned) leader finishes late and tries to complete with its stale token.
    await store.complete('key-1', first.ownerToken, { status: 200, body: { from: 'stale leader' } });

    const stillPending = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 10_050 });
    expect(stillPending.kind).toBe('pending');
  });

  it('releasing with a stale owner token is a no-op', async () => {
    const store = buildStore();
    const first = await store.claim('key-1', 'fp-1', { leaseMs: 50, now: 0 });
    if (first.kind !== 'claimed') throw new Error('expected to be leader');
    const reclaimed = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 10_000 });
    if (reclaimed.kind !== 'claimed') throw new Error('expected the reclaim to succeed');

    await store.release('key-1', first.ownerToken);

    const outcome = await store.claim('key-1', 'fp-1', { leaseMs: 10_000, now: 10_050 });
    expect(outcome.kind).toBe('pending');
  });
});

describe.each(STORES)('%s via withIdempotency (#285)', (_name, buildStore) => {
  it('two genuinely concurrent calls with the same brand-new key produce exactly one effect and identical responses', async () => {
    const store = buildStore();
    let effectCount = 0;
    const compute = async () => {
      effectCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: 201, body: { orgId: 'org-1', effectCount } };
    };

    const results = await Promise.all([
      withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute),
      withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute),
    ]);

    expect(effectCount).toBe(1);
    expect(results[0]).toEqual(results[1]);
  });

  it('a thrown compute() releases the claim so a same-key retry gets a fresh attempt', async () => {
    const store = buildStore();
    let attempt = 0;
    const compute = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('provisioner blew up');
      return { status: 200, body: { attempt } };
    };

    await expect(withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute)).rejects.toThrow('provisioner blew up');
    const result = await withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute);

    expect(result).toEqual({ status: 200, body: { attempt: 2 } });
    expect(attempt).toBe(2);
  });

  it('a same-key, same-fingerprint retry after success still replays cleanly', async () => {
    const store = buildStore();
    let effectCount = 0;
    const compute = async () => {
      effectCount += 1;
      return { status: 201, body: { effectCount } };
    };

    const first = await withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute);
    const second = await withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, compute);

    expect(second).toEqual(first);
    expect(effectCount).toBe(1);
  });

  it('a reused key against a materially different request body is rejected with a distinct error', async () => {
    const store = buildStore();
    await withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-1' }, async () => ({ status: 201, body: {} }));

    await expect(
      withIdempotency(store, { key: 'scoped-1', fingerprint: 'fp-2' }, async () => ({ status: 201, body: {} })),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('a concurrent caller replays the leader\'s result once it resolves within the poll window', async () => {
    const store = buildStore();
    const leader = await store.claim('scoped-1', 'fp-1', { leaseMs: 10_000, now: Date.now() });
    if (leader.kind !== 'claimed') throw new Error('expected to be leader');

    setTimeout(() => {
      void store.complete('scoped-1', leader.ownerToken, { status: 200, body: { from: 'leader' } });
    }, 20);

    const follower = await withIdempotency(
      store,
      { key: 'scoped-1', fingerprint: 'fp-1' },
      async () => { throw new Error('follower must never compute - the leader already owns this claim'); },
      { pollWindowMs: 500, pollIntervalMs: 10 },
    );

    expect(follower).toEqual({ status: 200, body: { from: 'leader' } });
  });

  it('a concurrent caller fails fast with a retryable status once the leader outlives the poll window', async () => {
    const store = buildStore();
    const leader = await store.claim('scoped-1', 'fp-1', { leaseMs: 10_000, now: Date.now() });
    if (leader.kind !== 'claimed') throw new Error('expected to be leader');
    // Leader never completes or releases within this test - simulates a still-genuinely-in-flight call.

    await expect(
      withIdempotency(
        store,
        { key: 'scoped-1', fingerprint: 'fp-1' },
        async () => { throw new Error('follower must never compute'); },
        { pollWindowMs: 40, pollIntervalMs: 10 },
      ),
    ).rejects.toBeInstanceOf(IdempotencyStillProcessingError);
  });

  it('a stale abandoned claim is reclaimed and run exactly once by the next caller', async () => {
    const store = buildStore();
    const abandoned = await store.claim('scoped-1', 'fp-1', { leaseMs: 10, now: 0 });
    if (abandoned.kind !== 'claimed') throw new Error('expected to be leader');
    // Never completed or released - simulates the owning process crashing mid-compute().

    let effectCount = 0;
    const result = await withIdempotency(
      store,
      { key: 'scoped-1', fingerprint: 'fp-1' },
      async () => { effectCount += 1; return { status: 200, body: { effectCount } }; },
      { now: () => 10_000, leaseMs: 10_000, pollWindowMs: 200, pollIntervalMs: 10 },
    );

    expect(effectCount).toBe(1);
    expect(result).toEqual({ status: 200, body: { effectCount: 1 } });
  });
});

describe('idempotencyContext scoping (#285)', () => {
  it('the same raw key against two different routes produces two independent effects, not a replay', async () => {
    const store = new InMemoryIdempotencyStore();
    const app = Fastify({ logger: false });
    app.addHook('preHandler', (request, _reply, done) => {
      request.adminPrincipal = { arn: 'arn:aws:iam::000000000000:role/admin' };
      done();
    });
    app.addHook('preHandler', requireIdempotencyKey);

    let effectCount = 0;
    for (const label of ['issue', 'suspend']) {
      app.post(`/demo/${label}`, async (request) => {
        const context = idempotencyContext(request);
        const record = await withIdempotency(store, context, async () => {
          effectCount += 1;
          return { status: 200, body: { effectCount } };
        });
        return record.body;
      });
    }

    await app.inject({ method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'shared-key' }, payload: {} });
    await app.inject({ method: 'POST', url: '/demo/suspend', headers: { 'idempotency-key': 'shared-key' }, payload: {} });

    expect(effectCount).toBe(2);
  });

  it('the same raw key against two different principals produces two independent effects, not a replay', async () => {
    const store = new InMemoryIdempotencyStore();
    const app = Fastify({ logger: false });
    app.addHook('preHandler', (request, _reply, done) => {
      const principal = request.headers['x-stack-admin-principal'];
      request.adminPrincipal = { arn: typeof principal === 'string' ? principal : 'unknown' };
      done();
    });
    app.addHook('preHandler', requireIdempotencyKey);

    let effectCount = 0;
    app.post('/demo/issue', async (request) => {
      const context = idempotencyContext(request);
      const record = await withIdempotency(store, context, async () => {
        effectCount += 1;
        return { status: 200, body: { effectCount } };
      });
      return record.body;
    });

    await app.inject({
      method: 'POST',
      url: '/demo/issue',
      headers: { 'idempotency-key': 'shared-key', 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/alice' },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: '/demo/issue',
      headers: { 'idempotency-key': 'shared-key', 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/bob' },
      payload: {},
    });

    expect(effectCount).toBe(2);
  });

  it('the same route, principal, and key still replays for an identical body, and rejects a different one', async () => {
    const store = new InMemoryIdempotencyStore();
    const app = Fastify({ logger: false });
    app.addHook('preHandler', (request, _reply, done) => {
      request.adminPrincipal = { arn: 'arn:aws:iam::000000000000:role/admin' };
      done();
    });
    app.addHook('preHandler', requireIdempotencyKey);

    let effectCount = 0;
    app.post('/demo/issue', async (request, reply) => {
      const context = idempotencyContext(request);
      try {
        const record = await withIdempotency(store, context, async () => {
          effectCount += 1;
          return { status: 200, body: { effectCount } };
        });
        return record.body;
      } catch (error) {
        if (error instanceof IdempotencyKeyReusedError) {
          reply.code(409);
          return { title: error.message };
        }
        throw error;
      }
    });

    const first = await app.inject({
      method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'k' }, payload: { seats: 5 },
    });
    const replay = await app.inject({
      method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'k' }, payload: { seats: 5 },
    });
    const mismatch = await app.inject({
      method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'k' }, payload: { seats: 99 },
    });

    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(mismatch.statusCode).toBe(409);
    expect(effectCount).toBe(1);
  });
});
