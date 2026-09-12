import type { AwsGateway } from '@stack/aws-gateway';
import { OrgActionSchema, OrgIdSchema } from '@stack/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { requireAdminPrincipal } from './auth/admin';
import { forbidCrossOrgAccess, requireOrgToken, type OrgTokenStore } from './auth/orgToken';
import type { Env } from './config/env';
import { idempotencyKeyOf, requireIdempotencyKey, withIdempotency } from './idempotency/middleware';
import type { IdempotencyStore } from './idempotency/store';
import { CreateOrgRequestSchema, OrgSchema, OrgRegistrationSchema, UpdateOrgRequestSchema } from './openapi/registry';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  IllegalTransitionError,
  OrgNotFoundError,
} from './org/errors';
import type { Provisioner } from './org/provisioner';
import { applyTransition, createOrg, updateDnsSubdomainLabel } from './org/record';
import { readOrgRegistration } from './orgRegistration';
import { problem } from './problem';

export interface ServerDeps {
  env: Env;
  awsGateway: AwsGateway;
  orgTokenStore: OrgTokenStore;
  idempotencyStore: IdempotencyStore;
  /** Injected provisioner seam (this ticket, #278): a no-op `StubProvisioner` by default, so
   * this ticket needs no real AWS. */
  provisioner: Provisioner;
}

/** Maps the errors `org/errors.ts` defines (raised by `org/record.ts`) to their Problem Details
 * response. Returns `undefined` for anything else - a route decides for itself what an
 * unrecognized error means (create/patch: a bug, so it rethrows for Fastify's default 500; a
 * transition: quite possibly the injected provisioner throwing its own error, see
 * `transitionErrorResponse` below). */
function knownOrgErrorResponse(error: unknown, reply: FastifyReply): ReturnType<typeof problem> | undefined {
  if (error instanceof OrgNotFoundError) {
    reply.code(404);
    return problem(404, 'No such org', error.message);
  }
  if (error instanceof DnsLabelInUseError) {
    reply.code(409);
    return problem(409, 'dnsSubdomainLabel already in use', error.message);
  }
  if (error instanceof DnsLabelImmutableError) {
    reply.code(409);
    return problem(409, 'dnsSubdomainLabel is immutable once the org has left \'issued\'', error.message);
  }
  if (error instanceof IllegalTransitionError) {
    reply.code(409);
    return problem(409, 'Illegal transition', error.message);
  }
  if (error instanceof ConcurrentWriteError) {
    reply.code(409);
    return problem(409, 'Concurrent transition', error.message);
  }
  return undefined;
}

/** Transition routes only: a provisioner failure is an upstream dependency failing, not this
 * service's own fault, and this ticket's Acceptance Criteria only promises the state change
 * doesn't happen - reported as 502 rather than crashing the request as an unhandled 500. */
function transitionErrorResponse(error: unknown, reply: FastifyReply): ReturnType<typeof problem> {
  const known = knownOrgErrorResponse(error, reply);
  if (known) return known;
  reply.code(502);
  return problem(502, 'The provisioner failed; no state change was made', error instanceof Error ? error.message : String(error));
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

  app.get('/healthz', async () => ({ status: 'ok' as const, release: deps.env.RELEASE_VERSION }));

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

  app.post('/v1/admin/orgs', { preHandler: requireAdminPrincipal }, async (request, reply) => {
    const parsed = CreateOrgRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return problem(400, 'Malformed request body', parsed.error.message);
    }

    try {
      const record = await withIdempotency(deps.idempotencyStore, idempotencyKeyOf(request), async () => {
        const org = await createOrg(deps.awsGateway, parsed.data, {
          defaultRegion: deps.env.DEFAULT_ORG_REGION,
          trialDurationDays: deps.env.TRIAL_DEFAULT_DURATION_DAYS,
        });
        return { status: 201, body: OrgSchema.parse(org) };
      });
      reply.code(record.status);
      return record.body;
    } catch (error) {
      const known = knownOrgErrorResponse(error, reply);
      if (known) return known;
      throw error;
    }
  });

  app.patch<{ Params: { orgId: string } }>(
    '/v1/admin/orgs/:orgId',
    { preHandler: requireAdminPrincipal },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;

      const parsed = UpdateOrgRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return problem(400, 'Malformed request body', parsed.error.message);
      }

      try {
        const record = await withIdempotency(deps.idempotencyStore, idempotencyKeyOf(request), async () => {
          const org = await updateDnsSubdomainLabel(deps.awsGateway, orgId, parsed.data.dnsSubdomainLabel);
          return { status: 200, body: OrgSchema.parse(org) };
        });
        reply.code(record.status);
        return record.body;
      } catch (error) {
        const known = knownOrgErrorResponse(error, reply);
        if (known) return known;
        throw error;
      }
    },
  );

  for (const action of OrgActionSchema.options) {
    app.post<{ Params: { orgId: string } }>(
      `/v1/admin/orgs/:orgId/${action}`,
      { preHandler: requireAdminPrincipal },
      async (request, reply) => {
        const orgId = parseOrgIdParam(request.params.orgId, reply);
        if (!orgId) return undefined;

        try {
          const record = await withIdempotency(deps.idempotencyStore, idempotencyKeyOf(request), async () => {
            const org = await applyTransition(deps.awsGateway, deps.provisioner, orgId, action);
            return { status: 200, body: OrgSchema.parse(org) };
          });
          reply.code(record.status);
          return record.body;
        } catch (error) {
          return transitionErrorResponse(error, reply);
        }
      },
    );
  }

  return app;
}
