import { describe, expect, it } from 'vitest';
import { buildTestServer, seedOrg } from './testServer';

describe('auth boundary (this ticket\'s Testing Decisions)', () => {
  it('rejects an org token on the administration surface', async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, 'org-1');
    orgTokenStore.issue('org-1', 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orgs/org-1',
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a trusted admin principal on the administration surface', async () => {
    const { app, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, 'org-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orgs/org-1',
      headers: { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ orgId: 'org-1' });
  });

  it("rejects an org token asking about an org other than its own", async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, 'org-1');
    await seedOrg(awsGateway, 'org-2');
    orgTokenStore.issue('org-1', 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/org/org-2/registration',
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('serves an org token its own registration', async () => {
    const { app, orgTokenStore, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, 'org-1');
    orgTokenStore.issue('org-1', 'org-1-token');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/org/org-1/registration',
      headers: { authorization: 'Bearer org-1-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ orgId: 'org-1', domain: 'acme.example' });
  });

  it('rejects a request with no credential at all on either surface', async () => {
    const { app, awsGateway } = buildTestServer();
    await seedOrg(awsGateway, 'org-1');

    const admin = await app.inject({ method: 'GET', url: '/v1/admin/orgs/org-1' });
    const org = await app.inject({ method: 'GET', url: '/v1/org/org-1/registration' });

    expect(admin.statusCode).toBe(401);
    expect(org.statusCode).toBe(401);
  });
});
