import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../src/openapi/generate';
import { findBreakingChanges } from '../src/openapi/diff';

const COMMITTED_PATH = path.join(__dirname, '..', 'openapi', 'openapi.json');

describe('OpenAPI contract (this ticket\'s Testing Decisions)', () => {
  it('the committed document matches what the validators generate right now', () => {
    const committed = JSON.parse(readFileSync(COMMITTED_PATH, 'utf8'));
    const generated = generateOpenApiDocument();
    expect(committed).toEqual(generated);
  });

  it('declares both surfaces with the security scheme docs/adr/0036 assigns each', () => {
    const document = generateOpenApiDocument() as unknown as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    expect(document.paths['/v1/org/{orgId}/registration']!.get!.security).toEqual([{ orgToken: [] }]);
    expect(document.paths['/v1/admin/orgs/{orgId}']!.get!.security).toEqual([{ sigv4: [] }]);
  });
});

describe('findBreakingChanges', () => {
  it('flags a removed path', () => {
    const previous = { paths: { '/v1/x': { get: { responses: { 200: {} } } } } };
    const current = { paths: {} };
    expect(findBreakingChanges(previous, current)).toContain('removed path: /v1/x');
  });

  it('flags a newly required request field', () => {
    const previous = {
      paths: {
        '/v1/x': {
          post: {
            requestBody: { content: { 'application/json': { schema: { required: [] } } } },
            responses: {},
          },
        },
      },
    };
    const current = {
      paths: {
        '/v1/x': {
          post: {
            requestBody: { content: { 'application/json': { schema: { required: ['name'] } } } },
            responses: {},
          },
        },
      },
    };
    expect(findBreakingChanges(previous, current)).toContain('new required request field "name" for POST /v1/x');
  });

  it('flags a removed response field', () => {
    const schema = (properties: Record<string, unknown>) => ({
      required: [],
      properties,
    });
    const previous = {
      paths: {
        '/v1/x': {
          get: {
            responses: { 200: { content: { 'application/json': { schema: schema({ a: {}, b: {} }) } } } },
          },
        },
      },
    };
    const current = {
      paths: {
        '/v1/x': {
          get: {
            responses: { 200: { content: { 'application/json': { schema: schema({ a: {} }) } } } },
          },
        },
      },
    };
    expect(findBreakingChanges(previous, current)).toContain('removed response field "b" (200) for GET /v1/x');
  });

  it('flags a removed security scheme (an org token/SigV4 caller loses access, docs/adr/0036)', () => {
    const previous = { paths: { '/v1/x': { get: { security: [{ orgToken: [] }], responses: { 200: {} } } } } };
    const current = { paths: { '/v1/x': { get: { security: [{ sigv4: [] }], responses: { 200: {} } } } } };
    expect(findBreakingChanges(previous, current)).toContain('removed security requirement "orgToken" for GET /v1/x');
  });

  it('flags merging separately-sufficient security alternatives into one AND\'d requirement', () => {
    // An orgToken-only caller and a sigv4-only caller could each authenticate before; requiring
    // both together now locks both of them out, even though the flattened scheme set is
    // unchanged ({orgToken, sigv4} either way).
    const previous = {
      paths: { '/v1/x': { get: { security: [{ orgToken: [] }, { sigv4: [] }], responses: { 200: {} } } } },
    };
    const current = {
      paths: { '/v1/x': { get: { security: [{ orgToken: [], sigv4: [] }], responses: { 200: {} } } } },
    };
    const issues = findBreakingChanges(previous, current);
    expect(issues).toContain('removed security requirement "orgToken" for GET /v1/x');
    expect(issues).toContain('removed security requirement "sigv4" for GET /v1/x');
  });

  it('flags newly-required authentication on a previously-open endpoint (e.g. /healthz gaining auth)', () => {
    const previous = { paths: { '/healthz': { get: { responses: { 200: {} } } } } };
    const current = { paths: { '/healthz': { get: { security: [{ sigv4: [] }], responses: { 200: {} } } } } };
    expect(findBreakingChanges(previous, current)).toContain('newly required authentication for GET /healthz');
  });

  it('does not flag adding a second accepted security scheme', () => {
    const previous = { paths: { '/v1/x': { get: { security: [{ orgToken: [] }], responses: { 200: {} } } } } };
    const current = {
      paths: { '/v1/x': { get: { security: [{ orgToken: [] }, { sigv4: [] }], responses: { 200: {} } } } },
    };
    expect(findBreakingChanges(previous, current)).toEqual([]);
  });

  it('does not flag a purely additive change', () => {
    const previous = { paths: { '/v1/x': { get: { responses: { 200: {} } } } } };
    const current = {
      paths: {
        '/v1/x': { get: { responses: { 200: {} } } },
        '/v1/y': { get: { responses: { 200: {} } } },
      },
    };
    expect(findBreakingChanges(previous, current)).toEqual([]);
  });
});
