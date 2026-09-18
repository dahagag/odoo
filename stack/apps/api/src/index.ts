import { buildAwsGateway } from './aws/gateway';
import { InMemoryMagicLinkStore } from './auth/magicLink';
import { InMemoryOrgTokenStore } from './auth/orgToken';
import { buildEmailSender } from './auth/sesEmailSender';
import { InMemoryWakeRateLimiter } from './auth/wakeRateLimit';
import { loadEnv } from './config/env';
import { DynamoIdempotencyStore } from './idempotency/store';
import { buildProvisioner } from './org/awsProvisioner';
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
    // No `STEP_FUNCTIONS_STATE_MACHINE_ARN` configured keeps this on the no-op default (#278);
    // configuring one switches to the real Step Functions-backed provisioner (#280).
    provisioner: buildProvisioner(env, awsGateway),
    // A durable magic-link store lands once #200's magic-link flow needs to survive a restart -
    // same "in-memory now" precedent as orgTokenStore above.
    magicLinkStore: new InMemoryMagicLinkStore(),
    // Console under STACK_AWS_MODE=fake, a real SES send under STACK_AWS_MODE=real (#327) -
    // mirroring buildAwsGateway/buildProvisioner above, rather than hardcoding the console one.
    emailSender: buildEmailSender(env, awsGateway),
    wakeRateLimiter: new InMemoryWakeRateLimiter(),
  });

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
