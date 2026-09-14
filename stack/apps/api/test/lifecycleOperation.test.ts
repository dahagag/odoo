import { describe, expect, it } from 'vitest';
import { lifecycleOperationFor } from '../src/org/lifecycleOperation';

describe('lifecycleOperationFor', () => {
  it('is stable for a reclaimed idempotency context and changes for a different operation', () => {
    const first = lifecycleOperationFor({ key: 'request-123', fingerprint: 'canonical-request-a' });

    expect(lifecycleOperationFor({ key: 'request-123', fingerprint: 'canonical-request-a' }))
      .toEqual(first);
    expect(lifecycleOperationFor({ key: 'request-124', fingerprint: 'canonical-request-a' }).id)
      .not.toBe(first.id);
    expect(lifecycleOperationFor({ key: 'request-123', fingerprint: 'canonical-request-b' }).id)
      .not.toBe(first.id);
    expect(first.id).toMatch(/^lop_[A-Za-z0-9_-]{43}$/);
  });
});
