import { buildAwsGateway } from './aws/gateway';
import { InMemoryOrgTokenStore } from './auth/orgToken';
import { loadEnv } from './config/env';
import { DynamoIdempotencyStore } from './idempotency/store';
import { buildServer } from './server';

async function main(): Promise<void> {
  const env = loadEnv();
  const awsGateway = buildAwsGateway(env);
  const app = buildServer({
    env,
    awsGateway,
    // A DynamoDB-backed OrgTokenStore lands with the lifecycle port (#196), once org records
    // (and the tokens issued alongside them) exist to resolve against.
    orgTokenStore: new InMemoryOrgTokenStore(),
    idempotencyStore: new DynamoIdempotencyStore(awsGateway),
  });

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
