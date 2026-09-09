import type { AwsGateway } from '@stack/aws-gateway';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireAdminPrincipal } from './auth/admin';
import { forbidCrossOrgAccess, requireOrgToken, type OrgTokenStore } from './auth/orgToken';
import type { Env } from './config/env';
import { requireIdempotencyKey } from './idempotency/middleware';
import type { IdempotencyStore } from './idempotency/store';
import { readOrgRegistration } from './orgRegistration';

export interface ServerDeps {
  env: Env;
  awsGateway: AwsGateway;
  orgTokenStore: OrgTokenStore;
  // Constructed and wired for later tickets' state-changing endpoints (this ticket's
  // Implementation Decisions); nothing this ticket adds yet mutates state.
  idempotencyStore: IdempotencyStore;
}

function problem(status: number, title: string, detail?: string) {
  return { type: 'about:blank', title, status, detail };
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
      const forbidden = forbidCrossOrgAccess(request, request.params.orgId);
      if (forbidden) {
        reply.code(403);
        return forbidden;
      }
      const registration = await readOrgRegistration(deps.awsGateway, request.params.orgId);
      if (!registration) {
        reply.code(404);
        return problem(404, 'No such org');
      }
      return registration;
    },
  );

  app.get<{ Params: { orgId: string } }>(
    '/v1/admin/orgs/:orgId',
    { preHandler: requireAdminPrincipal },
    async (request, reply) => {
      const registration = await readOrgRegistration(deps.awsGateway, request.params.orgId);
      if (!registration) {
        reply.code(404);
        return problem(404, 'No such org');
      }
      return registration;
    },
  );

  return app;
}
