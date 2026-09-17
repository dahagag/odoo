import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../problem';

/** What a resolved org token scopes the request to: always an org, and - once minted via the
 * magic-link flow (#200) rather than the admin bootstrap path - the specific Seat that signed
 * in, so a seat-scoped action (e.g. `inviteTargeted`) knows who the inviter is without trusting
 * a caller-supplied `seatId`. */
export interface OrgPrincipal {
  orgId: string;
  seatId?: string;
}

/** Resolves an opaque per-org token (docs/adr/0036) to the org (and, once minted through the
 * magic-link flow, the Seat) it scopes. `InMemoryOrgTokenStore` is the only implementation this
 * ticket ships - a DynamoDB-backed one reads the token off an actual org record. */
export interface OrgTokenStore {
  resolve(token: string): Promise<OrgPrincipal | undefined>;
  /** Mints a token scoped to `orgId` (and, once signed in via a magic link rather than the
   * admin bootstrap path, the specific `seatId`). Synchronous on the only implementation this
   * ticket ships, but declared `Promise<void> | void` so a later durable store can await a
   * real write without changing this interface. */
  issue(orgId: string, token: string, seatId?: string): Promise<void> | void;
}

export class InMemoryOrgTokenStore implements OrgTokenStore {
  private readonly principalsByToken = new Map<string, OrgPrincipal>();

  issue(orgId: string, token: string, seatId?: string): void {
    this.principalsByToken.set(token, { orgId, seatId });
  }

  async resolve(token: string): Promise<OrgPrincipal | undefined> {
    return this.principalsByToken.get(token);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    orgId?: string;
    seatId?: string;
  }
}

const BEARER_PREFIX = 'Bearer ';

/** Fastify `preHandler` factory for the org-facing surface (docs/adr/0036): requires a Bearer
 * org token and resolves it to `request.orgId`/`request.seatId`. Route handlers are responsible
 * for the "only its own org" check - this only proves *some* org token was presented. */
export function requireOrgToken(store: OrgTokenStore) {
  return async function orgTokenPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      await reply.code(401).send(problem(401, 'Missing org token', 'This endpoint requires an "Authorization: Bearer <org-token>" header.'));
      return;
    }
    const token = header.slice(BEARER_PREFIX.length);
    const principal = await store.resolve(token);
    if (!principal) {
      await reply.code(401).send(problem(401, 'Invalid org token'));
      return;
    }
    request.orgId = principal.orgId;
    request.seatId = principal.seatId;
  };
}

/** Route-level guard for a seat-scoped action (e.g. inviting a teammate): the org token must
 * have been minted for a specific Seat, not just an org. Returns a Problem Details body to send
 * with a 403 when it wasn't, or the resolved `seatId` when the request may proceed. */
export function requireSeatPrincipal(request: FastifyRequest): { seatId: string } | { problem: ReturnType<typeof problem> } {
  if (!request.seatId) {
    return { problem: problem(403, 'Forbidden', 'This action requires a Seat-scoped org token, signed in via a magic link.') };
  }
  return { seatId: request.seatId };
}

/** Route-level guard: the resolved token's org must match the org the request path names.
 * Returns a Problem Details body to send with a 403 when it doesn't, or `undefined` when the
 * request may proceed. */
export function forbidCrossOrgAccess(request: FastifyRequest, requestedOrgId: string) {
  if (request.orgId !== requestedOrgId) {
    return problem(403, 'Forbidden', 'An org token may only read its own org.');
  }
  return undefined;
}
