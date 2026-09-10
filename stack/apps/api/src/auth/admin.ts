import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../problem';

/**
 * The administration surface authenticates with SigV4 (docs/adr/0036), verified by the front
 * door (API Gateway/ALB IAM auth) before a request ever reaches this app - this app has no AWS
 * account credential to verify a SigV4 signature against, and shouldn't: that would mean holding
 * the same trust the front door already carries. Its own responsibility is narrower and
 * app-level: refuse to treat a request as admin-authenticated unless it carries the trusted
 * principal header the front door injects (`x-stack-admin-principal`) - so a request whose only
 * credential is a per-org Bearer token (docs/adr/0036's *other*, deliberately less trusted,
 * surface) is refused here even if it somehow reached this process at all, per this ticket's
 * Testing Decisions: "an org token must be rejected on the administration surface."
 *
 * The `x-stack-admin-principal` contract itself - which trusted proxy sets it, and how a
 * client-supplied copy gets stripped before this app sees it - is deployment topology, decided
 * with the AWS deploy pipeline (#202), not here.
 */
export interface AdminPrincipal {
  arn: string;
}

const ADMIN_PRINCIPAL_HEADER = 'x-stack-admin-principal';

declare module 'fastify' {
  interface FastifyRequest {
    adminPrincipal?: AdminPrincipal;
  }
}

export async function requireAdminPrincipal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers[ADMIN_PRINCIPAL_HEADER];
  if (!header || Array.isArray(header)) {
    await reply.code(401).send(problem(401, 'Missing admin principal', 'This endpoint requires SigV4 authentication at the front door.'));
    return;
  }
  request.adminPrincipal = { arn: header };
}
