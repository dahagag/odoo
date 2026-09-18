import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { OrgNotFoundError } from '../org/errors';
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
    // Only `consume` deletes an entry - a requested-but-never-opened link would otherwise
    // accumulate for the process's entire life, on a route any visitor can call repeatedly
    // (CodeRabbit, PR #318).
    const now = Date.now();
    for (const [existingToken, existingClaim] of this.claimsByToken) {
      if (existingClaim.expiresAt < now) this.claimsByToken.delete(existingToken);
    }
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

/** Delivers a magic-link email. `ConsoleEmailSender` is process-local, for local/test runs;
 * `SesEmailSender` (`sesEmailSender.ts`, #327) is the durable production adapter - both
 * implement this same contract so tests written against one are trustworthy evidence for the
 * other's behavior, mirroring `MagicLinkStore` above. */
export interface EmailSender {
  sendMagicLink(email: MagicLinkEmail): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink({ to }: MagicLinkEmail): Promise<void> {
    // Never logs `url` - it carries the live, single-use token (CWE-532, CodeRabbit PR #318):
    // anything with read access to this process's logs could sign in as that Seat for the
    // token's remaining lifetime otherwise.
    // eslint-disable-next-line no-console
    console.log(`[magic-link] sent to ${to}`);
  }
}

/**
 * Requests a magic link for `email` to sign in to `orgId` (#200's User Stories 12, 6, 4/5/7):
 * an existing Seat's email always qualifies; an email with no Seat yet only qualifies when the
 * org accepts Open Invite joins (ADR-0026) - and either way the email must match the org's own
 * prospect domain (`assertDomainMatches`), checked *first*, so a clearly-wrong-domain email
 * always gets the clear 403 rejection #200's own User Stories 5/7 ask for - never masked by the
 * no-invitation case below, whichever org type it's checked against.
 *
 * A right-domain email with no invitation resolves silently instead of throwing (CodeRabbit,
 * PR #318): the alternative - a 404 - would let an external caller enumerate which right-domain
 * addresses have a Seat on a targeted-only org (CWE-204), the exact thing this function's own
 * "always 202, never reveals whether a given email has a Seat" contract exists to prevent.
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

  assertDomainMatches(org, email);

  const existingSeat = await findSeatByEmail(gateway, orgId, email);
  if (!existingSeat && org.inviteType !== 'open') return;

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

/** Raised by `verifyMagicLink` for an unknown, already-used, or expired token (#200's User
 * Story 13) - a single error type covering all three, since the route layer's "this link no
 * longer works" response is deliberately the same for each (never revealing which). */
export class InvalidMagicLinkError extends Error {
  constructor() {
    super('This magic-link token is unknown, already used, or expired.');
    this.name = 'InvalidMagicLinkError';
  }
}

/**
 * Verifies a magic-link `token` (#200's User Stories 6, 12): accepts the pending Seat it names,
 * or - for an Open Invite Link's first use, which named no Seat at request time - joins one now
 * via `joinOpenInvite`, re-running the exact same domain guard as the original request (a seat
 * count that filled up in between is still correctly rejected by that call's own seat-cap
 * check). Either way, mints a fresh org token scoped to that Seat.
 */
export async function verifyMagicLink(
  gateway: AwsGateway,
  store: MagicLinkStore,
  orgTokenStore: OrgTokenStore,
  token: string,
): Promise<VerifiedMagicLink> {
  const claim = await store.consume(token);
  if (!claim) throw new InvalidMagicLinkError();

  const seat = claim.seatId
    ? await acceptSeat(gateway, claim.orgId, claim.seatId)
    : await joinOpenInvite(gateway, claim.orgId, claim.email);

  const orgToken = randomUUID();
  await orgTokenStore.issue(claim.orgId, orgToken, seat.seatId);

  return { orgId: claim.orgId, seat, orgToken };
}
