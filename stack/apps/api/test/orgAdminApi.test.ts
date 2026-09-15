import { describe, expect, it } from 'vitest';
import { buildTestServer } from './testServer';

const ADMIN_HEADERS = { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app' };

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'trial',
    name: 'Acme Evaluation',
    domain: 'acme.example',
    seatsTotal: 25,
    dnsSubdomainLabel: 'acme-eval',
    ...overrides,
  };
}

describe('POST /v1/admin/orgs (this ticket\'s Acceptance Criteria)', () => {
  it('creates an org in the issued state', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-1' },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ state: 'issued', type: 'trial', dnsSubdomainLabel: 'acme-eval', region: 'us-east-1' });
  });

  it('rejects a malformed request body', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-2' },
      payload: { type: 'trial' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires an admin principal', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { 'idempotency-key': 'create-3' },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(401);
  });

  it('requires an Idempotency-Key header', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers: ADMIN_HEADERS, payload: createPayload() });

    expect(response.statusCode).toBe(400);
  });

  it('the same Idempotency-Key twice returns the same org rather than creating a second one', async () => {
    const { app } = buildTestServer();
    const headers = { ...ADMIN_HEADERS, 'idempotency-key': 'create-4' };

    const first = await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers, payload: createPayload() });
    const second = await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers, payload: createPayload() });

    expect(second.json()).toEqual(first.json());
  });

  it('rejects a duplicate dnsSubdomainLabel with 409', async () => {
    const { app } = buildTestServer();
    await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-5' },
      payload: createPayload(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-6' },
      payload: createPayload({ domain: 'other.example' }),
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects seatsTotal above the system-wide seat cap of 25 (#303, matching SYSTEM_WIDE_SEAT_CAP)', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-seatcap-1' },
      payload: createPayload({ seatsTotal: 26 }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('accepts seatsTotal at the system-wide seat cap of 25', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-seatcap-2' },
      payload: createPayload({ seatsTotal: 25 }),
    });

    expect(response.statusCode).toBe(201);
  });

  it('derives dnsSubdomainLabel from name when omitted from the request body (#303)', async () => {
    const { app } = buildTestServer();
    const { dnsSubdomainLabel: _dnsSubdomainLabel, ...payload } = createPayload({ name: 'Acme Slugify Co' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'create-slugify-1' },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ dnsSubdomainLabel: 'acme-slugify-co' });
  });
});

describe('PATCH /v1/admin/orgs/:orgId and lifecycle actions (this ticket\'s Acceptance Criteria)', () => {
  async function createOrgViaApi(app: ReturnType<typeof buildTestServer>['app'], key: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': key },
      payload: createPayload(overrides),
    });
    return response.json() as { orgId: string };
  }

  it('changes dnsSubdomainLabel while issued', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-patch-1');

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/orgs/${org.orgId}`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'patch-1' },
      payload: { dnsSubdomainLabel: 'acme-relabeled' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ dnsSubdomainLabel: 'acme-relabeled' });
  });

  it('rejects the label change once the org has left issued', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-patch-2', { dnsSubdomainLabel: 'acme-eval-2' });
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'issue-patch-2' },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/orgs/${org.orgId}`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'patch-2' },
      payload: { dnsSubdomainLabel: 'acme-relabeled-2' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('runs issue/suspend/wake/destroy end to end through the API', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-lifecycle', { dnsSubdomainLabel: 'acme-lifecycle' });

    async function act(action: string, key: string) {
      return app.inject({
        method: 'POST',
        url: `/v1/admin/orgs/${org.orgId}/${action}`,
        headers: { ...ADMIN_HEADERS, 'idempotency-key': key },
      });
    }

    const issue = await act('issue', 'lc-issue');
    expect(issue.statusCode).toBe(200);
    expect(issue.json()).toMatchObject({ state: 'active' });

    const suspend = await act('suspend', 'lc-suspend');
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json()).toMatchObject({ state: 'suspended' });

    const wake = await act('wake', 'lc-wake');
    expect(wake.statusCode).toBe(200);
    expect(wake.json()).toMatchObject({ state: 'active' });

    const destroy = await act('destroy', 'lc-destroy');
    expect(destroy.statusCode).toBe(200);
    expect(destroy.json()).toMatchObject({ state: 'destroyed' });
  });

  it('rejects an illegal transition with 409 and leaves state unchanged', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-illegal', { dnsSubdomainLabel: 'acme-illegal' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/suspend`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'illegal-suspend' },
    });

    expect(response.statusCode).toBe(409);
    const stillIssued = await app.inject({ method: 'GET', url: `/v1/admin/orgs/${org.orgId}`, headers: ADMIN_HEADERS });
    expect(stillIssued.json()).toMatchObject({ state: 'issued' });
  });

  it('404s a transition against an org that does not exist', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs/11111111-1111-4111-8111-111111111111/issue',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'no-such-org' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('reports a provisioner failure as 502 and leaves the record unchanged', async () => {
    const { app, provisioner, awsGateway: _awsGateway } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-fail', { dnsSubdomainLabel: 'acme-fail' });
    (provisioner as { issue: () => Promise<void> }).issue = async () => {
      throw new Error('Step Functions is unavailable');
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'fail-issue' },
    });

    expect(response.statusCode).toBe(502);
    const stillIssued = await app.inject({ method: 'GET', url: `/v1/admin/orgs/${org.orgId}`, headers: ADMIN_HEADERS });
    expect(stillIssued.json()).toMatchObject({ state: 'issued' });
  });

  it('a non-provisioner failure during a transition is reported as 500, not 502', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-infra-fail', { dnsSubdomainLabel: 'acme-infra-fail' });
    awsGateway.dynamoDb.updateItem = async () => { throw new Error('DynamoDB is throttling this table'); };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'infra-fail-issue' },
    });

    expect(response.statusCode).toBe(500);
  });
});

describe('POST /v1/admin/orgs/:orgId/check-status (#298: production entry point for Provisioner.checkStatus)', () => {
  async function createOrgViaApi(app: ReturnType<typeof buildTestServer>['app'], key: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': key },
      payload: createPayload(overrides),
    });
    return response.json() as { orgId: string };
  }

  it('invokes checkStatus and returns the promoted status once the job succeeds', async () => {
    const { app, awsGateway, provisioner } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-cs-1', { dnsSubdomainLabel: 'acme-cs-1' });
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'issue-cs-1' },
    });
    const calls: string[] = [];
    (provisioner as { checkStatus: (org: { orgId: string }) => Promise<void> }).checkStatus = async (checkedOrg) => {
      calls.push(checkedOrg.orgId);
      await awsGateway.dynamoDb.updateItem({
        table: 'orgs',
        key: { pk: `org#${checkedOrg.orgId}` },
        set: { lastJobStatus: 'succeeded', lastJobError: '' },
      });
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/check-status`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'check-status-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([org.orgId]);
    expect(response.json()).toMatchObject({ lastJobStatus: 'succeeded' });
  });

  it('invokes checkStatus and surfaces the failure reason once the job fails', async () => {
    const { app, awsGateway, provisioner } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-cs-2', { dnsSubdomainLabel: 'acme-cs-2' });
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/issue`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'issue-cs-2' },
    });
    (provisioner as { checkStatus: (org: { orgId: string }) => Promise<void> }).checkStatus = async (checkedOrg) => {
      await awsGateway.dynamoDb.updateItem({
        table: 'orgs',
        key: { pk: `org#${checkedOrg.orgId}` },
        set: { lastJobStatus: 'failed', lastJobError: 'States.Timeout' },
      });
    };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/check-status`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'check-status-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ lastJobStatus: 'failed', lastJobError: 'States.Timeout' });
  });

  it('is a safe no-op for an org with no running job', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-cs-3', { dnsSubdomainLabel: 'acme-cs-3' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/check-status`,
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'check-status-3' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: 'issued' });
  });

  it('requires an admin principal', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-cs-4', { dnsSubdomainLabel: 'acme-cs-4' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orgs/${org.orgId}/check-status`,
      headers: { 'idempotency-key': 'check-status-4' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('requires an Idempotency-Key header', async () => {
    const { app } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-cs-5', { dnsSubdomainLabel: 'acme-cs-5' });

    const response = await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/check-status`, headers: ADMIN_HEADERS });

    expect(response.statusCode).toBe(400);
  });

  it('404s for an org that does not exist', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs/11111111-1111-4111-8111-111111111111/check-status',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'check-status-6' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /v1/admin/sweeps/idle-suspend and /v1/admin/sweeps/auto-destroy (#282: production entry points for the sweeps)', () => {
  async function createOrgViaApi(app: ReturnType<typeof buildTestServer>['app'], key: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': key },
      payload: createPayload(overrides),
    });
    return response.json() as { orgId: string };
  }

  it('suspends an active org idle past the timeout', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-idle-1', { dnsSubdomainLabel: 'acme-idle-1' });
    await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers: { ...ADMIN_HEADERS, 'idempotency-key': 'issue-idle-1' } });
    await awsGateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastActivityAt: new Date(Date.now() - 45 * 60_000).toISOString() },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/sweeps/idle-suspend',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'idle-sweep-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ action: 'suspend', orgIds: [org.orgId] });
    const after = await app.inject({ method: 'GET', url: `/v1/admin/orgs/${org.orgId}`, headers: ADMIN_HEADERS });
    expect(after.json()).toMatchObject({ state: 'suspended' });
  });

  it('destroys an active Trial Org past its expiry date, leaving a snapshot-retention marker', async () => {
    const { app, awsGateway } = buildTestServer();
    const org = await createOrgViaApi(app, 'create-expired-1', { dnsSubdomainLabel: 'acme-expired-1' });
    await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers: { ...ADMIN_HEADERS, 'idempotency-key': 'issue-expired-1' } });
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await awsGateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { expiryDate: pastDate, gsi2sk: pastDate },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/sweeps/auto-destroy',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'destroy-sweep-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ action: 'destroy', orgIds: [org.orgId] });
    const after = await awsGateway.dynamoDb.getItem({ table: 'orgs', key: { pk: `org#${org.orgId}` } });
    expect(after).toMatchObject({ state: 'destroyed' });
    expect((after as { snapshotRetentionUntil?: string } | undefined)?.snapshotRetentionUntil).toBeDefined();
  });

  it('the auto-destroy sweep never selects a Client Org', async () => {
    const { app } = buildTestServer();
    await createOrgViaApi(app, 'create-client-1', { type: 'client', dnsSubdomainLabel: 'acme-client-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/sweeps/auto-destroy',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'destroy-sweep-2' },
    });

    expect(response.json()).toEqual({ action: 'destroy', orgIds: [] });
  });

  it.each(['idle-suspend', 'auto-destroy'])('%s requires an admin principal', async (sweep) => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'POST', url: `/v1/admin/sweeps/${sweep}`, headers: { 'idempotency-key': `${sweep}-noauth` } });

    expect(response.statusCode).toBe(401);
  });

  it.each(['idle-suspend', 'auto-destroy'])('%s requires an Idempotency-Key header', async (sweep) => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'POST', url: `/v1/admin/sweeps/${sweep}`, headers: ADMIN_HEADERS });

    expect(response.statusCode).toBe(400);
  });
});

/** A `Provisioner` whose calls block until the test explicitly `open()`s the gate - lets a test
 * hold a lifecycle action's `compute()` in flight for as long as it needs to observe a
 * concurrent racer's behavior (#285's Testing Decisions: "a concurrent call within the bounded
 * poll window"), then release it cleanly so nothing is left dangling. */
class GatedProvisioner {
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  private markEntered!: () => void;
  /** Resolves once the leader's call has actually reached this provisioner - a test awaits this
   * instead of a fixed delay before starting the follower, so it can't race ahead of the leader
   * under slow CI scheduling. */
  readonly entered = new Promise<void>((resolve) => { this.markEntered = resolve; });

  private wait(): Promise<void> {
    this.markEntered();
    return this.gate;
  }
  issue() { return this.wait(); }
  suspend() { return this.wait(); }
  wake() { return this.wait(); }
  destroy() { return this.wait(); }

  open(): void { this.release(); }
}

describe('idempotency conflict responses through the real server (#285)', () => {
  async function createOrgViaApi(app: ReturnType<typeof buildTestServer>['app'], key: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': key },
      payload: createPayload(overrides),
    });
    return response.json() as { orgId: string };
  }

  it('a reused Idempotency-Key against a materially different body is rejected 409 with its own title', async () => {
    const { app } = buildTestServer();
    const headers = { ...ADMIN_HEADERS, 'idempotency-key': 'mismatch-1' };

    const first = await app.inject({ method: 'POST', url: '/v1/admin/orgs', headers, payload: createPayload() });
    expect(first.statusCode).toBe(201);

    const mismatched = await app.inject({
      method: 'POST',
      url: '/v1/admin/orgs',
      headers,
      payload: createPayload({ dnsSubdomainLabel: 'a-different-label' }),
    });

    expect(mismatched.statusCode).toBe(409);
    expect(mismatched.json().title).toBe('Idempotency-Key reused for a different request');
  });

  it('a concurrent lifecycle call replays the leader\'s result once it resolves within the poll window', async () => {
    const provisioner = new GatedProvisioner();
    const { app } = buildTestServer({}, { provisioner });
    const org = await createOrgViaApi(app, 'create-concurrency-1', { dnsSubdomainLabel: 'acme-concurrency-1' });
    const headers = { ...ADMIN_HEADERS, 'idempotency-key': 'issue-concurrency-1' };

    const leader = app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers });
    await provisioner.entered; // let the leader actually reach the provisioner before starting the follower
    const followerPromise = app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers });

    provisioner.open();
    const [leaderResponse, followerResponse] = await Promise.all([leader, followerPromise]);

    expect(leaderResponse.statusCode).toBe(200);
    expect(followerResponse.statusCode).toBe(200);
    expect(followerResponse.json()).toEqual(leaderResponse.json());
  });

  it('a concurrent lifecycle call fails fast with 409 and Retry-After once the leader outlives the poll window', async () => {
    const provisioner = new GatedProvisioner();
    const { app } = buildTestServer({}, { provisioner });
    const org = await createOrgViaApi(app, 'create-concurrency-2', { dnsSubdomainLabel: 'acme-concurrency-2' });
    const headers = { ...ADMIN_HEADERS, 'idempotency-key': 'issue-concurrency-2' };

    const leader = app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers });
    await provisioner.entered; // let the leader actually reach the provisioner before starting the follower

    const follower = await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers });

    expect(follower.statusCode).toBe(409);
    expect(follower.json().title).toBe('Idempotency-Key is still processing');
    expect(follower.headers['retry-after']).toBeDefined();

    provisioner.open();
    const leaderResponse = await leader;
    expect(leaderResponse.statusCode).toBe(200);
  }, 8000);
});
