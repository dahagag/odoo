import { describe, expect, it } from 'vitest';
import { buildTestServer, seedOrg } from './testServer';

const ORG_1 = '11111111-1111-4111-8111-111111111111';
const ORG_2 = '22222222-2222-4222-8222-222222222222';

describe('auth boundary (this ticket\'s Testing Decisions)', () => {
  it('rejects an org token on the administration surface', async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, ORG_1);
    orgTokenStore.issue(ORG_1, 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/orgs/${ORG_1}`,
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a trusted admin principal on the administration surface', async () => {
    const { app, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, ORG_1);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/orgs/${ORG_1}`,
      headers: { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ orgId: ORG_1 });
  });

  it("rejects an org token asking about an org other than its own", async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, ORG_1);
    await seedOrg(awsGateway, ORG_2);
    orgTokenStore.issue(ORG_1, 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/org/${ORG_2}/registration`,
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('serves an org token its own registration', async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, ORG_1);
    orgTokenStore.issue(ORG_1, 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/org/${ORG_1}/registration`,
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ orgId: ORG_1, domain: 'acme.example' });
  });

  it('rejects a request with no credential at all on either surface', async () => {
    const { app, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, ORG_1);

    const admin = await app.inject({ method: 'GET', url: `/v1/admin/orgs/${ORG_1}` });
    const org = await app.inject({ method: 'GET', url: `/v1/org/${ORG_1}/registration` });

    expect(admin.statusCode).toBe(401);
    expect(org.statusCode).toBe(401);
  });

  it('404s a malformed (non-UUID) orgId only after auth succeeds', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orgs/not-a-uuid',
      headers: { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app' },
    });

    expect(response.statusCode).toBe(400);
  });
});
