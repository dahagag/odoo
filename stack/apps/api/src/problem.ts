import type { ProblemDetails } from '@stack/domain';

/** The one place every route/middleware builds a Problem Details body (RFC 7807,
 * `@stack/domain`'s `ProblemDetailsSchema`) - so the shape used at runtime and the shape the
 * OpenAPI document promises stay the same by construction, not by three call sites agreeing to
 * copy it correctly. */
export function problem(status: number, title: string, detail?: string): ProblemDetails {
  return { type: 'about:blank', title, status, detail };
}
