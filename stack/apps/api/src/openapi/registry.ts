import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  API_VERSION,
  DnsSubdomainLabelSchema,
  IDEMPOTENCY_KEY_HEADER,
  InviteTypeSchema,
  OrgActionSchema,
  OrgIdSchema,
  OrgStateSchema,
  OrgTypeSchema,
  ProblemDetailsSchema,
  SeatsTotalSchema,
} from '@stack/domain';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'orgToken', {
  type: 'http',
  scheme: 'bearer',
  description: 'Opaque per-org token issued at provision time (docs/adr/0036). Scoped to exactly one org.',
});
registry.registerComponent('securitySchemes', 'sigv4', {
  type: 'apiKey',
  in: 'header',
  name: 'Authorization',
  description:
    'AWS SigV4 (docs/adr/0036), verified at the front door before the request reaches this ' +
    'service - not a literal API key. Modeled as apiKey here because OpenAPI 3.0 has no native ' +
    'SigV4 scheme.',
});

function problemResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: ProblemDetailsSchema } },
  };
}

/** Only present on the "still processing" idempotency conflict - the other 409 causes
 * `problemResponse` above already documents (reused key, illegal transition, label in use) don't
 * set this header. */
const retryAfterHeaderSchema = z.object({
  'Retry-After': z.string().optional().openapi({
    description: 'Seconds to wait before retrying - only set when the 409 is an Idempotency-Key still-processing conflict.',
    example: '3',
  }),
});

function stillProcessingResponse(description: string) {
  return { ...problemResponse(description), headers: retryAfterHeaderSchema };
}

export const OrgRegistrationSchema = z
  .object({
    orgId: OrgIdSchema,
    type: OrgTypeSchema,
    state: OrgStateSchema,
    name: z.string(),
    domain: z.string(),
    seatsUsed: z.number().int().nonnegative(),
    seatsTotal: SeatsTotalSchema,
    expiryDate: z.string().datetime().optional().openapi({
      description: 'Absent for a Client Org, which has no Auto-Destroy expiry.',
    }),
  })
  .openapi('OrgRegistration');

registry.registerPath({
  method: 'get',
  path: `/${API_VERSION}/org/{orgId}/registration`,
  summary: "Read an org's own Org Registration",
  description:
    'docs/contexts/hosting/CONTEXT.md: "the read-only summary of an org\'s own standing". The ' +
    'org token must scope to {orgId} itself (docs/adr/0036) - any other {orgId} is 403.',
  tags: ['org'],
  security: [{ orgToken: [] }],
  request: { params: z.object({ orgId: OrgIdSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrgRegistrationSchema } } },
    400: problemResponse('Malformed orgId'),
    401: problemResponse('Missing or invalid org token'),
    403: problemResponse('Org token does not scope to this org'),
    404: problemResponse('No such org'),
  },
});

registry.registerPath({
  method: 'get',
  path: `/${API_VERSION}/admin/orgs/{orgId}`,
  summary: 'Read any Trial Org or Client Org record (staff plane)',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: { params: z.object({ orgId: OrgIdSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrgRegistrationSchema } } },
    400: problemResponse('Malformed orgId'),
    401: problemResponse('Missing admin principal (SigV4 not verified at the front door)'),
    404: problemResponse('No such org'),
  },
});

const idempotencyKeyHeaderSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z.string().min(1),
});

/** The admin surface's full org record (this ticket, #278) - a superset of `OrgRegistrationSchema`
 * above, which is the org-facing read's deliberately narrower projection. */
export const OrgSchema = z
  .object({
    orgId: OrgIdSchema,
    type: OrgTypeSchema,
    state: OrgStateSchema,
    region: z.string(),
    dnsSubdomainLabel: DnsSubdomainLabelSchema,
    name: z.string(),
    domain: z.string(),
    seatsUsed: z.number().int().nonnegative(),
    seatsTotal: SeatsTotalSchema,
    inviteType: InviteTypeSchema,
    opportunityId: z.string().optional(),
    expiryDate: z.string().datetime().optional().openapi({
      description: 'Absent for a Client Org, which has no Auto-Destroy expiry.',
    }),
    amiId: z.string().optional(),
    tofuModuleGitSha: z.string().optional(),
    pendingAmiId: z.string().optional(),
    pendingTofuModuleGitSha: z.string().optional(),
    lastJobId: z.string().optional(),
    lastJobAction: OrgActionSchema.optional(),
    lastJobStatus: z.enum(['running', 'succeeded', 'failed']).optional().openapi({
      description: "That job's own outcome (#281) - settled by check-status (#298) once the underlying execution reaches a terminal status.",
    }),
    lastJobError: z.string().optional().openapi({
      description: "A clear, actionable reason for lastJobStatus's most recent 'failed' outcome; blank whenever the last observed outcome wasn't a failure.",
    }),
    lastActivityAt: z.string().datetime().optional().openapi({
      description: 'Set to the moment the org reaches active (issue or wake) - what the idle-suspend sweep (#282) checks against the idle timeout.',
    }),
    snapshotRetentionUntil: z.string().datetime().optional().openapi({
      description: 'Set on every destroy, whether triggered by the auto-destroy sweep (#282) or a manual destroy call.',
    }),
  })
  .openapi('Org');

export const CreateOrgRequestSchema = z
  .object({
    type: OrgTypeSchema,
    name: z.string().min(1),
    domain: z.string().min(1),
    seatsTotal: SeatsTotalSchema,
    dnsSubdomainLabel: DnsSubdomainLabelSchema.optional().openapi({
      description: 'Defaults to a slugified `name` when omitted.',
    }),
    inviteType: InviteTypeSchema.optional().openapi({
      description: "Defaults to 'targeted' when omitted.",
    }),
    opportunityId: z.string().optional(),
  })
  .openapi('CreateOrgRequest');

export const UpdateOrgRequestSchema = z
  .object({ dnsSubdomainLabel: DnsSubdomainLabelSchema })
  .openapi('UpdateOrgRequest');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/admin/orgs`,
  summary: 'Create a Trial Org or Client Org, starting in the `issued` state',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: {
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: CreateOrgRequestSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OrgSchema } } },
    400: problemResponse('Malformed request body'),
    401: problemResponse('Missing admin principal'),
    409: stillProcessingResponse('dnsSubdomainLabel already in use, or an Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: `/${API_VERSION}/admin/orgs/{orgId}`,
  summary: 'Change dnsSubdomainLabel - only legal while the org is still `issued`',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateOrgRequestSchema } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrgSchema } } },
    400: problemResponse('Malformed request'),
    401: problemResponse('Missing admin principal'),
    404: problemResponse('No such org'),
    409: stillProcessingResponse('dnsSubdomainLabel already in use, the org has left `issued`, or an Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

export const ExtendOrgRequestSchema = z
  .object({
    // Upper-bounded (CodeRabbit, PR #313) so the computed expiry timestamp can never exceed
    // JavaScript's own Date range: `extendOrgExpiry` (record.ts) adds this many days, in
    // milliseconds, to the org's current expiryDate before calling toISOString() - an
    // unbounded value could overflow that range and throw a RangeError, surfacing as an
    // unhandled 500 instead of a clean 400. 36500 (100 years) is nowhere near a real Extension
    // request but leaves an enormous safety margin under the actual overflow point (~100
    // million days).
    additionalDays: z.number().int().positive().max(36500),
  })
  .openapi('ExtendOrgRequest');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/admin/orgs/{orgId}/extend`,
  summary: "Push a Trial Org's expiryDate out by additionalDays",
  description:
    'Rejected for a Client Org, which has no expiryDate (docs/adr/0034). Extension\'s own ' +
    'authorisation (the sales-methodology qualification gate) is enforced by the caller (Odoo), ' +
    'not here - this endpoint only performs the write once Odoo has decided to allow it.',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: ExtendOrgRequestSchema } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrgSchema } } },
    400: problemResponse('Malformed request body'),
    401: problemResponse('Missing admin principal'),
    404: problemResponse('No such org'),
    409: stillProcessingResponse('Not a Trial Org (no expiryDate to extend), a concurrent extend exhausted retries, or an Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

for (const action of ['issue', 'suspend', 'wake', 'destroy'] as const) {
  registry.registerPath({
    method: 'post',
    path: `/${API_VERSION}/admin/orgs/{orgId}/${action}`,
    summary: `Lifecycle action: ${action}`,
    description: 'Calls the configured provisioner (a no-op by default, #278) with a freshly minted job id (ADR-0019). Rejected from any source state the transition graph does not allow, leaving the record unchanged.',
    tags: ['admin'],
    security: [{ sigv4: [] }],
    request: {
      params: z.object({ orgId: OrgIdSchema }),
      headers: idempotencyKeyHeaderSchema,
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: OrgSchema } } },
      401: problemResponse('Missing admin principal'),
      404: problemResponse('No such org'),
      409: stillProcessingResponse('Illegal transition, a concurrent transition already won, or an Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
      502: problemResponse('The provisioner failed; no state change was made'),
    },
  });
}

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/admin/orgs/{orgId}/check-status`,
  summary: "Poll the org's currently-running job to a terminal status, if it has one",
  description:
    'Production entry point for `Provisioner.checkStatus` (#298, #281): a safe no-op when the ' +
    "org isn't currently running a job. Reachable per-org by an external scheduler that already " +
    'knows which orgs have a job in flight.',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrgSchema } } },
    401: problemResponse('Missing admin principal'),
    404: problemResponse('No such org'),
    409: stillProcessingResponse('An Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

/** The idle-suspend and auto-destroy sweeps' own response shape (#282) - a summary of which orgs
 * this run actually transitioned, not a full `OrgSchema` per org (a sweep can touch many orgs in
 * one call, and a caller that needs a given org's full current record already has `GET
 * /v1/admin/orgs/{orgId}`). */
export const SweepResultSchema = z
  .object({
    action: z.enum(['suspend', 'destroy']),
    orgIds: z.array(OrgIdSchema),
  })
  .openapi('SweepResult');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/admin/sweeps/idle-suspend`,
  summary: 'Suspend every active org idle past the timeout',
  description:
    'Production entry point for the idle-suspend sweep (#282): reachable by an external ' +
    'scheduler on a recurring cadence, rather than checked inline on request. Never wakes a ' +
    'suspended org - only the explicit `wake` action does.',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: { headers: idempotencyKeyHeaderSchema },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: SweepResultSchema } } },
    401: problemResponse('Missing admin principal'),
    409: stillProcessingResponse('An Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/admin/sweeps/auto-destroy`,
  summary: 'Auto-Destroy every active or suspended Trial Org past its expiry date',
  description:
    'Production entry point for the auto-destroy sweep (#282): reachable by an external ' +
    'scheduler on a recurring cadence. A Client Org is never selected, regardless of any date ' +
    'field it carries; an issued (never provisioned) Trial Org is ignored. Every destroy leaves ' +
    'the org with a snapshot-retention marker set.',
  tags: ['admin'],
  security: [{ sigv4: [] }],
  request: { headers: idempotencyKeyHeaderSchema },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: SweepResultSchema } } },
    401: problemResponse('Missing admin principal'),
    409: stillProcessingResponse('An Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
  },
});

const HealthSchema = z.object({ status: z.literal('ok') }).openapi('Health');
const ReadinessSchema = z
  .object({ status: z.enum(['ready', 'not-ready']), reason: z.string().optional() })
  .openapi('Readiness');

registry.registerPath({
  method: 'get',
  path: '/healthz',
  summary: 'Liveness probe - always 200 once the process is up',
  tags: ['ops'],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: HealthSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/readyz',
  summary: 'Readiness probe - whether the service can actually serve (this ticket\'s User Stories, #9)',
  tags: ['ops'],
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: ReadinessSchema } } },
    503: { description: 'Not ready', content: { 'application/json': { schema: ReadinessSchema } } },
  },
});
