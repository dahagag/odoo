import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from '../src/lib/session';

beforeEach(() => {
  localStorage.clear();
});

describe('session', () => {
  it('round-trips a saved session', () => {
    saveSession({ orgId: 'org-1', orgToken: 'token-1' });
    expect(loadSession()).toEqual({ orgId: 'org-1', orgToken: 'token-1' });
  });

  it('loadSession returns undefined when nothing is stored', () => {
    expect(loadSession()).toBeUndefined();
  });

  it('loadSession returns undefined for malformed JSON, rather than throwing', () => {
    localStorage.setItem('stack.client.session', 'not json');
    expect(loadSession()).toBeUndefined();
  });

  it('loadSession returns undefined for a shape that is missing required fields', () => {
    localStorage.setItem('stack.client.session', JSON.stringify({ orgId: 'org-1' }));
    expect(loadSession()).toBeUndefined();
  });

  it('clearSession removes a previously saved session', () => {
    saveSession({ orgId: 'org-1', orgToken: 'token-1' });
    clearSession();
    expect(loadSession()).toBeUndefined();
  });
});
