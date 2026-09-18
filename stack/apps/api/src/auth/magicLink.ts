import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { TransactionCanceledError } from '@stack/aws-gateway';
import type { Env } from '../config/env';
import { OrgNotFoundError } from '../org/errors';
import { ORGS_TABLE, getOrgRecord } from '../org/record';
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

/** Issues and consumes magic-link claims. `InMemoryMagicLinkStore` is process-local (a lost
 * claim on restart only costs the visitor a re-request, never a safety property);
 * `DynamoMagicLinkStore` is the durable production adapter (#326) - both implement the same
 * contract so tests written against one are trustworthy evidence for the other's behavior. */
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

/** Magic-link claims share the org record store's single table (mirrors `DynamoIdempotencyStore`,
 * `idempotency/store.ts`, and the `dnslabel#<label>` reservation item, `org/record.ts`) under
 * `magiclink#<token>` - a distinct item type in the same table, not a table of its own. DynamoDB's
 * native `ttl` attribute is set to the claim's own `expiresAt` as a storage-cost backstop only -
 * correctness comes from the `expiresAt` check in `consume` below, never from native TTL sweep
 * timing, which is asynchronous and not immediate. */
export class DynamoMagicLinkStore implements MagicLinkStore {
  constructor(private readonly gateway: AwsGateway, private readonly table = ORGS_TABLE) {}

  async issue(claim: MagicLinkClaim): Promise<string> {
    const token = randomUUID();
    await this.gateway.dynamoDb.putItem({
      table: this.table,
      item: this.toItem(token, claim),
      // Guards a (vanishingly unlikely) randomUUID collision the same way every other write in
      // this table's neighborhood is guarded (`org/record.ts`), rather than trusting uniqueness
      // by construction alone.
      condition: { type: 'attribute_not_exists', attribute: 'pk' },
    });
    return token;
  }

  /**
   * Single-use even under two concurrent `consume` calls on the same token: both may read the
   * item, but only one's conditional delete below can succeed - the condition is re-checked
   * against the table at delete time, not against the value this call happened to read earlier.
   * The loser (and anyone calling with an already-consumed or never-issued token) gets
   * `undefined`, exactly like `InMemoryMagicLinkStore`'s single-threaded map delete.
   */
  async consume(token: string, now = Date.now()): Promise<MagicLinkClaim | undefined> {
    const item = await this.gateway.dynamoDb.getItem({ table: this.table, key: { pk: this.itemKey(token) } });
    if (!item) return undefined;

    try {
      await this.gateway.dynamoDb.transactWrite({
        items: [
          {
            delete: {
              table: this.table,
              key: { pk: this.itemKey(token) },
              condition: { type: 'attribute_exists', attribute: 'pk' },
            },
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof TransactionCanceledError)) throw error;
      // Another concurrent consume() already deleted it first.
      return undefined;
    }

    const claim = this.fromItem(item);
    if (claim.expiresAt < now) return undefined;
    return claim;
  }

  private toItem(token: string, claim: MagicLinkClaim): Record<string, unknown> {
    const item: Record<string, unknown> = {
      pk: this.itemKey(token),
      orgId: claim.orgId,
      email: claim.email,
      expiresAt: claim.expiresAt,
      ttl: Math.floor(claim.expiresAt / 1000),
    };
    if (claim.seatId !== undefined) item.seatId = claim.seatId;
    return item;
  }

  private fromItem(item: Record<string, unknown>): MagicLinkClaim {
    return {
      orgId: item.orgId as string,
      email: item.email as string,
      seatId: item.seatId as string | undefined,
      expiresAt: item.expiresAt as number,
    };
  }

  private itemKey(token: string): string {
    return `magiclink#${token}`;
  }
}

/** Chooses the in-memory or the durable `MagicLinkStore` from config (`STACK_AWS_MODE`), mirroring
 * `buildAwsGateway` (`aws/gateway.ts`) - the one place that decides is this factory, rather than
 * `index.ts` hardcoding `InMemoryMagicLinkStore` regardless of environment. */
export function buildMagicLinkStore(env: Env, gateway: AwsGateway): MagicLinkStore {
  if (env.STACK_AWS_MODE === 'fake') return new InMemoryMagicLinkStore();
  return new DynamoMagicLinkStore(gateway);
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
