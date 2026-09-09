import type { AwsGateway } from '@stack/aws-gateway';
import { OrgIdSchema } from '@stack/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { requireAdminPrincipal } from './auth/admin';
import { forbidCrossOrgAccess, requireOrgToken, type OrgTokenStore } from './auth/orgToken';
import type { Env } from './config/env';
import { requireIdempotencyKey } from './idempotency/middleware';
import type { IdempotencyStore } from './idempotency/store';
import { OrgRegistrationSchema } from './openapi/registry';
import { readOrgRegistration } from './orgRegistration';
import { problem } from './problem';

export interface ServerDeps {
  env: Env;
  awsGateway: AwsGateway;
  orgTokenStore: OrgTokenStore;
  // Constructed and wired for later tickets' state-changing endpoints (this ticket's
  // Implementation Decisions); nothing this ticket adds yet mutates state.
  idempotencyStore: IdempotencyStore;
}

/** Every path takes `orgId` through this, rather than trusting the raw path segment, so a
 * malformed id 404s here instead of reaching `readOrgRegistration` with something that was
 * never going to match a `pk`. Returns the validated id, or sends 400 and returns `undefined`
 * for the caller to bail out on. */
function parseOrgIdParam(rawOrgId: string, reply: FastifyReply): string | undefined {
  const result = OrgIdSchema.safeParse(rawOrgId);
  if (!result.success) {
    reply.code(400).send(problem(400, 'Malformed orgId', 'orgId must be a UUID.'));
    return undefined;
  }
  return result.data;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      transport: deps.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  app.addHook('preHandler', requireIdempotencyKey);

  app.get('/healthz', async () => ({ status: 'ok' as const }));

  app.get('/readyz', async (_request, reply) => {
    try {
      // A lightweight, always-safe probe: reads a key nothing ever writes, so a real DynamoDB
      // failure (network/credentials/throttling) throws, while "item not found" - the expected
      // steady state - does not (this ticket's User Stories, #9).
      await deps.awsGateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'readiness#probe' } });
      return { status: 'ready' as const };
    } catch (error) {
      reply.code(503);
      return { status: 'not-ready' as const, reason: error instanceof Error ? error.message : 'unknown error' };
    }
  });

  app.get<{ Params: { orgId: string } }>(
    '/v1/org/:orgId/registration',
    { preHandler: requireOrgToken(deps.orgTokenStore) },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;

      const forbidden = forbidCrossOrgAccess(request, orgId);
      if (forbidden) {
        reply.code(403);
        return forbidden;
      }
      const registration = await readOrgRegistration(deps.awsGateway, orgId);
      if (!registration) {
        reply.code(404);
        return problem(404, 'No such org');
      }
      // Validated against the same schema the OpenAPI document is generated from
      // (openapi/registry.ts), so this response and that document cannot silently drift apart
      // (docs/adr/0036: "cannot drift from what the server actually accepts").
      return OrgRegistrationSchema.parse(registration);
    },
  );

  app.get<{ Params: { orgId: string } }>(
    '/v1/admin/orgs/:orgId',
    { preHandler: requireAdminPrincipal },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;

      const registration = await readOrgRegistration(deps.awsGateway, orgId);
      if (!registration) {
        reply.code(404);
        return problem(404, 'No such org');
      }
      return OrgRegistrationSchema.parse(registration);
    },
  );

  return app;
}
