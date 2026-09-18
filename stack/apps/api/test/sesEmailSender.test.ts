import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { ConsoleEmailSender } from '../src/auth/magicLink';
import { SesEmailSender, buildEmailSender } from '../src/auth/sesEmailSender';
import { loadEnv } from '../src/config/env';

describe('SesEmailSender (#327)', () => {
  it('sends the actual sign-in URL through the ses sub-gateway, not just the recipient', async () => {
    const gateway = new InMemoryAwsGateway();
    const sender = new SesEmailSender(gateway, 'sign-in@example.com');

    await sender.sendMagicLink({
      to: 'someone@acme.example.com',
      url: 'https://app.example.com/sign-in/verify?token=abc123',
    });

    expect(gateway.ses.sentEmails).toHaveLength(1);
    const [sent] = gateway.ses.sentEmails;
    expect(sent.from).toBe('sign-in@example.com');
    expect(sent.to).toBe('someone@acme.example.com');
    expect(sent.textBody).toContain('https://app.example.com/sign-in/verify?token=abc123');
  });
});

describe('buildEmailSender (#327)', () => {
  it('stays on ConsoleEmailSender under STACK_AWS_MODE=fake (the default)', () => {
    const gateway = new InMemoryAwsGateway();
    const sender = buildEmailSender(loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), gateway);
    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });

  it('switches to SesEmailSender under STACK_AWS_MODE=real', () => {
    const gateway = new InMemoryAwsGateway();
    const sender = buildEmailSender(loadEnv({
      NODE_ENV: 'test',
      STACK_AWS_MODE: 'real',
    } as NodeJS.ProcessEnv), gateway);
    expect(sender).toBeInstanceOf(SesEmailSender);
  });
});
