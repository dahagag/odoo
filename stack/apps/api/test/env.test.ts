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

  it('accepts NODE_ENV=production once both are set to production-safe values', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      STACK_AWS_MODE: 'real',
      ORG_ROOT_DNS_ZONE: 'orgs.example.com',
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('leaves non-production environments unaffected by the guard', () => {
    expect(() => loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
