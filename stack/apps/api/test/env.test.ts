import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv - production configuration guard', () => {
  it('rejects NODE_ENV=production with the default fake STACK_AWS_MODE', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/STACK_AWS_MODE/);
  });

  it('rejects NODE_ENV=production with fake STACK_AWS_MODE for wiring the in-memory magic-link adapters (#326, #327)', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', STACK_AWS_MODE: 'fake' } as NodeJS.ProcessEnv))
      .toThrow(/(?=.*InMemoryMagicLinkStore)(?=.*ConsoleEmailSender)/);
  });

  it('rejects NODE_ENV=production with the placeholder ORG_ROOT_DNS_ZONE', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
    } as NodeJS.ProcessEnv)).toThrow(/ORG_ROOT_DNS_ZONE/);
  });

  it('rejects NODE_ENV=production with no state machine ARN configured (#280)', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
    } as NodeJS.ProcessEnv)).toThrow(/STEP_FUNCTIONS_STATE_MACHINE_ARN/);
  });

  it('rejects NODE_ENV=production with the placeholder CLIENT_APP_BASE_URL (#200)', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
    } as NodeJS.ProcessEnv)).toThrow(/CLIENT_APP_BASE_URL/);
  });

  it('rejects a production CLIENT_APP_BASE_URL that is plain http (#318: the magic-link token travels in its query string)', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
      CLIENT_APP_BASE_URL: 'http://app.example.com',
    } as NodeJS.ProcessEnv)).toThrow(/https/);
  });

  it('rejects a production CLIENT_APP_BASE_URL carrying a path, query, or credentials', () => {
    const base = {
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
    };
    expect(() => loadEnv({ ...base, CLIENT_APP_BASE_URL: 'https://app.example.com/some-path' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_APP_BASE_URL/);
    expect(() => loadEnv({ ...base, CLIENT_APP_BASE_URL: 'https://app.example.com?x=1' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_APP_BASE_URL/);
    expect(() => loadEnv({ ...base, CLIENT_APP_BASE_URL: 'https://user:pass@app.example.com' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_APP_BASE_URL/);
    expect(() => loadEnv({ ...base, CLIENT_APP_BASE_URL: 'not a url' } as NodeJS.ProcessEnv)).toThrow(/CLIENT_APP_BASE_URL/);
  });

  it('rejects NODE_ENV=production with the placeholder SES_FROM_ADDRESS (#327)', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
      CLIENT_APP_BASE_URL: 'https://app.example.com',
    } as NodeJS.ProcessEnv)).toThrow(/SES_FROM_ADDRESS/);
  });

  it('accepts NODE_ENV=production once every production-safe value is set, including STACK_AWS_MODE=real selecting the durable magic-link adapters (#326, #327)', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
      CLIENT_APP_BASE_URL: 'https://app.example.com',
      SES_FROM_ADDRESS: 'sign-in@app.example.com',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('leaves non-production environments unaffected by the guard', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
