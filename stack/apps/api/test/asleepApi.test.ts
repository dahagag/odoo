import { describe, expect, it } from 'vitest';
import { InMemoryWakeRateLimiter } from '../src/auth/wakeRateLimit';
import { createOrg, getOrgRecord } from '../src/org/record';
import { StubProvisioner } from '../src/org/provisioner';
import type { Provisioner } from '../src/org/provisioner';
import { buildTestServer } from './testServer';

/** A `Provisioner` whose `wake` always fails fast (this ticket's User Story 10's own flip side:
 * "feedback while waking" only means something once a *failure* to wake is also observable, not
 * just a slow success). Mirrors a real `AwsProvisioner.wake` call that never even reaches AWS -
 * a bad Step Functions ARN, a permissions error - the exact case `applyTransition`'s own
 * before-the-write provisioner call exists to catch (ADR-0019: "a provisioner failure ...
 * prevents the state change entirely"). */
class FailingWakeProvisioner extends StubProvisioner implements Provisioner {
  async wake(): Promise<void> {
    throw new Error('EC2 StartInstances denied');
  }
}

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

/** Every public asleep/wake test starts from an org that's already been issued then suspended -
 * mirrors `test_trial_org_asleep_page.py`'s own fixture, since `issue` itself is out of this
 * surface's own responsibility. */
async function suspendedOrg(app: ReturnType<typeof buildTestServer>['app'], awsGateway: ReturnType<typeof buildTestServer>['awsGateway'], overrides: Record<string, unknown> = {}) {
  const org = await createOrg(awsGateway, orgInput(overrides), CONFIG);
  const issueHeaders = { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app', 'idempotency-key': `issue-${org.orgId}` };
  await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers: issueHeaders });
  await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/suspend`, headers: { ...issueHeaders, 'idempotency-key': `suspend-${org.orgId}` } });
  return org;
}

describe('GET /v1/public/orgs/by-dns-label/:dnsSubdomainLabel (#200: the asleep page\'s own entry point)', () => {
  it('resolves a reserved label to its org, publicly, with no secrets beyond name', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput({ dnsSubdomainLabel: 'acme-eval-public' }), CONFIG);

    const response = await app.inject({ method: 'GET', url: '/v1/public/orgs/by-dns-label/acme-eval-public' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ orgId: org.orgId, name: 'Acme Trial' });
  });

  it('degrades to a plain 404 for an unrecognized label, rather than erroring', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/v1/public/orgs/by-dns-label/no-such-label' });

    expect(response.statusCode).toBe(404);
  });

  it('404s (never crashes) for a malformed label', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/v1/public/orgs/by-dns-label/Not_A_Valid_Label!' });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /v1/public/orgs/:orgId/asleep-status (#200: visiting never itself wakes)', () => {
  it('reports idle for a suspended org, without waking it', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);

    const response = await app.inject({ method: 'GET', url: `/v1/public/orgs/${org.orgId}/asleep-status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ phase: 'idle', elapsedSeconds: 0 });
    expect((await getOrgRecord(awsGateway, org.orgId))?.state).toBe('suspended');
  });

  it('reports awake for an active org with no running wake job', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrg(awsGateway, orgInput(), CONFIG);
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app', 'idempotency-key': 'issue-1' },
    });

    const response = await app.inject({ method: 'GET', url: `/v1/public/orgs/${org.orgId}/asleep-status` });

    expect(response.statusCode).toBe(200);
    expect(response.json().phase).toBe('awake');
  });

  it('404s for an org the stack cannot find (#200: the asleep page must degrade honestly on a failover)', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/v1/public/orgs/00000000-0000-0000-0000-000000000000/asleep-status' });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /v1/public/orgs/:orgId/wake (#200 User Stories 9, 10, 11, 16)', () => {
  it('wakes a suspended org and reports waking', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/public/orgs/${org.orgId}/wake`,
      headers: { 'idempotency-key': 'wake-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().phase).toBe('waking');
    expect((await getOrgRecord(awsGateway, org.orgId))?.state).toBe('active');
  });

  it('is a no-op, not an error, on a second press once the org is already awake', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);
    await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-2a' } });

    const second = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-2b' } });

    expect(second.statusCode).toBe(200);
  });

  it('has no effect requiring authentication - no auth header at all is accepted', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);

    const response = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-3' } });

    expect(response.statusCode).toBe(200);
  });

  it('replays the same result on a retry with the same Idempotency-Key, without recounting against the rate limit', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);
    const headers = { 'idempotency-key': 'wake-replay-1' };

    const first = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers });
    // Two more genuinely distinct attempts exhaust the 3-per-window allowance.
    await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-replay-2' } });
    await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-replay-3' } });
    const freshFourth = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-replay-4' } });
    expect(freshFourth.statusCode).toBe(429);

    // A *retry* of the very first key still replays its cached success, even though the
    // allowance is now exhausted - proof it never consumed a second slot of its own.
    const replay = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
  });

  it('rate limits excess wake attempts for the same org (#200 Further Notes: per-org, not per-IP)', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await suspendedOrg(app, awsGateway);

    const responses = [];
    for (let i = 0; i < 5; i++) {
      responses.push(await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': `wake-burst-${i}` } }));
    }

    const okCount = responses.filter((r) => r.statusCode === 200).length;
    const limited = responses.filter((r) => r.statusCode === 429);
    expect(okCount).toBeGreaterThan(0);
    expect(limited.length).toBeGreaterThan(0);
    for (const response of limited) {
      expect(response.headers['retry-after']).toBeDefined();
    }
  });

  it('404s for an org the stack cannot find', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/orgs/00000000-0000-0000-0000-000000000000/wake',
      headers: { 'idempotency-key': 'wake-4' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('reports 502 and leaves the org suspended - never stuck showing waking - when the provisioner fails to start', async () => {
    const { app, awsGateway } = buildTestServer({}, { provisioner: new FailingWakeProvisioner() });
    const org = await suspendedOrg(app, awsGateway);

    const wakeResponse = await app.inject({ method: 'POST', url: `/v1/public/orgs/${org.orgId}/wake`, headers: { 'idempotency-key': 'wake-fail-1' } });

    expect(wakeResponse.statusCode).toBe(502);
    // No partial write (ADR-0019): the org is exactly as suspended as before the attempt, so the
    // visitor sees the Wake Up button again on their very next poll - not stuck on "waking"
    // forever for a job that never actually started.
    expect((await getOrgRecord(awsGateway, org.orgId))?.state).toBe('suspended');

    const statusResponse = await app.inject({ method: 'GET', url: `/v1/public/orgs/${org.orgId}/asleep-status` });
    expect(statusResponse.json().phase).toBe('idle');
  });
});

describe('InMemoryWakeRateLimiter (unit)', () => {
  it('allows a small burst, then throttles until the window rolls', () => {
    const limiter = new InMemoryWakeRateLimiter();
    const now = 1_000_000;

    expect(limiter.attempt('org-1', now)).toEqual({ allowed: true });
    expect(limiter.attempt('org-1', now + 1)).toEqual({ allowed: true });
    expect(limiter.attempt('org-1', now + 2)).toEqual({ allowed: true });
    const fourth = limiter.attempt('org-1', now + 3);
    expect(fourth.allowed).toBe(false);

    // A different org is never throttled by another org's attempts (per-org, not global).
    expect(limiter.attempt('org-2', now + 3)).toEqual({ allowed: true });

    // Once the window has fully rolled past the first attempt, it's allowed again.
    expect(limiter.attempt('org-1', now + 60_001)).toEqual({ allowed: true });
  });
});
