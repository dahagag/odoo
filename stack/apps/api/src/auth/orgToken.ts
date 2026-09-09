import type { FastifyReply, FastifyRequest } from 'fastify';

/** Resolves an opaque per-org token (docs/adr/0036) to the org it scopes. `InMemoryOrgTokenStore`
 * is the only implementation this ticket ships - a DynamoDB-backed one reads the token off an
 * actual org record, and org records don't exist until the lifecycle port (#196). The seam is
 * ready for that ticket to implement without touching the auth middleware below. */
export interface OrgTokenStore {
  resolveOrgId(token: string): Promise<string | undefined>;
}

export class InMemoryOrgTokenStore implements OrgTokenStore {
  private readonly tokensByOrgId = new Map<string, string>();

  issue(orgId: string, token: string): void {
    this.tokensByOrgId.set(token, orgId);
  }

  async resolveOrgId(token: string): Promise<string | undefined> {
    return this.tokensByOrgId.get(token);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    orgId?: string;
  }
}

const BEARER_PREFIX = 'Bearer ';

/** Fastify `preHandler` factory for the org-facing surface (docs/adr/0036): requires a Bearer
 * org token and resolves it to `request.orgId`. Route handlers are responsible for the
 * "only its own org" check - this only proves *some* org token was presented. */
export function requireOrgToken(store: OrgTokenStore) {
  return async function orgTokenPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      await reply.code(401).send({
        type: 'about:blank',
        title: 'Missing org token',
        status: 401,
        detail: 'This endpoint requires an "Authorization: Bearer <org-token>" header.',
      });
      return;
    }
    const token = header.slice(BEARER_PREFIX.length);
    const orgId = await store.resolveOrgId(token);
    if (!orgId) {
      await reply.code(401).send({
        type: 'about:blank',
        title: 'Invalid org token',
        status: 401,
      });
      return;
    }
    request.orgId = orgId;
  };
}

/** Route-level guard: the resolved token's org must match the org the request path names.
 * Returns a Problem Details body to send with a 403 when it doesn't, or `undefined` when the
 * request may proceed. */
export function forbidCrossOrgAccess(request: FastifyRequest, requestedOrgId: string) {
  if (request.orgId !== requestedOrgId) {
    return {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'An org token may only read its own org.',
    };
  }
  return undefined;
}
