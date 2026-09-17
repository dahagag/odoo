import { describe, expect, it } from 'vitest';
import { StackApiClient, StackApiError } from '../src/index';

function fakeFetch(response: { status: number; statusText?: string; body?: string }): typeof fetch {
  return (async () =>
    new Response(response.body, { status: response.status, statusText: response.statusText })) as typeof fetch;
}

describe('StackApiClient.request - defensive response parsing', () => {
  it('treats a 204 (empty body) as a successful undefined result, not a parse error', async () => {
    const client = new StackApiClient({ baseUrl: 'https://stack.example', fetchImpl: fakeFetch({ status: 204 }) });
    await expect(client.request('GET', '/v1/x')).resolves.toBeUndefined();
  });

  it('returns valid JSON on a normal 200', async () => {
    const client = new StackApiClient({
      baseUrl: 'https://stack.example',
      fetchImpl: fakeFetch({ status: 200, body: JSON.stringify({ ok: true }) }),
    });
    await expect(client.request('GET', '/v1/x')).resolves.toEqual({ ok: true });
  });

  it('parses a real Problem Details error body into StackApiError', async () => {
    const problem = { type: 'about:blank', title: 'No such org', status: 404 };
    const client = new StackApiClient({
      baseUrl: 'https://stack.example',
      fetchImpl: fakeFetch({ status: 404, body: JSON.stringify(problem) }),
    });
    await expect(client.request('GET', '/v1/x')).rejects.toMatchObject({ problem });
  });

  it('falls back to a synthetic Problem Details for a non-JSON error body (e.g. an HTML 502 page)', async () => {
    const client = new StackApiClient({
      baseUrl: 'https://stack.example',
      fetchImpl: fakeFetch({ status: 502, statusText: 'Bad Gateway', body: '<html>Bad Gateway</html>' }),
    });
    const error = await client.request('GET', '/v1/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StackApiError);
    expect((error as StackApiError).problem).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502 });
  });

  it('rejects rather than silently returning undefined for malformed JSON on a 200', async () => {
    const client = new StackApiClient({
      baseUrl: 'https://stack.example',
      fetchImpl: fakeFetch({ status: 200, body: '{not valid json' }),
    });
    await expect(client.request('GET', '/v1/x')).rejects.toThrow();
  });

  it('omits Content-Type on a body-less request (#200: a POST with no body must not declare application/json)', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(undefined, { status: 200 });
    }) as typeof fetch;
    const client = new StackApiClient({ baseUrl: 'https://stack.example', fetchImpl });

    await client.request('POST', '/v1/x', { idempotencyKey: 'k-1' });

    expect((capturedInit?.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(capturedInit?.body).toBeUndefined();
  });

  it('sets Content-Type when a body is present', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(undefined, { status: 200 });
    }) as typeof fetch;
    const client = new StackApiClient({ baseUrl: 'https://stack.example', fetchImpl });

    await client.request('POST', '/v1/x', { body: { a: 1 }, idempotencyKey: 'k-2' });

    expect((capturedInit?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});
