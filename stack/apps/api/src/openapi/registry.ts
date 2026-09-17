import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  API_VERSION,
  DnsSubdomainLabelSchema,
  IDEMPOTENCY_KEY_HEADER,
  InviteTypeSchema,
  OrgActionSchema,
  OrgIdSchema,
  OrgStateSchema,
  OrgTokenSchema,
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

/** The public Wake route's own 429 - a rate-limit backoff, never an idempotency conflict, so it
 * needs its own wording rather than reusing `retryAfterHeaderSchema`'s (CodeRabbit, PR #318). */
const wakeRetryAfterHeaderSchema = z.object({
  'Retry-After': z.string().optional().openapi({
    description: 'Seconds to wait before retrying this org\'s wake - only set on a 429 (rate limited).',
    example: '3',
  }),
});

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

// ---- Seats and invitations (#200) --------------------------------------------------------------

export const SeatSchema = z
  .object({
    seatId: z.string(),
    orgId: OrgIdSchema,
    email: z.string(),
    state: z.enum(['invited', 'accepted']),
    invitedBySeatId: z.string().optional().openapi({
      description: 'Absent for a Seat created via an Open Invite Link join, which is confirmed by domain match rather than vouched for by an existing member.',
    }),
  })
  .openapi('Seat');

registry.registerPath({
  method: 'get',
  path: `/${API_VERSION}/org/{orgId}/seats`,
  summary: "List an org's own Seats",
  description: "#200's User Story 3: \"I want to see who has a seat on my org.\" The org token must scope to {orgId} itself.",
  tags: ['org'],
  security: [{ orgToken: [] }],
  request: { params: z.object({ orgId: OrgIdSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(SeatSchema) } } },
    401: problemResponse('Missing or invalid org token'),
    403: problemResponse('Org token does not scope to this org'),
  },
});

export const InviteSeatRequestSchema = z.object({ email: z.string().min(1) }).openapi('InviteSeatRequest');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/org/{orgId}/seats/invite`,
  summary: 'Targeted Invite: an accepted Seat invites a same-domain teammate (ADR-0026)',
  tags: ['org'],
  security: [{ orgToken: [] }],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: InviteSeatRequestSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: SeatSchema } } },
    400: problemResponse('Malformed request body, or a malformed invite email'),
    401: problemResponse('Missing or invalid org token'),
    403: problemResponse('Org token does not scope to this org, is not Seat-scoped, the inviting Seat has not accepted yet, or the invite email is cross-domain'),
    404: problemResponse('No such org'),
    409: stillProcessingResponse('The org has no remaining seats, or an Idempotency-Key conflict'),
  },
});

// ---- Magic-link sign-in (#200) ------------------------------------------------------------------

export const RequestMagicLinkSchema = z.object({ email: z.string().min(1) }).openapi('RequestMagicLinkRequest');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/org/{orgId}/auth/magic-links`,
  summary: 'Request a passwordless sign-in link for an org (#200 User Stories 4, 6, 12)',
  description:
    'Qualifies identically to the invitation paths it fronts (ADR-0026): an email with an ' +
    "existing Seat always qualifies; an email with none only qualifies on an org that accepts " +
    'Open Invite joins - either way the email must match the org\'s prospect domain. Always ' +
    '202 with no body: this never reveals whether a given email actually has a Seat.',
  tags: ['auth'],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: RequestMagicLinkSchema } } },
  },
  responses: {
    202: { description: 'Accepted - a magic link was sent if the email qualifies' },
    400: problemResponse('Malformed request body, or a malformed email'),
    403: problemResponse('The email does not match this org\'s prospect domain'),
    404: problemResponse('No such org'),
  },
});

export const VerifyMagicLinkRequestSchema = z.object({ token: z.string().min(1) }).openapi('VerifyMagicLinkRequest');
export const VerifyMagicLinkResponseSchema = z
  .object({ orgId: OrgIdSchema, orgToken: OrgTokenSchema, seat: SeatSchema })
  .openapi('VerifyMagicLinkResponse');

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/auth/magic-links/verify`,
  summary: 'Exchange a magic-link token for an org token (#200 User Stories 12, 13)',
  description: 'Single-use and time-boxed (docs/adr, this ticket): an expired, already-used, or unknown token is 404, never revealing which.',
  tags: ['auth'],
  request: {
    headers: idempotencyKeyHeaderSchema,
    body: { required: true, content: { 'application/json': { schema: VerifyMagicLinkRequestSchema } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: VerifyMagicLinkResponseSchema } } },
    400: problemResponse('Malformed request body'),
    404: problemResponse('The token is unknown, already used, or expired'),
    409: stillProcessingResponse('The org has no remaining seats (an Open Invite Link filled up between request and verify), or an Idempotency-Key conflict'),
  },
});

// ---- The public surface: asleep/Wake-Up (#200) --------------------------------------------------

export const PublicOrgSchema = z.object({ orgId: OrgIdSchema, name: z.string() }).openapi('PublicOrg');

registry.registerPath({
  method: 'get',
  path: `/${API_VERSION}/public/orgs/by-dns-label/{dnsSubdomainLabel}`,
  summary: "Resolve a Host's dnsSubdomainLabel to the org it belongs to (no auth - the asleep page's own entry point)",
  description:
    'Reachable by any visitor: this is the only lookup a suspended org\'s own Route53 failover ' +
    '(ADR-0030) can make, since the visitor carries no org id or token at all. Exposes nothing ' +
    'beyond orgId/name - never seats, domain, or state.',
  tags: ['public'],
  request: { params: z.object({ dnsSubdomainLabel: DnsSubdomainLabelSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: PublicOrgSchema } } },
    404: problemResponse('No org reserves this label'),
  },
});

export const AsleepStatusSchema = z
  .object({
    phase: z.enum(['idle', 'waking', 'awake']),
    elapsedSeconds: z.number().nonnegative(),
    expectedSeconds: z.number().positive(),
  })
  .openapi('AsleepStatus');

registry.registerPath({
  method: 'get',
  path: `/${API_VERSION}/public/orgs/{orgId}/asleep-status`,
  summary: 'Poll the asleep/Wake-Up page\'s own phase (no auth)',
  description: 'Visiting this never itself wakes the org (#200: "Wake stays explicit") - it only reports the current phase.',
  tags: ['public'],
  request: { params: z.object({ orgId: OrgIdSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: AsleepStatusSchema } } },
    404: problemResponse('No such org'),
  },
});

registry.registerPath({
  method: 'post',
  path: `/${API_VERSION}/public/orgs/{orgId}/wake`,
  summary: 'Wake a suspended org (no auth - the asleep page\'s own Wake Up button)',
  description:
    'A no-op (not an error) if the org is not currently suspended - a slow double-click or a ' +
    'second open tab racing this one is ordinary. Rate limited per org, not per IP (#200\'s ' +
    'Further Notes: "a link shared in a group chat has many IPs"), since this is the one public ' +
    'action that starts real compute.',
  tags: ['public'],
  request: {
    params: z.object({ orgId: OrgIdSchema }),
    headers: idempotencyKeyHeaderSchema,
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: AsleepStatusSchema } } },
    404: problemResponse('No such org'),
    409: stillProcessingResponse('An Idempotency-Key conflict (reused for a different request, or still processing - see `Retry-After`)'),
    429: { ...problemResponse('Rate limited - too many wake attempts for this org'), headers: wakeRetryAfterHeaderSchema },
    502: problemResponse('The provisioner failed; no state change was made'),
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
