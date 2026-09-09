import { InMemoryAwsGateway } from '@stack/aws-gateway';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireIdempotencyKey, withIdempotency } from '../src/idempotency/middleware';
import { DynamoIdempotencyStore, InMemoryIdempotencyStore } from '../src/idempotency/store';

/**
 * `server.ts` has no state-changing endpoint yet - this ticket ships no business logic (see
 * Out of Scope) - so the idempotency seam is exercised here against a minimal Fastify instance
 * built just for this test, the same way later tickets will wire a real mutating endpoint.
 */
function buildIdempotentTestApp(effect: () => void) {
  const store = new InMemoryIdempotencyStore();
  const app = Fastify({ logger: false });
  app.addHook('preHandler', requireIdempotencyKey);
  app.post('/demo/issue', async (request) => {
    const key = (request as typeof request & { idempotencyKey: string }).idempotencyKey;
    const record = await withIdempotency(store, key, async () => {
      effect();
      return { status: 201, body: { started: true } };
    });
    return record.body;
  });
  return app;
}

describe('idempotency (this ticket\'s Implementation/Testing Decisions)', () => {
  it('rejects a mutating request with no Idempotency-Key header', async () => {
    const app = buildIdempotentTestApp(() => {});
    const response = await app.inject({ method: 'POST', url: '/demo/issue', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('the same key twice produces one effect', async () => {
    let effectCount = 0;
    const app = buildIdempotentTestApp(() => { effectCount += 1; });

    const first = await app.inject({
      method: 'POST',
      url: '/demo/issue',
      headers: { 'idempotency-key': 'job-1' },
      payload: {},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/demo/issue',
      headers: { 'idempotency-key': 'job-1' },
      payload: {},
    });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(effectCount).toBe(1);
  });

  it('a different key produces a second effect', async () => {
    let effectCount = 0;
    const app = buildIdempotentTestApp(() => { effectCount += 1; });

    await app.inject({ method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'job-1' }, payload: {} });
    await app.inject({ method: 'POST', url: '/demo/issue', headers: { 'idempotency-key': 'job-2' }, payload: {} });

    expect(effectCount).toBe(2);
  });
});

describe('DynamoIdempotencyStore', () => {
  it('putIfAbsent stores once and returns the same record on a repeat key', async () => {
    const gateway = new InMemoryAwsGateway();
    const store = new DynamoIdempotencyStore(gateway);

    const first = await store.putIfAbsent('job-1', { status: 201, body: { started: true } });
    const second = await store.putIfAbsent('job-1', { status: 201, body: { started: 'this should never be stored' } });

    expect(second).toEqual(first);
    await expect(store.get('job-1')).resolves.toEqual(first);
  });
});
