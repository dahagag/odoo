import { describe, expect, it } from 'vitest';
import { runBreakingCheck } from '../src/openapi/breakingCheck';

describe('runBreakingCheck (this ticket\'s CI gate)', () => {
  it('throws rather than silently reporting "no breaking changes" when baseRef does not resolve', () => {
    // A misconfigured OPENAPI_BASE_REF, or a checkout that never fetched the base branch, must
    // fail loudly - not be read as "nothing to diff against" (that would silently disable the
    // gate this function exists to serve).
    expect(() => runBreakingCheck('definitely-not-a-real-ref-zzz')).toThrow();
  });

  it('returns no issues against a real commit that predates this document existing', () => {
    // 83fd1c260 is dev/19.0's tip immediately before this ticket's own PR - a real ref that
    // resolves, but never had stack/apps/api/openapi/openapi.json. This is the one case the
    // catch is meant to swallow: nothing to diff against, not an error.
    expect(runBreakingCheck('83fd1c260')).toEqual([]);
  });
});
