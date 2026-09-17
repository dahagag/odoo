import { describe, expect, it } from 'vitest';
import { createOrg } from '../src/org/record';
import { inviteTargeted } from '../src/org/seat';
import { buildTestServer } from './testServer';

const CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };

let dnsLabelSequence = 0;
function orgInput(overrides: Record<string, unknown> = {}) {
  dnsLabelSequence += 1;
  return {
    type: 'trial' as const,
    name: 'Acme Trial',
    domain: 'acme.example.com',
    seatsTotal: 3,
    dnsSubdomainLabel: `acme-trial-${dnsLabelSequence}`,
    ...overrides,
  };
}

describe('GET /v1/org/:orgId/seats (#200 User Story 3)', () => {
  it('lists an org\'s own seats for its own org token', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    const firstSeat = await inviteTargetedBootstrap(awsGateway, org.orgId);
    await inviteTargeted(awsGateway, org.orgId, firstSeat.seatId, 'teammate@acme.example.com');
    orgTokenStore.issue(org.orgId, 'org-token', firstSeat.seatId);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/org/${org.orgId}/seats`,
      headers: { authorization: 'Bearer org-token' },
    });

    expect(response.statusCode).toBe(200);
    const seats = response.json();
    expect(seats).toHaveLength(2);
    expect(seats.map((s: { email: string }) => s.email).sort()).toEqual(['first@acme.example.com', 'teammate@acme.example.com']);
  });

  it('is cross-org isolated: a token for org A cannot list org B\'s seats', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const orgA = await createOrg(awsGateway, orgInput(), CONFIG);
    const orgB = await createOrg(awsGateway, orgInput(), CONFIG);
    orgTokenStore.issue(orgA.orgId, 'org-a-token');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/org/${orgB.orgId}/seats`,
      headers: { authorization: 'Bearer org-a-token' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('requires an org token', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);

    const response = await app.inject({ method: 'GET', url: `/v1/org/${org.orgId}/seats` });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /v1/org/:orgId/seats/invite (#200 User Story 4, ADR-0026 Targeted Invite)', () => {
  it('lets a Seat-scoped org token invite a same-domain teammate', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    const firstSeat = await inviteTargetedBootstrap(awsGateway, org.orgId);
    orgTokenStore.issue(org.orgId, 'org-token', firstSeat.seatId);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-token', 'idempotency-key': 'invite-1' },
      payload: { email: 'teammate@acme.example.com' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ email: 'teammate@acme.example.com', state: 'invited', invitedBySeatId: firstSeat.seatId });
  });

  it('rejects a cross-domain invite clearly (#200 User Story 5)', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    const firstSeat = await inviteTargetedBootstrap(awsGateway, org.orgId);
    orgTokenStore.issue(org.orgId, 'org-token', firstSeat.seatId);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-token', 'idempotency-key': 'invite-2' },
      payload: { email: 'teammate@other.example.com' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('requires the org token to be Seat-scoped, not just org-scoped', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    orgTokenStore.issue(org.orgId, 'org-only-token');

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-only-token', 'idempotency-key': 'invite-3' },
      payload: { email: 'teammate@acme.example.com' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an invite from a seat that has not accepted yet', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    const firstSeat = await inviteTargetedBootstrap(awsGateway, org.orgId);
    const notYetAccepted = await inviteTargeted(awsGateway, org.orgId, firstSeat.seatId, 'notaccepted@acme.example.com');
    orgTokenStore.issue(org.orgId, 'org-token', notYetAccepted.seatId);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-token', 'idempotency-key': 'invite-4' },
      payload: { email: 'teammate@acme.example.com' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an invite that would exceed the seat cap', async () => {
    const { app, awsGateway, orgTokenStore } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ seatsTotal: 2 }), CONFIG);
    const firstSeat = await inviteTargetedBootstrap(awsGateway, org.orgId);
    orgTokenStore.issue(org.orgId, 'org-token', firstSeat.seatId);
    await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-token', 'idempotency-key': 'invite-5' },
      payload: { email: 'second@acme.example.com' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/seats/invite`,
      headers: { authorization: 'Bearer org-token', 'idempotency-key': 'invite-6' },
      payload: { email: 'third@acme.example.com' },
    });

    expect(response.statusCode).toBe(409);
  });
});

/** Seeds a Trial Org's first, already-accepted Seat via an Open Invite Link join - the same
 * bootstrap `test/seat.test.ts` uses, since minting a Trial Org's very first member is out of
 * this ticket's own scope (ADR-0026). */
async function inviteTargetedBootstrap(awsGateway: Parameters<typeof createOrg>[0], orgId: string, email = 'first@acme.example.com') {
  const { getOrgRecord } = await import('../src/org/record');
  const { joinOpenInvite } = await import('../src/org/seat');
  const org = await getOrgRecord(awsGateway, orgId);
  if (!org) throw new Error('org not found in test fixture');
  await awsGateway.dynamoDb.updateItem({ table: 'orgs', key: { pk: `org#${orgId}` }, set: { inviteType: 'open' } });
  const seat = await joinOpenInvite(awsGateway, orgId, email);
  await awsGateway.dynamoDb.updateItem({ table: 'orgs', key: { pk: `org#${orgId}` }, set: { inviteType: org.inviteType } });
  return seat;
}
