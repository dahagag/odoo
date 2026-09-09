import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION, OrgIdSchema, OrgStateSchema, OrgTypeSchema, ProblemDetailsSchema } from '@stack/domain';
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

export const OrgRegistrationSchema = z
  .object({
    orgId: OrgIdSchema,
    type: OrgTypeSchema,
    state: OrgStateSchema,
    name: z.string(),
    domain: z.string(),
    seatsUsed: z.number().int().nonnegative(),
    seatsTotal: z.number().int().positive(),
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
