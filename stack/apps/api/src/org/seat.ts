import { randomUUID } from 'node:crypto';
import type { AwsGateway } from '@stack/aws-gateway';
import { ConditionalCheckFailedError, TransactionCanceledError } from '@stack/aws-gateway';
import {
  CrossDomainInviteError,
  MalformedEmailError,
  OpenInviteNotEnabledError,
  OrgNotFoundError,
  SeatCapExceededError,
  SeatNotAcceptedError,
  SeatNotFoundError,
} from './errors';
import { compact, getOrgRecord, ORGS_TABLE, orgPk, type OrgRecord } from './record';

/** Seat items share the org's own `pk` and are distinguished by `sk` (`docs/dynamodb-access-
 * patterns.md`'s key schema), so "list seats for an org" is a `Query` on `pk` alone with no GSI
 * needed. */
function seatSk(seatId: string): string {
  return `seat#${seatId}`;
}

/** Pragmatic RFC-5322-ish check, ported from `hosting.trial.org.seat._EMAIL_RE`
 * (custom_addons/hosting_admin/models/seat.py): local part of at least one char, an '@', then a
 * domain shaped like a real hostname - good enough to reject an obviously-malformed invite email
 * without pulling in a dedicated email-validation dependency. */
const EMAIL_RE = /^[^@\s]+@(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export interface SeatRecord {
  seatId: string;
  orgId: string;
  email: string;
  state: 'invited' | 'accepted';
  /** The seat that invited this one - absent for a Seat created via an Open Invite Link join,
   * which is confirmed by construction rather than vouched for by an existing member. */
  invitedBySeatId?: string;
}

function toItem(seat: SeatRecord): Record<string, unknown> {
  return compact({ pk: orgPk(seat.orgId), sk: seatSk(seat.seatId), ...seat });
}

function fromItem(item: Record<string, unknown>): SeatRecord {
  const { pk: _pk, sk: _sk, ...rest } = item;
  return rest as unknown as SeatRecord;
}

export async function getSeat(gateway: AwsGateway, orgId: string, seatId: string): Promise<SeatRecord | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId), sk: seatSk(seatId) } });
  return item ? fromItem(item) : undefined;
}

/** Every Seat for an org, for the client app's own status view (#200's User Story 3: "I want
 * to see who has a seat on my org"). A plain `Query` on the org's `pk` with a `seat#` sort-key
 * prefix - no GSI needed (`docs/dynamodb-access-patterns.md`) - since the system-wide seat cap
 * (`SYSTEM_WIDE_SEAT_CAP`, `@stack/domain`) keeps this a small, single-page read in practice. */
export async function listSeats(gateway: AwsGateway, orgId: string): Promise<SeatRecord[]> {
  const seats: SeatRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await gateway.dynamoDb.query({
      table: ORGS_TABLE,
      partitionKey: { name: 'pk', value: orgPk(orgId) },
      sortKeyPrefix: { name: 'sk', value: 'seat#' },
      cursor,
    });
    for (const item of page.items) seats.push(fromItem(item));
    cursor = page.nextCursor;
  } while (cursor);
  return seats;
}

/** Finds the Seat (if any) already invited under `email` for this org - the magic-link
 * sign-in flow's own lookup (#200): "does this email already have a Seat here". Case-
 * insensitive, matching how `assertDomainMatches` already compares domains. Reads the same
 * small per-org page `listSeats` does; a dedicated email index would be premature at the
 * system-wide 25-seat cap this store already enforces. */
export async function findSeatByEmail(gateway: AwsGateway, orgId: string, email: string): Promise<SeatRecord | undefined> {
  const seats = await listSeats(gateway, orgId);
  return seats.find((seat) => seat.email.toLowerCase() === email.toLowerCase());
}

/** Checked before any seat is created (this ticket's Acceptance Criteria: "a malformed email is
 * rejected before any seat is created") - a pure, no-I/O check, so it never races anything.
 * Exported so `auth/magicLink.ts`'s sign-in request path applies the identical shape check
 * before ever looking an email up (#200). */
export function assertWellFormedEmail(email: string): void {
  if (!EMAIL_RE.test(email)) throw new MalformedEmailError(email);
}

/** Both invitation paths guard identically against the org's own prospect domain (`OrgRecord.
 * domain`) - ADR-0026: "this keeps the same safety property the Targeted Invite path always
 * had". Exported so `auth/magicLink.ts`'s sign-in request path (#200) applies the identical
 * guard before ever minting a link, rather than re-deriving it. */
export function assertDomainMatches(org: OrgRecord, email: string): void {
  const emailDomain = email.split('@').pop() ?? '';
  if (emailDomain.toLowerCase() !== org.domain.toLowerCase()) {
    throw new CrossDomainInviteError(org.orgId, email);
  }
}

/**
 * Writes the new seat item and increments the org's `seatsUsed` counter in one `transactWrite`
 * (`docs/dynamodb-access-patterns.md`'s "seat count against the cap" pattern) - the invariant
 * this ticket exists for cannot rely on a separate read-then-write, since two concurrent calls
 * could each read a `seatsUsed` that still has room and both commit past the cap. The condition's
 * threshold (`org.seatsTotal - 1`) is derived from the org record this call already read: safe
 * because `seatsTotal` is immutable once an org is issued (`docs/contexts/hosting/CONTEXT.md`'s
 * Seat entry: "set per-trial at issuance") - the access-patterns doc's caveat about this being
 * "the lifecycle port's job" is exactly this.
 */
async function createSeatTransactionally(gateway: AwsGateway, org: OrgRecord, seat: SeatRecord): Promise<SeatRecord> {
  try {
    await gateway.dynamoDb.transactWrite({
      items: [
        {
          put: {
            table: ORGS_TABLE,
            item: toItem(seat),
            condition: { type: 'attribute_not_exists', attribute: 'pk' },
          },
        },
        {
          increment: {
            table: ORGS_TABLE,
            key: { pk: orgPk(org.orgId) },
            attribute: 'seatsUsed',
            delta: 1,
            condition: { type: 'numeric_less_than_or_equal', attribute: 'seatsUsed', value: org.seatsTotal - 1 },
          },
        },
      ],
    });
  } catch (error) {
    if (error instanceof TransactionCanceledError && error.cancellationReasons[1]) {
      throw new SeatCapExceededError(org.orgId);
    }
    throw error;
  }
  return seat;
}

/**
 * A Targeted Invite (ADR-0026) from an existing, `accepted` seat to a same-domain teammate (this
 * ticket's What to build/Acceptance Criteria). The new seat starts `invited`.
 */
export async function inviteTargeted(gateway: AwsGateway, orgId: string, inviterSeatId: string, email: string): Promise<SeatRecord> {
  assertWellFormedEmail(email);

  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);
  assertDomainMatches(org, email);

  const inviter = await getSeat(gateway, orgId, inviterSeatId);
  if (!inviter) throw new SeatNotFoundError(orgId, inviterSeatId);
  // Only an accepted seat may invite (this ticket's Acceptance Criteria: "an invited-but-not-
  // yet-accepted seat cannot invite") - mirrors `action_invite`'s own `state != 'accepted'` guard.
  if (inviter.state !== 'accepted') throw new SeatNotAcceptedError(orgId, inviterSeatId);

  const seat: SeatRecord = { seatId: randomUUID(), orgId, email, state: 'invited', invitedBySeatId: inviterSeatId };
  return createSeatTransactionally(gateway, org, seat);
}

/**
 * A prospect joining through an Open Invite Link (ADR-0026): the first (and every subsequent)
 * use of the link creates an already-`accepted` seat directly, gated only by domain match - no
 * proof-of-receipt guard exists yet (ADR-0032, deferred to the org-facing login layer, #200).
 * Rejected outright when the org wasn't issued for open invites (this ticket's Acceptance
 * Criteria: "joining via the open-invite path on an org configured for targeted invites only is
 * rejected").
 */
export async function joinOpenInvite(gateway: AwsGateway, orgId: string, email: string): Promise<SeatRecord> {
  assertWellFormedEmail(email);

  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new OrgNotFoundError(orgId);
  if (org.inviteType !== 'open') throw new OpenInviteNotEnabledError(orgId);
  assertDomainMatches(org, email);

  const seat: SeatRecord = { seatId: randomUUID(), orgId, email, state: 'accepted' };
  return createSeatTransactionally(gateway, org, seat);
}

/** Moves a still-`invited` seat to `accepted` - the prerequisite for it to invite anyone else
 * (this ticket's Acceptance Criteria: "after accepting, it can"). Idempotent: accepting an
 * already-`accepted` seat is a no-op rather than an error, since nothing about "you are now a
 * member" changes by calling it twice. */
export async function acceptSeat(gateway: AwsGateway, orgId: string, seatId: string): Promise<SeatRecord> {
  const seat = await getSeat(gateway, orgId, seatId);
  if (!seat) throw new SeatNotFoundError(orgId, seatId);
  if (seat.state === 'accepted') return seat;

  try {
    await gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(orgId), sk: seatSk(seatId) },
      set: { state: 'accepted' },
      condition: { type: 'attribute_equals', attribute: 'state', value: 'invited' },
    });
  } catch (error) {
    // Two genuinely concurrent acceptances can both pass the `state === 'accepted'` check above
    // before either writes - the loser's conditional update then fails not because anything is
    // wrong, but because the winner already got there first (CodeRabbit, PR #296). Re-reading and
    // treating "it's accepted now" as success is what actually delivers the idempotency this
    // function's own docstring promises, rather than leaking the race as a raw error.
    if (error instanceof ConditionalCheckFailedError) {
      const current = await getSeat(gateway, orgId, seatId);
      if (current?.state === 'accepted') return current;
    }
    throw error;
  }
  return { ...seat, state: 'accepted' };
}
