import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findBreakingChanges, type OpenApiDocument } from './diff';

const CURRENT_DOCUMENT_PATH = path.join(__dirname, '..', '..', 'openapi', 'openapi.json');
const REPO_RELATIVE_DOCUMENT_PATH = 'stack/apps/api/openapi/openapi.json';

function loadPreviousDocument(baseRef: string): OpenApiDocument | undefined {
  // A base ref that doesn't resolve at all (bad ref, or a checkout too shallow to have fetched
  // it) must fail loudly, not be read as "nothing to diff against" - that would silently
  // disable the gate this function exists to serve.
  execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' });

  let raw: string;
  try {
    raw = execFileSync('git', ['show', `${baseRef}:${REPO_RELATIVE_DOCUMENT_PATH}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    if (/does not exist in|exists on disk, but not in/.test(stderr)) {
      // The ref resolves but never had this document (e.g. this is the PR that first adds
      // it) - nothing to diff against, so there is nothing that could be a breaking change.
      return undefined;
    }
    throw error;
  }
  return JSON.parse(raw) as OpenApiDocument; // a malformed baseline now fails loudly too
}

export function runBreakingCheck(baseRef: string): string[] {
  const previous = loadPreviousDocument(baseRef);
  if (!previous) return [];
  const current = JSON.parse(readFileSync(CURRENT_DOCUMENT_PATH, 'utf8')) as OpenApiDocument;
  return findBreakingChanges(previous, current);
}

if (require.main === module) {
  const baseRef = process.argv[2] ?? process.env.OPENAPI_BASE_REF ?? 'origin/dev/19.0';
  const issues = runBreakingCheck(baseRef);
  if (issues.length > 0) {
    console.error(`Breaking OpenAPI changes detected relative to ${baseRef}:`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(`No breaking OpenAPI changes detected relative to ${baseRef}.`);
}
