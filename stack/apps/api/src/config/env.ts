import { z } from 'zod';

/**
 * Every environment fact the stack needs is read here, once, and validated - never read from
 * `process.env` ad hoc elsewhere. `orgRootDnsZone` in particular must stay configuration (this
 * ticket's Implementation Decisions: "the org root DNS zone is configuration, not a constant,
 * per the epic's configurable-root decision").
 */
const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ORG_ROOT_DNS_ZONE: z.string().min(1).default('example.invalid'),
  /** Org Region (docs/contexts/hosting/CONTEXT.md): "the one region an org's infrastructure and
   * data live in ... Choosing it per org is a captured requirement, not a capability we have"
   * (#207, deferred) - every org gets this region until per-org selection ships. Deliberately
   * distinct from `AWS_REGION` below, which is where *this stack's own* AWS SDK calls run
   * (Platform Account), not where org infrastructure lives (Hosting Account). */
  DEFAULT_ORG_REGION: z.string().default('us-east-1'),
  /** docs/contexts/hosting/CONTEXT.md's Trial Org entry: "runs for a fixed window (default 14
   * days)". Never consulted for a Client Org, which carries no expiry at all. */
  TRIAL_DEFAULT_DURATION_DAYS: z.coerce.number().int().positive().default(14),
  /** `fake` (default) runs the seam against `InMemoryAwsGateway` - the "runnable locally
   * against the AWS fake" requirement (this ticket's User Stories, #11) - `real` constructs
   * `AwsSdkGateway`, requiring the AWS_* variables below. */
  STACK_AWS_MODE: z.enum(['fake', 'real']).default('fake'),
  AWS_REGION: z.string().default('us-east-1'),
  DYNAMO_TABLE_ORGS: z.string().default('orgs'),
  DYNAMO_TABLE_LOCKS: z.string().default('locks'),
  /** The release tag (e.g. "v1.2.3") this process's image was deployed under, injected as a
   * task-definition environment variable at deploy time (infra/platform) — not baked into the
   * image itself, since the image is built and pushed at PR time (by content-hash tag) before a
   * release tag naming it exists. `/healthz` surfaces this so "what's running in staging" is
   * answerable without cross-referencing ECR or ECS directly (issue #216). */
  RELEASE_VERSION: z.string().default('unknown'),
});

/** A production process must not be able to start "successfully" against dev/test defaults -
 * `STACK_AWS_MODE=fake` writes every org record and idempotency key to process memory (lost on
 * restart, and a lost idempotency key lets a replayed request re-run its downstream effect), and
 * `ORG_ROOT_DNS_ZONE`'s placeholder default means the process never noticed it was never given
 * a real one. Neither failure is visible at runtime - `/readyz` still reports `ready` - so it
 * must fail at startup instead. */
const EnvSchema = BaseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (env.STACK_AWS_MODE !== 'real') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STACK_AWS_MODE'],
      message: 'STACK_AWS_MODE must be "real" when NODE_ENV=production',
    });
  }
  if (env.ORG_ROOT_DNS_ZONE === 'example.invalid') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ORG_ROOT_DNS_ZONE'],
      message: 'ORG_ROOT_DNS_ZONE must be set explicitly when NODE_ENV=production',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
