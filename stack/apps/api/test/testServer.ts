import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { InMemoryOrgTokenStore } from '../src/auth/orgToken';
import { loadEnv } from '../src/config/env';
import { InMemoryIdempotencyStore } from '../src/idempotency/store';
import { buildServer } from '../src/server';

export function buildTestServer(envOverrides: Partial<Record<string, string>> = {}) {
  const awsGateway = new InMemoryAwsGateway();
  const orgTokenStore = new InMemoryOrgTokenStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const app = buildServer({
    env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...envOverrides } as NodeJS.ProcessEnv),
    awsGateway,
    orgTokenStore,
    idempotencyStore,
  });
  return { app, awsGateway, orgTokenStore, idempotencyStore };
}

export async function seedOrg(awsGateway: InMemoryAwsGateway, orgId: string, overrides: Partial<Record<string, unknown>> = {}) {
  await awsGateway.dynamoDb.putItem({
    table: 'orgs',
    item: {
      pk: `org#${orgId}`,
      type: 'trial',
      state: 'active',
      name: 'Acme Evaluation',
      domain: 'acme.example',
      seatsUsed: 1,
      seatsTotal: 25,
      ...overrides,
    },
  });
}
