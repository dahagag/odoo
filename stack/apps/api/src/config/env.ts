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
  /** `AwsProvisioner`'s own config (#280, ADR-0019) - absent (the default) keeps every org on
   * `StubProvisioner`, exactly like before this ticket; setting it switches every org to the
   * real Step Functions-backed provisioner (this ticket's Acceptance Criteria). */
  STEP_FUNCTIONS_STATE_MACHINE_ARN: z.string().optional(),
  /** `issue`'s Deployment Version inputs (ADR-0024) - required only once an execution is
   * actually started; `AwsProvisioner.issue` fails fast, before any AWS call, when either is
   * unset (this ticket's Acceptance Criteria). */
  BASE_AMI_ID: z.string().optional(),
  TOFU_MODULE_GIT_SHA: z.string().optional(),
  /** The public client app's own origin (#200) - magic-link emails point here, at
   * `/sign-in/verify?token=...`, never back at this API directly. */
  CLIENT_APP_BASE_URL: z.string().default('https://example.invalid'),
  /** `SesEmailSender`'s (#327) `Source` address - must be a verified identity (or a verified
   * domain's address) under the SES domain identity `infra/platform` provisions, or SES rejects
   * the send outright. */
  SES_FROM_ADDRESS: z.string().default('sign-in@example.invalid'),
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
  if (env.CLIENT_APP_BASE_URL === 'https://example.invalid') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CLIENT_APP_BASE_URL'],
      message: 'CLIENT_APP_BASE_URL must be set explicitly when NODE_ENV=production',
    });
  } else {
    // The magic-link token travels in this URL's own query string (CodeRabbit, PR #318) - an
    // http:// origin would send that live credential in cleartext, and a path/query/fragment/
    // credentials here would mean two different callers building the same verify URL disagree
    // on where the token actually goes.
    let clientAppUrl: URL | undefined;
    try {
      clientAppUrl = new URL(env.CLIENT_APP_BASE_URL);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLIENT_APP_BASE_URL'], message: 'CLIENT_APP_BASE_URL must be a syntactically valid URL' });
    }
    if (clientAppUrl) {
      if (clientAppUrl.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLIENT_APP_BASE_URL'], message: 'CLIENT_APP_BASE_URL must use https: in production' });
      }
      if (clientAppUrl.username || clientAppUrl.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLIENT_APP_BASE_URL'], message: 'CLIENT_APP_BASE_URL must not carry credentials' });
      }
      if (clientAppUrl.search || clientAppUrl.hash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLIENT_APP_BASE_URL'], message: 'CLIENT_APP_BASE_URL must not carry a query string or fragment' });
      }
      if (clientAppUrl.pathname !== '/') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLIENT_APP_BASE_URL'], message: 'CLIENT_APP_BASE_URL must be an origin only, with no path' });
      }
    }
  }
  if (env.SES_FROM_ADDRESS === 'sign-in@example.invalid') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SES_FROM_ADDRESS'],
      message: 'SES_FROM_ADDRESS must be set explicitly when NODE_ENV=production',
    });
  }
  // Mirrors the STACK_AWS_MODE guard above: an unset STEP_FUNCTIONS_STATE_MACHINE_ARN silently
  // keeps every org on StubProvisioner (#280's buildProvisioner) - a true no-op that never
  // provisions any real infrastructure, with no runtime signal that this happened. A production
  // process must not be able to start "successfully" in that state.
  if (!env.STEP_FUNCTIONS_STATE_MACHINE_ARN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STEP_FUNCTIONS_STATE_MACHINE_ARN'],
      message: 'STEP_FUNCTIONS_STATE_MACHINE_ARN must be set when NODE_ENV=production',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
