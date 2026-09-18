import type { AwsGateway } from '@stack/aws-gateway';
import type { Env } from '../config/env';
import { ConsoleEmailSender, MAGIC_LINK_TTL_MS, type EmailSender, type MagicLinkEmail } from './magicLink';

/**
 * Real `EmailSender` (#327): delivers the sign-in URL through the `ses` sub-gateway - no direct
 * AWS SDK usage here, mirroring every other production adapter behind `AwsGateway`
 * (`AwsProvisioner`, `DynamoMagicLinkStore`). `fromAddress` must be a verified SES identity (or
 * an address under a verified domain) - `infra/platform` provisions the domain verification this
 * depends on.
 */
export class SesEmailSender implements EmailSender {
  constructor(private readonly gateway: AwsGateway, private readonly fromAddress: string) {}

  async sendMagicLink({ to, url }: MagicLinkEmail): Promise<void> {
    await this.gateway.ses.sendEmail({
      from: this.fromAddress,
      to,
      subject: 'Your sign-in link',
      textBody: `Use this link to sign in: ${url}\n\nThis link expires in ${MAGIC_LINK_TTL_MS / 60_000} minutes and can only be used once.`,
    });
  }
}

/** Chooses the console or the real SES-backed `EmailSender` from config (`STACK_AWS_MODE`),
 * mirroring `buildMagicLinkStore`/`buildAwsGateway` - the one place that decides is this factory,
 * rather than `index.ts` hardcoding `ConsoleEmailSender` regardless of environment. */
export function buildEmailSender(env: Env, gateway: AwsGateway): EmailSender {
  if (env.STACK_AWS_MODE === 'fake') return new ConsoleEmailSender();
  return new SesEmailSender(gateway, env.SES_FROM_ADDRESS);
}
