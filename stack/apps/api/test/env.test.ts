import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv - production configuration guard', () => {
  it('rejects NODE_ENV=production with the default fake STACK_AWS_MODE', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/STACK_AWS_MODE/);
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

  it('accepts NODE_ENV=production once every production-safe value is set', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('leaves non-production environments unaffected by the guard', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
