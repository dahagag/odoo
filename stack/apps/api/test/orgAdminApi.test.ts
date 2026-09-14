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

/** A `Provisioner` whose calls block until the test explicitly `open()`s the gate - lets a test
 * hold a lifecycle action's `compute()` in flight for as long as it needs to observe a
 * concurrent racer's behavior (#285's Testing Decisions: "a concurrent call within the bounded
 * poll window"), then release it cleanly so nothing is left dangling. */
class GatedProvisioner {
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });

  private wait(): Promise<void> { return this.gate; }
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
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the leader actually claim first
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
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the leader actually claim first

    const follower = await app.inject({ method: 'POST', url: `/v1/admin/orgs/${org.orgId}/issue`, headers });

    expect(follower.statusCode).toBe(409);
    expect(follower.json().title).toBe('Idempotency-Key is still processing');
    expect(follower.headers['retry-after']).toBeDefined();

    provisioner.open();
    const leaderResponse = await leader;
    expect(leaderResponse.statusCode).toBe(200);
  }, 8000);
});
