import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { NoSuchInvitationError, OrgNotFoundError } from '../org/errors';
import { getOrgRecord } from '../org/record';
import { acceptSeat, assertDomainMatches, assertWellFormedEmail, findSeatByEmail, joinOpenInvite, type SeatRecord } from '../org/seat';
import type { OrgTokenStore } from './orgToken';

/** How long a magic link stays valid (#200's User Story 13: "I want my sign-in link to expire,
 * so that a forwarded email does not grant lasting access"). Generous enough that a real email
 * delivery delay never eats into it, short enough that a link sitting in an inbox for days is
 * no longer a standing credential. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export interface MagicLinkClaim {
  orgId: string;
  email: string;
  /** Set when `email` already resolved to an existing Seat at request time - `verifyMagicLink`
   * then just accepts that Seat. Absent for an Open Invite Link's first-ever use, where the Seat
   * is created only once the link is actually verified (`joinOpenInvite`), never at request
   * time - requesting a link must never itself create a Seat. */
  seatId?: string;
  expiresAt: number;
}

/** Issues and consumes magic-link claims. `InMemoryMagicLinkStore` is the only implementation
 * this ticket ships, mirroring `OrgTokenStore`'s own "in-memory now, a durable store is a later
 * ticket's concern" precedent (`auth/orgToken.ts`) - losing pending claims on a restart only
 * costs the visitor a re-request, never a safety property. */
export interface MagicLinkStore {
  issue(claim: MagicLinkClaim): Promise<string>;
  /** Single-use regardless of outcome: a token is deleted the moment this is called, whether or
   * not it was still valid, so a forwarded/reused link can never succeed twice (#200's User
   * Story 13). Returns `undefined` for an unknown or expired token. */
  consume(token: string, now?: number): Promise<MagicLinkClaim | undefined>;
}

export class InMemoryMagicLinkStore implements MagicLinkStore {
  private readonly claimsByToken = new Map<string, MagicLinkClaim>();

  async issue(claim: MagicLinkClaim): Promise<string> {
    const token = randomUUID();
    this.claimsByToken.set(token, claim);
    return token;
  }

  async consume(token: string, now = Date.now()): Promise<MagicLinkClaim | undefined> {
    const claim = this.claimsByToken.get(token);
    this.claimsByToken.delete(token);
    if (!claim) return undefined;
    if (claim.expiresAt < now) return undefined;
    return claim;
  }
}

export interface MagicLinkEmail {
  to: string;
  /** The full sign-in URL the client app's verify page reads its token from. */
  url: string;
}

/** Delivers a magic-link email. `ConsoleEmailSender` is the only implementation this ticket
 * ships - a real one is an SES send, out of scope here the same way a real `OrgTokenStore` is
 * (this app has no other outbound-email need yet to justify building that seam early). */
export interface EmailSender {
  sendMagicLink(email: MagicLinkEmail): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink({ to, url }: MagicLinkEmail): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[magic-link] ${to}: ${url}`);
  }
}

/**
 * Requests a magic link for `email` to sign in to `orgId` (#200's User Stories 12, 6, 4/5/7):
 * an existing Seat's email always qualifies; an email with no Seat yet only qualifies when the
 * org accepts Open Invite joins (ADR-0026) - and either way the email must match the org's own
 * prospect domain (`assertDomainMatches`), so a clearly-wrong-domain or clearly-uninvited email
 * is rejected here rather than only failing once someone tries the link.
 *
 * Deliberately creates no Seat itself: an Open Invite Link's first-ever use only actually joins
 * once `verifyMagicLink` runs, so a requested-but-never-opened link never occupies a seat.
 */
export async function requestMagicLink(
  gateway: AwsGateway,
  store: MagicLinkStore,
  emailSender: EmailSender,
  verifyUrlFor: (token: string) => string,
  orgId: string,
  email: string,
): Promise<void> {
  assertWellFormedEmail(email);

  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);

  const existingSeat = await findSeatByEmail(gateway, orgId, email);
  if (!existingSeat && org.inviteType !== 'open') {
    throw new NoSuchInvitationError(orgId, email);
  }
  assertDomainMatches(org, email);

  const token = await store.issue({
    orgId,
    email,
    seatId: existingSeat?.seatId,
    expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
  });
  await emailSender.sendMagicLink({ to: email, url: verifyUrlFor(token) });
}

export interface VerifiedMagicLink {
  orgId: string;
  seat: SeatRecord;
  orgToken: string;
}

/**
 * Verifies a magic-link `token` (#200's User Stories 6, 12): accepts the pending Seat it names,
 * or - for an Open Invite Link's first use, which named no Seat at request time - joins one now
 * via `joinOpenInvite`, re-running the exact same domain guard as the original request (a seat
 * count that filled up in between is still correctly rejected by that call's own seat-cap
 * check). Either way, mints a fresh org token scoped to that Seat.
 *
 * Returns `undefined` for an unknown, already-used, or expired token (#200's User Story 13) -
 * the route layer maps that to a clear "this link no longer works" response, not a generic 500.
 */
export async function verifyMagicLink(
  gateway: AwsGateway,
  store: MagicLinkStore,
  orgTokenStore: OrgTokenStore,
  token: string,
): Promise<VerifiedMagicLink | undefined> {
  const claim = await store.consume(token);
  if (!claim) return undefined;

  const seat = claim.seatId
    ? await acceptSeat(gateway, claim.orgId, claim.seatId)
    : await joinOpenInvite(gateway, claim.orgId, claim.email);

  const orgToken = randomUUID();
  await orgTokenStore.issue(claim.orgId, orgToken, seat.seatId);

  return { orgId: claim.orgId, seat, orgToken };
}
