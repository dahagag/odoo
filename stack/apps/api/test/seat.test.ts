import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import {
  CrossDomainInviteError,
  MalformedEmailError,
  OpenInviteNotEnabledError,
  OrgNotFoundError,
  SeatCapExceededError,
  SeatNotAcceptedError,
  SeatNotFoundError,
} from '../src/org/errors';
import { createOrg, getOrgRecord, orgPk, ORGS_TABLE, type CreateOrgInput } from '../src/org/record';
import { acceptSeat, getSeat, inviteTargeted, joinOpenInvite } from '../src/org/seat';

const CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };

let dnsLabelSequence = 0;

function orgInput(overrides: Partial<CreateOrgInput> = {}): CreateOrgInput {
  dnsLabelSequence += 1;
  return {
    type: 'trial',
    name: 'Acme Trial',
    domain: 'acme.example.com',
    seatsTotal: 3,
    dnsSubdomainLabel: `acme-trial-${dnsLabelSequence}`,
    ...overrides,
  };
}

/** Stands in for the Trial Org's first Seat (created out of this ticket's scope, per its
 * parent's Invitation Paths decision - mirrors `test_trial_org_seat_invite.py`'s own
 * `first_seat` fixture) - already `accepted`, so it can invite. */
async function acceptedFirstSeat(gateway: InMemoryAwsGateway, orgId: string, email = 'first@acme.example.com') {
  const seat = await inviteTargetedBootstrap(gateway, orgId, email);
  return acceptSeat(gateway, orgId, seat.seatId);
}

/** `inviteTargeted` requires an existing accepted inviter, which the very first Seat can't
 * supply - minting a Trial Org's first member is explicitly out of this ticket's scope
 * (`custom_addons/hosting_admin/tests/test_trial_org_seat_invite.py`'s own fixture comment).
 * This fixture seeds it by flipping the org to `open` just long enough to run it through
 * `joinOpenInvite` (the same transactional seat-creation path a real confirmed Open Invite Link
 * join uses) and flipping back, rather than duplicating seat-creation logic in the test itself. */
async function inviteTargetedBootstrap(gateway: InMemoryAwsGateway, orgId: string, email: string) {
  const org = await getOrgRecord(gateway, orgId);
  if (!org) throw new Error('org not found in test fixture');
  const originalInviteType = org.inviteType;
  await gateway.dynamoDb.updateItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId) }, set: { inviteType: 'open' } });
  const seat = await joinOpenInvite(gateway, orgId, email);
  await gateway.dynamoDb.updateItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId) }, set: { inviteType: originalInviteType } });
  return seat;
}

describe('inviteTargeted (this ticket\'s Acceptance Criteria, porting test_trial_org_seat_invite.py)', () => {
  it('lets an accepted seat invite a same-domain teammate, starting invited', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);

    const seat = await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'teammate@acme.example.com');

    expect(seat.state).toBe('invited');
    expect(seat.invitedBySeatId).toBe(firstSeat.seatId);
    expect(seat.orgId).toBe(org.orgId);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(2);
  });

  it('rejects a cross-domain invite and creates no seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);

    await expect(inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'teammate@other.example.com'))
      .rejects.toBeInstanceOf(CrossDomainInviteError);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(1);
  });

  it('rejects an invite that would exceed the seat cap', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput({ seatsTotal: 3 }), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);
    await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'second@acme.example.com');
    await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'third@acme.example.com');

    await expect(inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'fourth@acme.example.com'))
      .rejects.toBeInstanceOf(SeatCapExceededError);
  });

  it('succeeds when an invite lands exactly at the cap', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput({ seatsTotal: 3 }), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);
    await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'second@acme.example.com');

    const seat = await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'third@acme.example.com');

    expect(seat.state).toBe('invited');
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(3);
  });

  it('rejects an invite from a still-invited seat, then allows it once accepted', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);
    const invitedSeat = await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'teammate@acme.example.com');

    await expect(inviteTargeted(gateway, org.orgId, invitedSeat.seatId, 'another@acme.example.com'))
      .rejects.toBeInstanceOf(SeatNotAcceptedError);

    await acceptSeat(gateway, org.orgId, invitedSeat.seatId);
    const seat = await inviteTargeted(gateway, org.orgId, invitedSeat.seatId, 'another@acme.example.com');
    expect(seat.invitedBySeatId).toBe(invitedSeat.seatId);
  });

  it('rejects a malformed invite email before creating any seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);

    await expect(inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'not-an-email'))
      .rejects.toBeInstanceOf(MalformedEmailError);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(1);
  });

  it('rejects an invite naming an unknown org or an unknown inviter seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);

    await expect(inviteTargeted(gateway, '00000000-0000-0000-0000-000000000000', firstSeat.seatId, 'x@acme.example.com'))
      .rejects.toBeInstanceOf(OrgNotFoundError);
    await expect(inviteTargeted(gateway, org.orgId, 'no-such-seat', 'x@acme.example.com'))
      .rejects.toBeInstanceOf(SeatNotFoundError);
  });
});

describe('joinOpenInvite (this ticket\'s Acceptance Criteria, porting test_trial_org_open_invite.py)', () => {
  function openOrgInput(overrides: Partial<CreateOrgInput> = {}): CreateOrgInput {
    return orgInput({ inviteType: 'open', seatsTotal: 2, ...overrides });
  }

  it('gives a matching-domain first login an accepted seat with no inviter', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, openOrgInput(), CONFIG);

    const seat = await joinOpenInvite(gateway, org.orgId, 'first@acme.example.com');

    expect(seat.state).toBe('accepted');
    expect(seat.orgId).toBe(org.orgId);
    expect(seat.invitedBySeatId).toBeUndefined();
  });

  it('rejects a mismatched-domain join and creates no seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, openOrgInput(), CONFIG);

    await expect(joinOpenInvite(gateway, org.orgId, 'stranger@other.example.com'))
      .rejects.toBeInstanceOf(CrossDomainInviteError);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(0);
  });

  it('a second use of the link follows the same seat-cap rules, and a mismatched domain is still rejected on that later use', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, openOrgInput({ seatsTotal: 2 }), CONFIG);
    await joinOpenInvite(gateway, org.orgId, 'first@acme.example.com');

    const second = await joinOpenInvite(gateway, org.orgId, 'second@acme.example.com');
    expect(second.state).toBe('accepted');

    // seatsTotal=2: the two joins above already fill it, so a third is rejected exactly as
    // inviteTargeted's own cap enforcement does for a teammate-invited seat.
    await expect(joinOpenInvite(gateway, org.orgId, 'third@acme.example.com'))
      .rejects.toBeInstanceOf(SeatCapExceededError);

    const stillMismatched = await createOrg(gateway, openOrgInput(), CONFIG);
    await joinOpenInvite(gateway, stillMismatched.orgId, 'first@acme.example.com');
    await expect(joinOpenInvite(gateway, stillMismatched.orgId, 'stranger@other.example.com'))
      .rejects.toBeInstanceOf(CrossDomainInviteError);
    // The rejected second use must not have created a seat either - not just inferred from the
    // rejection, the same "creates no seat" proof the first-use mismatch test above asserts.
    expect((await getOrgRecord(gateway, stillMismatched.orgId))?.seatsUsed).toBe(1);
  });

  it('rejects joining via the open-invite path on a targeted-only org', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);

    await expect(joinOpenInvite(gateway, org.orgId, 'buyer@acme.example.com'))
      .rejects.toBeInstanceOf(OpenInviteNotEnabledError);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(0);
  });

  it('rejects a malformed join email before creating any seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, openOrgInput(), CONFIG);

    await expect(joinOpenInvite(gateway, org.orgId, 'not-an-email')).rejects.toBeInstanceOf(MalformedEmailError);
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(0);
  });
});

describe('seat cap under genuine concurrency (this ticket\'s Acceptance Criteria: "proven with real concurrent calls against the record store, not a simulated sequence")', () => {
  it('lets exactly cap-many concurrent targeted invites succeed, and rejects the rest', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput({ seatsTotal: 3 }), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);
    // firstSeat already occupies one of the 3 seats, leaving 2 remaining - fire 5 concurrent
    // invites at those 2 remaining seats.

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        inviteTargeted(gateway, org.orgId, firstSeat.seatId, `teammate${i}@acme.example.com`)),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(SeatCapExceededError);
    }
    expect((await getOrgRecord(gateway, org.orgId))?.seatsUsed).toBe(3);
  });

  it('lets exactly cap-many concurrent open-invite joins succeed, and never overshoots seatsUsed', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput({ inviteType: 'open', seatsTotal: 4 }), CONFIG);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        joinOpenInvite(gateway, org.orgId, `joiner${i}@acme.example.com`)),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(4);
    expect(rejected).toHaveLength(6);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(SeatCapExceededError);
    }
    const finalOrg = await getOrgRecord(gateway, org.orgId);
    expect(finalOrg?.seatsUsed).toBe(4);
    expect(finalOrg?.seatsUsed).toBeLessThanOrEqual(finalOrg?.seatsTotal ?? Infinity);
  });
});

describe('getSeat/acceptSeat', () => {
  it('acceptSeat is idempotent once a seat is already accepted', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);

    const acceptedAgain = await acceptSeat(gateway, org.orgId, firstSeat.seatId);

    expect(acceptedAgain.state).toBe('accepted');
    expect(await getSeat(gateway, org.orgId, firstSeat.seatId)).toEqual(acceptedAgain);
  });

  it('acceptSeat rejects an unknown seat', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);

    await expect(acceptSeat(gateway, org.orgId, 'no-such-seat')).rejects.toBeInstanceOf(SeatNotFoundError);
  });

  it('acceptSeat stays idempotent under two genuinely concurrent acceptances of the same seat (CodeRabbit, PR #296)', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, orgInput(), CONFIG);
    const firstSeat = await acceptedFirstSeat(gateway, org.orgId);
    const invitedSeat = await inviteTargeted(gateway, org.orgId, firstSeat.seatId, 'teammate@acme.example.com');

    const results = await Promise.allSettled([
      acceptSeat(gateway, org.orgId, invitedSeat.seatId),
      acceptSeat(gateway, org.orgId, invitedSeat.seatId),
    ]);

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      expect((result as PromiseFulfilledResult<Awaited<ReturnType<typeof acceptSeat>>>).value.state).toBe('accepted');
    }
    expect((await getSeat(gateway, org.orgId, invitedSeat.seatId))?.state).toBe('accepted');
  });
});
