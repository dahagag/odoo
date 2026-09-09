import { z } from 'zod';

/**
 * Every environment fact the stack needs is read here, once, and validated - never read from
 * `process.env` ad hoc elsewhere. `orgRootDnsZone` in particular must stay configuration (this
 * ticket's Implementation Decisions: "the org root DNS zone is configuration, not a constant,
 * per the epic's configurable-root decision").
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ORG_ROOT_DNS_ZONE: z.string().min(1).default('example.invalid'),
  /** `fake` (default) runs the seam against `InMemoryAwsGateway` - the "runnable locally
   * against the AWS fake" requirement (this ticket's User Stories, #11) - `real` constructs
   * `AwsSdkGateway`, requiring the AWS_* variables below. */
  STACK_AWS_MODE: z.enum(['fake', 'real']).default('fake'),
  AWS_REGION: z.string().default('us-east-1'),
  DYNAMO_TABLE_ORGS: z.string().default('orgs'),
  DYNAMO_TABLE_LOCKS: z.string().default('locks'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
