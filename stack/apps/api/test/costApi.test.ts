import { describe, expect, it } from 'vitest';
import { buildTestServer } from './testServer';

const ADMIN_HEADERS = { 'x-stack-admin-principal': 'arn:aws:iam::000000000000:role/staff-app' };

describe('GET /v1/admin/cost/dashboard (this ticket, #198)', () => {
  it('reports unavailable with no snapshot yet, rather than a stale/zeroed figure', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/v1/admin/cost/dashboard', headers: ADMIN_HEADERS });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
  });

  it('requires an admin principal', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/v1/admin/cost/dashboard' });

    expect(response.statusCode).toBe(401);
  });

  it('returns the snapshot the refresh route just produced', async () => {
    const { app, awsGateway } = buildTestServer();
    awsGateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 12, unit: 'USD', tagValue: '' }];

    await app.inject({
      method: 'POST',
      url: '/v1/admin/cost/refresh-snapshot',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'refresh-1' },
    });
    const response = await app.inject({ method: 'GET', url: '/v1/admin/cost/dashboard', headers: ADMIN_HEADERS });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { available: boolean; snapshot?: { totalSpend: number } };
    expect(body.available).toBe(true);
    expect(body.snapshot?.totalSpend).toBe(12);
  });
});

describe('POST /v1/admin/cost/refresh-snapshot', () => {
  it('requires an admin principal', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'POST', url: '/v1/admin/cost/refresh-snapshot', headers: { 'idempotency-key': 'noauth-1' } });

    expect(response.statusCode).toBe(401);
  });

  it('requires an Idempotency-Key header', async () => {
    const { app } = buildTestServer();

    const response = await app.inject({ method: 'POST', url: '/v1/admin/cost/refresh-snapshot', headers: ADMIN_HEADERS });

    expect(response.statusCode).toBe(400);
  });

  it('surfaces a 502 when the Cost Explorer call fails', async () => {
    const { app, awsGateway } = buildTestServer();
    awsGateway.costExplorer.getCostAndUsage = async () => {
      throw Object.assign(new Error('access denied'), { name: 'AccessDeniedException' });
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/cost/refresh-snapshot',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'refresh-failure-1' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ detail: expect.stringContaining('AccessDeniedException') });
  });

  it('publishes an SNS alert once a configured spend threshold is crossed', async () => {
    const { app, awsGateway } = buildTestServer({
      AWS_COST_ALERT_SPEND_THRESHOLDS: '10',
      COST_ALERT_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:cost-alerts',
    });
    awsGateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 50, unit: 'USD', tagValue: '' }];

    await app.inject({
      method: 'POST',
      url: '/v1/admin/cost/refresh-snapshot',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'refresh-alert-1' },
    });

    expect(awsGateway.sns.publishedMessages).toHaveLength(1);
    expect(awsGateway.sns.publishedMessages[0]).toMatchObject({ topicArn: 'arn:aws:sns:us-east-1:000000000000:cost-alerts' });
  });

  it('does not publish anything when no SNS topic is configured', async () => {
    const { app, awsGateway } = buildTestServer({ AWS_COST_ALERT_SPEND_THRESHOLDS: '10' });
    awsGateway.costExplorer.amounts = [{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 50, unit: 'USD', tagValue: '' }];

    await app.inject({
      method: 'POST',
      url: '/v1/admin/cost/refresh-snapshot',
      headers: { ...ADMIN_HEADERS, 'idempotency-key': 'refresh-noalert-1' },
    });

    expect(awsGateway.sns.publishedMessages).toEqual([]);
  });
});
