/**
 * The TypeScript client the staff app and client app (both later tickets, #199/#200) import
 * instead of hand-rolling `fetch` calls against the OpenAPI contract (docs/adr/0036). This
 * ticket ships only the transport - request signing/auth and per-resource methods (list orgs,
 * issue, suspend, wake...) land with the endpoints that need them, since this ticket adds no
 * business logic (Out of Scope). `hosting_admin`'s own client is Python, generated separately
 * from the same committed `openapi.json` - it does not depend on this package.
 */
import { API_VERSION, IDEMPOTENCY_KEY_HEADER, ProblemDetailsSchema, type ProblemDetails } from '@stack/domain';

export class StackApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'StackApiError';
  }
}

export interface StackApiClientOptions {
  baseUrl: string;
  /** Injected rather than performed inside this client: the admin surface signs with SigV4
   * (docs/adr/0036), the org surface sends a Bearer token, and this package deliberately holds
   * no opinion on which - the caller supplies whatever `fetch`-compatible headers its surface
   * needs. */
  authorize?: (init: RequestInit) => RequestInit | Promise<RequestInit>;
  fetchImpl?: typeof fetch;
}

export class StackApiClient {
  private readonly baseUrl: string;
  private readonly authorize: NonNullable<StackApiClientOptions['authorize']>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StackApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authorize = options.authorize ?? ((init) => init);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Every mutating call goes through here so an `Idempotency-Key` is never forgotten (this
   * ticket's Implementation Decisions). `idempotencyKey` is caller-supplied, not generated here,
   * so a caller-level retry of the same logical action reuses the same key. */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;

    const init = await this.authorize({
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const response = await this.fetchImpl(`${this.baseUrl}/${API_VERSION}${path}`, init);
    const payload = await response.json();
    if (!response.ok) {
      throw new StackApiError(ProblemDetailsSchema.parse(payload));
    }
    return payload as T;
  }
}
