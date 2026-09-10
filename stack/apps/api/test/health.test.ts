import { describe, expect, it } from 'vitest';
import { buildTestServer } from './testServer';

describe('health and readiness', () => {
  it('GET /healthz is always 200 once the process is up', async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz is 200 when the AwsGateway is reachable', async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });
});
