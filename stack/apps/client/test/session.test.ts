import { describe, expect, it, vi } from 'vitest';
import { clearSession } from '../src/lib/session';

describe('session', () => {
  it('clearSession sets the session state to undefined via the given setter', () => {
    const setSession = vi.fn();

    clearSession(setSession);

    expect(setSession).toHaveBeenCalledWith(undefined);
  });
});
