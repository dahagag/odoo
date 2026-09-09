import type { FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_KEY_HEADER } from '@stack/domain';
import type { IdempotencyRecord, IdempotencyStore } from './store';

/** Every state-changing endpoint calls this instead of writing its response directly (this
 * ticket's Implementation Decisions: "every state-changing endpoint takes an idempotency key").
 *
 * Guards a sequential retry of the same request (the same key arrives again after the first
 * call already completed and stored its result) - `store.putIfAbsent`'s conditional write is
 * what makes that case exactly-once. Two calls that race in true parallel with the same
 * never-seen-before key can both pass the fast-path `get` and both run `compute`; closing that
 * window needs writing "in-flight" state atomically with starting the downstream job, the way
 * `AwsProvisioner._apply_transition` does today (docs/adr/0019) - a lifecycle-specific
 * responsibility later tickets add on top of this seam, not a gap in `putIfAbsent` itself. */
export async function withIdempotency(
  store: IdempotencyStore,
  key: string,
  compute: () => Promise<IdempotencyRecord>,
): Promise<IdempotencyRecord> {
  const existing = await store.get(key);
  if (existing) return existing;
  const result = await compute();
  return store.putIfAbsent(key, result);
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
    reply.code(400).send({
      type: 'about:blank',
      title: 'Missing Idempotency-Key',
      status: 400,
      detail: `Every ${request.method} request must carry a unique ${IDEMPOTENCY_KEY_HEADER} header.`,
    });
    return;
  }
  (request as FastifyRequest & { idempotencyKey: string }).idempotencyKey = key;
  done();
}
