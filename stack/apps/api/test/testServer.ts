import { InMemoryAwsGateway } from '@stack/aws-gateway';
import type { EmailSender, MagicLinkEmail, MagicLinkStore } from '../src/auth/magicLink';
import { InMemoryMagicLinkStore } from '../src/auth/magicLink';
import { InMemoryOrgTokenStore } from '../src/auth/orgToken';
import type { WakeRateLimiter } from '../src/auth/wakeRateLimit';
import { InMemoryWakeRateLimiter } from '../src/auth/wakeRateLimit';
import { loadEnv } from '../src/config/env';
import { InMemoryIdempotencyStore } from '../src/idempotency/store';
import type { IdempotencyStore } from '../src/idempotency/store';
import type { Provisioner } from '../src/org/provisioner';
import { StubProvisioner } from '../src/org/provisioner';
import { buildServer } from '../src/server';

/** Records every magic-link "send" instead of actually delivering it, so a test can pull the
 * token straight out of the captured URL rather than needing a real mailbox (#200). */
export class CapturingEmailSender implements EmailSender {
  readonly sent: MagicLinkEmail[] = [];

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.sent.push(email);
  }

  /** Pulls the `token` query param off the most recently sent link to `to`, or throws - a test
   * helper, not production logic. */
  tokenSentTo(to: string): string {
    const email = [...this.sent].reverse().find((sent) => sent.to === to);
    if (!email) throw new Error(`no magic link was sent to ${to}`);
    const token = new URL(email.url).searchParams.get('token');
    if (!token) throw new Error(`sent magic link has no token: ${email.url}`);
    return token;
  }
}

export interface TestServerDepsOverrides {
  provisioner?: Provisioner;
  idempotencyStore?: IdempotencyStore;
  magicLinkStore?: MagicLinkStore;
  emailSender?: EmailSender;
  wakeRateLimiter?: WakeRateLimiter;
}

export function buildTestServer(envOverrides: Partial<Record<string, string>> = {}, depsOverrides: TestServerDepsOverrides = {}) {
  const awsGateway = new InMemoryAwsGateway();
  const orgTokenStore = new InMemoryOrgTokenStore();
  const idempotencyStore = depsOverrides.idempotencyStore ?? new InMemoryIdempotencyStore();
  const provisioner = depsOverrides.provisioner ?? new StubProvisioner();
  const magicLinkStore = depsOverrides.magicLinkStore ?? new InMemoryMagicLinkStore();
  const emailSender = depsOverrides.emailSender ?? new CapturingEmailSender();
  const wakeRateLimiter = depsOverrides.wakeRateLimiter ?? new InMemoryWakeRateLimiter();
  const app = buildServer({
    env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...envOverrides } as NodeJS.ProcessEnv),
    awsGateway,
    orgTokenStore,
    idempotencyStore,
    provisioner,
    magicLinkStore,
    emailSender,
    wakeRateLimiter,
  });
  return { app, awsGateway, orgTokenStore, idempotencyStore, provisioner, magicLinkStore, emailSender, wakeRateLimiter };
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
      inviteType: 'targeted',
      ...overrides,
    },
  });
}

/** Reserves `dnsSubdomainLabel` for `orgId`, the same reservation item `createOrg` writes -
 * needed by any test exercising the public `by-dns-label` lookup (#200) without going through
 * the full `createOrg` flow. */
export async function seedDnsLabel(awsGateway: InMemoryAwsGateway, dnsSubdomainLabel: string, orgId: string) {
  await awsGateway.dynamoDb.putItem({
    table: 'orgs',
    item: { pk: `dnslabel#${dnsSubdomainLabel}`, orgId },
  });
}
