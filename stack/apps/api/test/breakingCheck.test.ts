import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runBreakingCheck } from '../src/openapi/breakingCheck';

/** A throwaway commit with no files at all - written directly to the local object database
 * (never pointed to by any ref, so it's never pushed and is eventually garbage-collected), not
 * dependent on any particular commit already existing in this repo's history. Generated per
 * test rather than hardcoded, because CI's shallow (`--depth=1`) fetch of the base branch tip
 * doesn't guarantee any specific older commit is actually present in the checkout. */
function fixtureCommitWithNoFiles(): string {
  const emptyTree = execFileSync('git', ['mktree'], { input: '', encoding: 'utf8' }).trim();
  return execFileSync('git', ['commit-tree', emptyTree, '-m', 'fixture: no files'], { encoding: 'utf8' }).trim();
}

describe('runBreakingCheck (this ticket\'s CI gate)', () => {
  it('throws rather than silently reporting "no breaking changes" when baseRef does not resolve', () => {
    // A misconfigured OPENAPI_BASE_REF, or a checkout that never fetched the base branch, must
    // fail loudly - not be read as "nothing to diff against" (that would silently disable the
    // gate this function exists to serve).
    expect(() => runBreakingCheck('definitely-not-a-real-ref-zzz')).toThrow();
  });

  it('returns no issues against a commit that never had this document', () => {
    // This is the one case the catch in loadPreviousDocument is meant to swallow: the ref
    // resolves but never had stack/apps/api/openapi/openapi.json - nothing to diff against, not
    // an error.
    expect(runBreakingCheck(fixtureCommitWithNoFiles())).toEqual([]);
  });
});
