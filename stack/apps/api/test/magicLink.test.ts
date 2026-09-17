import { describe, expect, it } from 'vitest';
import { createOrg, getOrgRecord } from '../src/org/record';
import { joinOpenInvite } from '../src/org/seat';
import { CapturingEmailSender, buildTestServer } from './testServer';

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

describe('requestMagicLink/verifyMagicLink (#200 User Stories 4, 6, 12, 13)', () => {
  it('sends a link to an already-invited seat, and verifying it accepts that seat and mints an org token', async () => {
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    await awsGateway.dynamoDb.updateItem({ table: 'orgs', key: { pk: `org#${org.orgId}` }, set: { inviteType: 'open' } });
    const invited = await joinOpenInvite(awsGateway, org.orgId, 'first@acme.example.com');
    await awsGateway.dynamoDb.updateItem({ table: 'orgs', key: { pk: `org#${org.orgId}` }, set: { inviteType: 'targeted' } });
    // Make it "invited, not yet accepted" directly, since joinOpenInvite always creates an
    // already-accepted seat (ADR-0026) - a Targeted Invite's own invited-but-unaccepted seat is
    // what a real magic-link sign-in for a fresh invitee actually looks like.
    await awsGateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}`, sk: `seat#${invited.seatId}` },
      set: { state: 'invited' },
    });

    const requestResponse = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-1' },
      payload: { email: 'first@acme.example.com' },
    });
    expect(requestResponse.statusCode).toBe(202);

    const token = (emailSender as CapturingEmailSender).tokenSentTo('first@acme.example.com');
    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-links/verify',
      headers: { 'idempotency-key': 'verify-1' },
      payload: { token },
    });

    expect(verifyResponse.statusCode).toBe(200);
    const body = verifyResponse.json();
    expect(body.orgId).toBe(org.orgId);
    expect(body.seat).toMatchObject({ seatId: invited.seatId, state: 'accepted' });
    expect(typeof body.orgToken).toBe('string');

    // The minted org token actually works, and is Seat-scoped.
    const seatsResponse = await app.inject({
      method: 'GET',
      url: `/v1/org/${org.orgId}/seats`,
      headers: { authorization: `Bearer ${body.orgToken}` },
    });
    expect(seatsResponse.statusCode).toBe(200);
  });

  it('joins a fresh seat on first use of an Open Invite Link, and never before verify', async () => {
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ inviteType: 'open' }), CONFIG);

    await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-2' },
      payload: { email: 'newperson@acme.example.com' },
    });

    // Requesting alone must not create a seat.
    expect((await getOrgRecord(awsGateway, org.orgId))?.seatsUsed).toBe(0);

    const token = (emailSender as CapturingEmailSender).tokenSentTo('newperson@acme.example.com');
    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-links/verify',
      headers: { 'idempotency-key': 'verify-2' },
      payload: { token },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json().seat).toMatchObject({ email: 'newperson@acme.example.com', state: 'accepted' });
    expect((await getOrgRecord(awsGateway, org.orgId))?.seatsUsed).toBe(1);
  });

  it('rejects a cross-domain email clearly, sending no link (#200 User Stories 5, 7)', async () => {
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ inviteType: 'open' }), CONFIG);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-3' },
      payload: { email: 'stranger@other.example.com' },
    });

    expect(response.statusCode).toBe(403);
    expect((emailSender as CapturingEmailSender).sent).toHaveLength(0);
  });

  it('stays silent (202, no email sent) for a right-domain email with no invitation on a targeted-only org', async () => {
    // CodeRabbit, PR #318: a 404 here would let an external caller enumerate which right-domain
    // addresses have a Seat - the route's own doc comment already promises "always 202, never
    // reveals whether a given email has a Seat", so this proves the code actually keeps that
    // promise for the one case that used to break it.
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ inviteType: 'targeted' }), CONFIG);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-4' },
      payload: { email: 'nobody@acme.example.com' },
    });

    expect(response.statusCode).toBe(202);
    expect((emailSender as CapturingEmailSender).sent).toHaveLength(0);
  });

  it('still rejects a cross-domain email with a clear 403 on a targeted-only org, even with no seat at all (#200 User Stories 5, 7)', async () => {
    // The domain guard must run before the no-invitation check, not after it - otherwise this
    // exact case (wrong domain, no seat, targeted org) would fall into the silent-202 case above
    // instead of the clear rejection these User Stories ask for.
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ inviteType: 'targeted' }), CONFIG);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-4b' },
      payload: { email: 'stranger@other.example.com' },
    });

    expect(response.statusCode).toBe(403);
    expect((emailSender as CapturingEmailSender).sent).toHaveLength(0);
  });

  it('rejects an unknown, expired, or already-used token without revealing which (#200 User Story 13)', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-links/verify',
      headers: { 'idempotency-key': 'verify-3' },
      payload: { token: 'never-issued' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('a magic-link token is single-use: verifying it twice fails the second time', async () => {
    const { app, awsGateway, emailSender } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ inviteType: 'open' }), CONFIG);
    await app.inject({
      method: 'POST',
      url: `/v1/org/${org.orgId}/auth/magic-links`,
      headers: { 'idempotency-key': 'req-5' },
      payload: { email: 'once@acme.example.com' },
    });
    const token = (emailSender as CapturingEmailSender).tokenSentTo('once@acme.example.com');

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-links/verify',
      headers: { 'idempotency-key': 'verify-4' },
      payload: { token },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-links/verify',
      headers: { 'idempotency-key': 'verify-5' },
      payload: { token },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(404);
  });

  it('a magic-link token expires after its TTL', async () => {
    const { magicLinkStore } = buildTestServer();
    const token = await magicLinkStore.issue({ orgId: 'org-1', email: 'e@x.com', expiresAt: Date.now() - 1 });

    await expect(magicLinkStore.consume(token)).resolves.toBeUndefined();
  });
});
