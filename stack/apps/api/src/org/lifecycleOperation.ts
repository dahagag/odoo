import { createHash } from 'node:crypto';
import type { IdempotencyContext } from '../idempotency/middleware';

/**
 * The durable identity of one client-requested lifecycle operation. It is deliberately distinct
 * from an idempotency claim owner token: a claim can be reclaimed, while this value must remain
 * unchanged for every attempt at the same logical request.
 */
export interface LifecycleOperation {
  id: string;
}

/**
 * Derives a compact, opaque operation identifier which is safe in both a Step Functions
 * execution name and the ECS `ClientToken` that appends a retry-count suffix. The versioned
 * domain separator prevents accidental reuse should another subsystem later derive IDs from the
 * same idempotency context.
 */
export function lifecycleOperationFor(context: IdempotencyContext): LifecycleOperation {
  const digest = createHash('sha256')
    .update('lifecycle-operation/v1\0')
    .update(context.key)
    .update('\0')
    .update(context.fingerprint)
    .digest('base64url');
  return { id: `lop_${digest}` };
}
