import type { AwsGateway } from '@stack/aws-gateway';
import { OrgActionSchema, OrgIdSchema, DnsSubdomainLabelSchema } from '@stack/domain';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { requireAdminPrincipal } from './auth/admin';
import type { EmailSender, MagicLinkStore } from './auth/magicLink';
import { InvalidMagicLinkError, requestMagicLink, verifyMagicLink } from './auth/magicLink';
import { forbidCrossOrgAccess, requireOrgToken, requireSeatPrincipal, type OrgTokenStore } from './auth/orgToken';
import { WakeRateLimitedError, type WakeRateLimiter } from './auth/wakeRateLimit';
import type { Env } from './config/env';
import { IdempotencyKeyReusedError, IdempotencyStillProcessingError } from './idempotency/errors';
import { idempotencyContext, requireIdempotencyKey, withIdempotency } from './idempotency/middleware';
import type { IdempotencyStore } from './idempotency/store';
import {
  AsleepStatusSchema,
  CostDashboardResponseSchema,
  CostSnapshotSchema,
  CreateOrgRequestSchema,
  ExtendOrgRequestSchema,
  InviteSeatRequestSchema,
  OrgSchema,
  OrgRegistrationSchema,
  PublicOrgSchema,
  RequestMagicLinkSchema,
  SeatSchema,
  SweepResultSchema,
  UpdateOrgRequestSchema,
  VerifyMagicLinkRequestSchema,
  VerifyMagicLinkResponseSchema,
} from './openapi/registry';
import { asleepStatus } from './org/asleep';
import { evaluateAlerts, getAlertState, publishAlerts, putAlertState } from './cost/alerts';
import { getLatestSnapshot, refreshSnapshot } from './cost/dashboard';
import { CostExplorerFailedError } from './cost/errors';
import {
  ConcurrentWriteError,
  CrossDomainInviteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  ExpiryNotSupportedError,
  IllegalTransitionError,
  InvalidDnsLabelError,
  InvalidExpiryDateError,
  MalformedEmailError,
  OpenInviteNotEnabledError,
  OrgNotFoundError,
  ProvisionerFailedError,
  SeatCapExceededError,
  SeatNotAcceptedError,
  SeatNotFoundError,
} from './org/errors';
import type { Provisioner } from './org/provisioner';
import { applyTransition, checkOrgStatus, createOrg, extendOrgExpiry, getOrgIdByDnsSubdomainLabel, getOrgRecord, updateDnsSubdomainLabel } from './org/record';
import type { OrgRecord } from './org/record';
import { inviteTargeted, listSeats } from './org/seat';
import { sweepAutoDestroy, sweepIdleSuspend } from './org/sweeps';
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
  /** #200's magic-link sign-in seam - `InMemoryMagicLinkStore` by default. */
  magicLinkStore: MagicLinkStore;
  emailSender: EmailSender;
  /** #200's per-org Wake rate limiter - `InMemoryWakeRateLimiter` by default. */
  wakeRateLimiter: WakeRateLimiter;
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
  if (error instanceof CostExplorerFailedError) {
    reply.code(502);
    return problem(502, 'The AWS Cost Explorer call failed', error.message);
  }
  if (error instanceof DnsLabelInUseError) {
    reply.code(409);
    return problem(409, 'dnsSubdomainLabel already in use', error.message);
  }
  if (error instanceof InvalidDnsLabelError) {
    reply.code(400);
    return problem(400, 'Could not derive a valid dnsSubdomainLabel from name', error.message);
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
  if (error instanceof ExpiryNotSupportedError) {
    reply.code(409);
    return problem(409, 'Org has no expiryDate to extend', error.message);
  }
  if (error instanceof InvalidExpiryDateError) {
    reply.code(400);
    return problem(400, 'additionalDays would produce an out-of-range date', error.message);
  }
  if (error instanceof MalformedEmailError) {
    reply.code(400);
    return problem(400, 'Malformed email', error.message);
  }
  if (error instanceof CrossDomainInviteError) {
    reply.code(403);
    return problem(403, 'Email does not match this org\'s prospect domain', error.message);
  }
  if (error instanceof OpenInviteNotEnabledError) {
    reply.code(409);
    return problem(409, 'This org does not accept Open Invite Link joins', error.message);
  }
  if (error instanceof SeatCapExceededError) {
    reply.code(409);
    return problem(409, 'Org has no remaining seats', error.message);
  }
  if (error instanceof SeatNotFoundError) {
    reply.code(404);
    return problem(404, 'No such seat', error.message);
  }
  if (error instanceof SeatNotAcceptedError) {
    reply.code(403);
    return problem(403, 'Inviting seat has not accepted yet', error.message);
  }
  if (error instanceof InvalidMagicLinkError) {
    reply.code(404);
    return problem(404, 'This link no longer works', error.message);
  }
  if (error instanceof WakeRateLimitedError) {
    reply.code(429).header('Retry-After', String(error.retryAfterSeconds));
    return problem(429, 'Too many wake attempts for this org', error.message);
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

/** Every idempotent admin write shares this shape: run `op` under `withIdempotency`, serialize
 * its result through `schema`, and map a thrown `org/errors.ts` error to its Problem Details
 * response - anything else rethrows for Fastify's default 500. One definition instead of each
 * route re-deriving it, so a future change to that shape (e.g. the error mapping) can't drift
 * between routes. */
async function respondWithIdempotentResult<T>(
  deps: ServerDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  schema: { parse: (value: unknown) => T },
  op: () => Promise<T>,
): Promise<unknown> {
  try {
    const record = await withIdempotency(deps.idempotencyStore, idempotencyContext(request), async () => {
      const result = await op();
      return { status, body: schema.parse(result) };
    });
    reply.code(record.status);
    return record.body;
  } catch (error) {
    const known = knownOrgErrorResponse(error, reply);
    if (known) return known;
    throw error;
  }
}

/** Every idempotent admin write that resolves to a single `OrgRecord` (create, relabel, a
 * lifecycle action, check-status). */
function respondWithOrg(
  deps: ServerDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  op: () => Promise<OrgRecord>,
): Promise<unknown> {
  return respondWithIdempotentResult(deps, request, reply, status, OrgSchema, op);
}

/** For an idempotent write whose success response has no body (#200's magic-link request:
 * always a bare 202, so as never to reveal whether a given email actually has a Seat) - `op`'s
 * `void` return still flows through `withIdempotency`'s own claim/replay machinery exactly like
 * every other mutating route's. */
const NoContentSchema = { parse: (): undefined => undefined };

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

    return respondWithOrg(deps, request, reply, 201, () => createOrg(deps.awsGateway, parsed.data, {
      defaultRegion: deps.env.DEFAULT_ORG_REGION,
      trialDurationDays: deps.env.TRIAL_DEFAULT_DURATION_DAYS,
    }));
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

      return respondWithOrg(deps, request, reply, 200, () => updateDnsSubdomainLabel(deps.awsGateway, orgId, parsed.data.dnsSubdomainLabel));
    },
  );

  for (const action of OrgActionSchema.options) {
    app.post<{ Params: { orgId: string } }>(
      `/v1/admin/orgs/:orgId/${action}`,
      { preHandler: requireAdminPrincipal },
      async (request, reply) => {
        const orgId = parseOrgIdParam(request.params.orgId, reply);
        if (!orgId) return undefined;

        return respondWithOrg(deps, request, reply, 200, () => applyTransition(deps.awsGateway, deps.provisioner, orgId, action));
      },
    );
  }

  // #312: pushes a Trial Org's expiryDate out by additionalDays. Extension's own authorisation
  // (the sales-methodology qualification gate) is Odoo's own concern (ADR-0034) - this route
  // performs the write once Odoo has already decided to allow it, the same trust boundary every
  // other admin route already assumes.
  app.post<{ Params: { orgId: string } }>(
    '/v1/admin/orgs/:orgId/extend',
    { preHandler: requireAdminPrincipal },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;

      const parsed = ExtendOrgRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return problem(400, 'Malformed request body', parsed.error.message);
      }

      return respondWithOrg(deps, request, reply, 200, () => extendOrgExpiry(deps.awsGateway, orgId, parsed.data.additionalDays));
    },
  );

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

      return respondWithOrg(deps, request, reply, 200, () => checkOrgStatus(deps.awsGateway, deps.provisioner, orgId));
    },
  );

  // Production entry points for the idle-suspend and auto-destroy sweeps (#282): reachable by an
  // external scheduler on a recurring cadence, mirroring check-status's own "production entry
  // point" role above but batch-scoped rather than per-org, so neither route takes an `orgId`.
  app.post('/v1/admin/sweeps/idle-suspend', { preHandler: requireAdminPrincipal }, async (request, reply) => respondWithIdempotentResult(
    deps, request, reply, 200, SweepResultSchema, () => sweepIdleSuspend(deps.awsGateway, deps.provisioner),
  ));

  app.post('/v1/admin/sweeps/auto-destroy', { preHandler: requireAdminPrincipal }, async (request, reply) => respondWithIdempotentResult(
    deps, request, reply, 200, SweepResultSchema, () => sweepAutoDestroy(deps.awsGateway, deps.provisioner),
  ));

  // Cost dashboard (this ticket, #198): a plain read of the latest daily-refresh snapshot
  // (docs/adr/0030 - never refreshed on open), and the daily refresh's own production entry
  // point, mirroring the sweeps' "reachable by an external scheduler" shape.
  app.get('/v1/admin/cost/dashboard', { preHandler: requireAdminPrincipal }, async (request, reply) => {
    const snapshot = await getLatestSnapshot(deps.awsGateway);
    return CostDashboardResponseSchema.parse(
      snapshot ? { available: true, snapshot } : { available: false },
    );
  });

  app.post('/v1/admin/cost/refresh-snapshot', { preHandler: requireAdminPrincipal }, async (request, reply) => respondWithIdempotentResult(
    deps, request, reply, 200, CostSnapshotSchema, async () => {
      const now = new Date();
      const snapshot = await refreshSnapshot(deps.awsGateway, {
        creditAmount: deps.env.AWS_COST_CREDIT_AMOUNT,
        creditStartDate: new Date(deps.env.AWS_COST_CREDIT_START_DATE),
        groupByTagKey: deps.env.AWS_COST_TAG_KEY,
        projectionHorizonDays: deps.env.AWS_COST_ALERT_HORIZON_DAYS,
      }, now);

      // Alerts are evaluated on the same daily cadence as the snapshot (this ticket's
      // Implementation Decisions) - a no-op when no topic is configured, exactly like every
      // other AWS-wiring-configured switch in this file.
      if (deps.env.COST_ALERT_SNS_TOPIC_ARN) {
        const alertState = await getAlertState(deps.awsGateway);
        const { alerts, nextState } = evaluateAlerts(alertState, snapshot, {
          spendThresholds: deps.env.AWS_COST_ALERT_SPEND_THRESHOLDS,
          horizonDays: deps.env.AWS_COST_ALERT_HORIZON_DAYS,
        }, now);
        if (alerts.length > 0) {
          await publishAlerts(deps.awsGateway, deps.env.COST_ALERT_SNS_TOPIC_ARN, alerts);
          await putAlertState(deps.awsGateway, nextState);
        }
      }

      return snapshot;
    },
  ));

  // ---- The org-facing surface: seats and invitations (#200) ------------------------------------

  app.get<{ Params: { orgId: string } }>(
    '/v1/org/:orgId/seats',
    { preHandler: requireOrgToken(deps.orgTokenStore) },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;
      const forbidden = forbidCrossOrgAccess(request, orgId);
      if (forbidden) {
        reply.code(403);
        return forbidden;
      }
      const seats = await listSeats(deps.awsGateway, orgId);
      return seats.map((seat) => SeatSchema.parse(seat));
    },
  );

  app.post<{ Params: { orgId: string } }>(
    '/v1/org/:orgId/seats/invite',
    { preHandler: requireOrgToken(deps.orgTokenStore) },
    async (request, reply) => {
      const orgId = parseOrgIdParam(request.params.orgId, reply);
      if (!orgId) return undefined;
      const forbidden = forbidCrossOrgAccess(request, orgId);
      if (forbidden) {
        reply.code(403);
        return forbidden;
      }
      const seatPrincipal = requireSeatPrincipal(request);
      if ('problem' in seatPrincipal) {
        reply.code(403);
        return seatPrincipal.problem;
      }
      const parsed = InviteSeatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return problem(400, 'Malformed request body', parsed.error.message);
      }
      return respondWithIdempotentResult(
        deps, request, reply, 201, SeatSchema,
        () => inviteTargeted(deps.awsGateway, orgId, seatPrincipal.seatId, parsed.data.email),
      );
    },
  );

  // ---- Magic-link sign-in (#200) ----------------------------------------------------------------

  app.post<{ Params: { orgId: string } }>('/v1/org/:orgId/auth/magic-links', async (request, reply) => {
    const orgId = parseOrgIdParam(request.params.orgId, reply);
    if (!orgId) return undefined;
    const parsed = RequestMagicLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return problem(400, 'Malformed request body', parsed.error.message);
    }
    return respondWithIdempotentResult(deps, request, reply, 202, NoContentSchema, () => requestMagicLink(
      deps.awsGateway,
      deps.magicLinkStore,
      deps.emailSender,
      (token) => `${deps.env.CLIENT_APP_BASE_URL}/sign-in/verify?token=${encodeURIComponent(token)}`,
      orgId,
      parsed.data.email,
    ));
  });

  app.post('/v1/auth/magic-links/verify', async (request, reply) => {
    const parsed = VerifyMagicLinkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return problem(400, 'Malformed request body', parsed.error.message);
    }
    return respondWithIdempotentResult(
      deps, request, reply, 200, VerifyMagicLinkResponseSchema,
      () => verifyMagicLink(deps.awsGateway, deps.magicLinkStore, deps.orgTokenStore, parsed.data.token),
    );
  });

  // ---- The public surface: asleep/Wake-Up (#200) -------------------------------------------------

  app.get<{ Params: { dnsSubdomainLabel: string } }>('/v1/public/orgs/by-dns-label/:dnsSubdomainLabel', async (request, reply) => {
    const labelResult = DnsSubdomainLabelSchema.safeParse(request.params.dnsSubdomainLabel);
    if (!labelResult.success) {
      reply.code(404);
      return problem(404, 'No org reserves this label');
    }
    const orgId = await getOrgIdByDnsSubdomainLabel(deps.awsGateway, labelResult.data);
    if (!orgId) {
      reply.code(404);
      return problem(404, 'No org reserves this label');
    }
    const org = await getOrgRecord(deps.awsGateway, orgId);
    if (!org) {
      reply.code(404);
      return problem(404, 'No such org');
    }
    return PublicOrgSchema.parse({ orgId: org.orgId, name: org.name });
  });

  app.get<{ Params: { orgId: string } }>('/v1/public/orgs/:orgId/asleep-status', async (request, reply) => {
    const orgId = parseOrgIdParam(request.params.orgId, reply);
    if (!orgId) return undefined;
    const org = await getOrgRecord(deps.awsGateway, orgId);
    if (!org) {
      reply.code(404);
      return problem(404, 'No such org');
    }
    return AsleepStatusSchema.parse(asleepStatus(org));
  });

  app.post<{ Params: { orgId: string } }>('/v1/public/orgs/:orgId/wake', async (request, reply) => {
    const orgId = parseOrgIdParam(request.params.orgId, reply);
    if (!orgId) return undefined;

    return respondWithIdempotentResult(deps, request, reply, 200, AsleepStatusSchema, async () => {
      // Checked *inside* the idempotent op, not before it: a genuine retry of the same click
      // (the same Idempotency-Key) replays the stored result without calling `attempt()` again,
      // so it can never itself consume another slot in the window - only a distinct new attempt
      // (a fresh key, e.g. a second real click) does.
      const attempt = deps.wakeRateLimiter.attempt(orgId);
      if (!attempt.allowed) throw new WakeRateLimitedError(orgId, attempt.retryAfterSeconds);

      let org = await getOrgRecord(deps.awsGateway, orgId);
      if (!org) throw new OrgNotFoundError(orgId);
      // A no-op, not an error, once the org is no longer suspended - a slow double-click or a
      // second open tab racing this one is completely ordinary (mirrors `controllers/asleep.py`'s
      // own `if trial_org.state == 'suspended':` guard).
      if (org.state === 'suspended') {
        org = await applyTransition(deps.awsGateway, deps.provisioner, orgId, 'wake');
      }
      return asleepStatus(org);
    });
  });

  return app;
}
