import type { AwsGateway } from '@stack/aws-gateway';
import { OrgActionSchema, OrgIdSchema } from '@stack/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { requireAdminPrincipal } from './auth/admin';
import { forbidCrossOrgAccess, requireOrgToken, type OrgTokenStore } from './auth/orgToken';
import type { Env } from './config/env';
import { IdempotencyKeyReusedError, IdempotencyStillProcessingError } from './idempotency/errors';
import { idempotencyContext, requireIdempotencyKey, withIdempotency } from './idempotency/middleware';
import type { IdempotencyStore } from './idempotency/store';
import { CreateOrgRequestSchema, OrgSchema, OrgRegistrationSchema, UpdateOrgRequestSchema } from './openapi/registry';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  IllegalTransitionError,
  OrgNotFoundError,
  ProvisionerFailedError,
} from './org/errors';
import type { Provisioner } from './org/provisioner';
import { applyTransition, checkOrgStatus, createOrg, updateDnsSubdomainLabel } from './org/record';
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
 * response. Returns `undefined` for anything else - every route rethrows in that case, for
 * Fastify's default 500: a transition's own `ProvisionerFailedError` is one of the errors this
 * maps, so an unrecognized error reaching a transition route is *not* a provisioner failure by
 * construction, and reporting it as a plain 500 rather than a misleading 502 is correct. */
function knownOrgErrorResponse(error: unknown, reply: FastifyReply): ReturnType<typeof problem> | undefined {
  if (error instanceof IdempotencyKeyReusedError) {
    reply.code(409);
    return problem(409, 'Idempotency-Key reused for a different request', error.message);
  }
  if (error instanceof IdempotencyStillProcessingError) {
    reply.code(409).header('Retry-After', String(error.retryAfterSeconds));
    return problem(409, 'Idempotency-Key is still processing', error.message);
  }
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
  if (error instanceof ProvisionerFailedError) {
    // A provisioner failure is an upstream dependency failing, not this service's own fault,
    // and this ticket's Acceptance Criteria only promises the state change doesn't happen -
    // reported as 502 rather than crashing the request as an unhandled 500. Deliberately
    // narrower than "anything a transition route throws": a later failure in the *same* call
    // (e.g. the conditional DynamoDB write after the provisioner already succeeded) is a
    // different kind of problem and must not be mislabeled as the provisioner's fault
    // (CodeRabbit, PR #284) - see `applyTransition`'s own wrapping in `org/record.ts`.
    reply.code(502);
    return problem(502, 'The provisioner failed; no state change was made', error.message);
  }
  return undefined;
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
      const record = await withIdempotency(deps.idempotencyStore, idempotencyContext(request), async () => {
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
        const record = await withIdempotency(deps.idempotencyStore, idempotencyContext(request), async () => {
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
          const record = await withIdempotency(deps.idempotencyStore, idempotencyContext(request), async () => {
            const org = await applyTransition(deps.awsGateway, deps.provisioner, orgId, action);
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
  }

  // Production entry point for `Provisioner.checkStatus` (#298, #281): reachable by an external
  // scheduler for each org it knows has a job running - a per-org poll rather than a batch sweep,
  // this ticket's own "stay decoupled from #282 unless the chosen design genuinely needs the same
  // kind of query" - since checkStatus is a safe no-op on any org that isn't actually running one.
  app.post<{ Params: { orgId: string } }>(
    '/v1/admin/orgs/:orgId/check-status',
    { preHandler: requireAdminPrincipal },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;

      try {
        const record = await withIdempotency(deps.idempotencyStore, idempotencyContext(request), async () => {
          const org = await checkOrgStatus(deps.awsGateway, deps.provisioner, orgId);
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

  return app;
}
