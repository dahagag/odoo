/**
 * Shared vocabulary for the Administration Stack's contract (docs/adr/0034, docs/adr/0036).
 *
 * This package intentionally holds shapes and constants only — no lifecycle logic. The Trial
 * Org / Client Org lifecycle itself ports in a later ticket (#196); this ticket's job is the
 * seam every later ticket builds on.
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Patches z.ZodType.prototype with `.openapi(...)` (side effect required before any schema
// below calls it) - must run here, once, before apps/api's own registry does the same for its
// own schemas. Idempotent: harmless if apps/api's copy also runs it in the same process.
extendZodWithOpenApi(z);

/** URI-prefixed API versioning strategy (docs/adr/0036): a breaking change ships as `/v2`,
 * never a mutation of `/v1`'s existing shapes. */
export const API_VERSION = 'v1';

/** HTTP header every state-changing endpoint requires (see Implementation Decisions on #195:
 * idempotency preserves ADR-0019's job-identity guarantee across the new HTTP hop). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const OrgTypeSchema = z.enum(['trial', 'client']).openapi('OrgType', {
  description:
    'Trial Org: the ephemeral evaluation offering. Client Org: a stable hosted org for a ' +
    'paying client. See docs/contexts/hosting/CONTEXT.md.',
});
export type OrgType = z.infer<typeof OrgTypeSchema>;

/** Matches `hosting.trial.org.state` (custom_addons/hosting_admin/models/trial_org.py) so the
 * stack's record and Odoo's mirrored projection use one vocabulary. Promotion's effect on this
 * enum is an open design item (docs/adr/0035) and is not decided here. */
export const OrgStateSchema = z.enum(['issued', 'active', 'suspended', 'destroyed']).openapi(
  'OrgState',
);
export type OrgState = z.infer<typeof OrgStateSchema>;

export const OrgIdSchema = z.string().uuid().openapi('OrgId', {
  description: 'The Administration Stack\'s own identifier for a Trial Org or Client Org.',
});
export type OrgId = z.infer<typeof OrgIdSchema>;

/** RFC 7807 Problem Details, used for every non-2xx response so every consumer (Odoo, the
 * staff app, the client app) parses errors one way. */
export const ProblemDetailsSchema = z
  .object({
    type: z.string().openapi({ example: 'about:blank' }),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    code: z.string().optional().openapi({
      description: 'Stack-specific machine-readable error code, stable across `detail` wording changes.',
    }),
  })
  .openapi('ProblemDetails');
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Cursor pagination request/response shapes, shared by every list endpoint later tickets add
 * (e.g. list orgs by state, list orgs by expiry date for the auto-destroy sweep). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().optional(),
  });
}

/** Per-org token (docs/adr/0036): opaque, issued at provision time, scoped to exactly one org.
 * Never a JWT the client can introspect — the stack is the only party that needs to resolve it,
 * so an opaque token has no local-forgery surface. */
export const OrgTokenSchema = z.string().min(1).openapi('OrgToken');
export type OrgToken = z.infer<typeof OrgTokenSchema>;
