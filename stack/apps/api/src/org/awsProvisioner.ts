import { ExecutionAlreadyExistsError } from '@stack/aws-gateway';
import type { AwsGateway } from '@stack/aws-gateway';
import type { OrgAction } from '@stack/domain';
import type { Env } from '../config/env';
import { ORGS_TABLE, compact, orgPk } from './record';
import type { OrgRecord } from './record';
import type { Provisioner } from './provisioner';
import { StubProvisioner } from './provisioner';

/** The snapshot retention window `destroy`'s execution input carries (docs/contexts/hosting/
 * CONTEXT.md's Auto-Destroy entry: "A short-lived (7-day) database snapshot is retained
 * afterward in case of revival") - mirrors `SNAPSHOT_RETENTION_DAYS`
 * (`custom_addons/hosting_admin/models/provisioner.py`) one language over, so both ports agree
 * on the figure rather than drifting apart. */
export const SNAPSHOT_RETENTION_DAYS = 7;

export interface AwsProvisionerConfig {
  stateMachineArn: string;
  baseAmiId?: string;
  tofuModuleGitSha?: string;
  dnsDomainSuffix?: string;
}

/** Missing configuration `AwsProvisioner` needs to shape an execution's input - raised before
 * any AWS call is attempted (this ticket's What to build: "fails fast ... rather than surfacing
 * an opaque AWS error later"), mirroring `UserError` from
 * `AwsProvisioner._require_module_config`/`_require_instance_id`
 * (`custom_addons/hosting_admin/models/provisioner.py`) one language over. */
export class ProvisionerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionerConfigError';
  }
}

/** A `StartExecution` call failed for a reason other than the name-collision retry
 * `AwsProvisioner` treats as success (this ticket's Acceptance Criteria: "any other
 * `StartExecution` failure surfaces as a clear, actionable error"). Carries its own structured
 * fields - not just a formatted message - matching every other custom error in this module's
 * neighborhood (`org/errors.ts`, `aws-gateway/src/errors.ts`), so a caller can act on the
 * identifying data programmatically rather than parsing the message. */
export class StartExecutionError extends Error {
  constructor(readonly orgId: string, readonly action: OrgAction, override readonly cause: unknown) {
    super(`Could not start the ${action} action for org ${orgId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StartExecutionError';
  }
}

/**
 * Real `Provisioner`: starts a Step Functions execution per lifecycle action, on the stack's own
 * `AwsGateway` seam (this ticket's What to build: "no direct AWS SDK usage, no live AWS in
 * tests") - the TS port of `AwsProvisioner`
 * (`custom_addons/hosting_admin/models/provisioner.py`).
 *
 * Execution name and input are shaped per ADR-0019 and each action's own needs: `issue` stages
 * the pending Deployment Version fields (ADR-0024) without touching the org's already-recorded
 * (audit) ones; `destroy` carries the org's own recorded deployment version - falling back to
 * the pending version when nothing has been recorded yet, since a destroy must tear down what
 * was actually deployed, not whatever is currently configured; `suspend`/`wake` carry the org's
 * instance id and omit Deployment Version fields entirely.
 */
export class AwsProvisioner implements Provisioner {
  constructor(private readonly gateway: AwsGateway, private readonly config: AwsProvisionerConfig) {
    if (!config.stateMachineArn) {
      throw new ProvisionerConfigError('AwsProvisioner requires a stateMachineArn');
    }
  }

  async issue(org: OrgRecord, jobId: string): Promise<void> {
    const amiId = this.requireConfig('baseAmiId');
    const tofuModuleGitSha = this.requireConfig('tofuModuleGitSha');
    const dnsRecordName = this.dnsRecordName(org);

    await this.startExecution(org, jobId, 'issue', { amiId, tofuModuleGitSha, dnsRecordName });

    // Stashed as pending, not written onto the audit `amiId`/`tofuModuleGitSha` fields (ADR-0024)
    // - those are promoted only once the execution actually reports success, which nothing in
    // this ticket observes yet (mirrors `AwsProvisioner.issue`'s own comment,
    // `custom_addons/hosting_admin/models/provisioner.py`).
    await this.gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { pendingAmiId: amiId, pendingTofuModuleGitSha: tofuModuleGitSha },
    });
  }

  async suspend(org: OrgRecord, jobId: string): Promise<void> {
    const instanceId = this.requireInstanceId(org, 'suspend');
    await this.startExecution(org, jobId, 'suspend', { instanceId });
  }

  async wake(org: OrgRecord, jobId: string): Promise<void> {
    const instanceId = this.requireInstanceId(org, 'wake');
    await this.startExecution(org, jobId, 'wake', { instanceId });
  }

  async destroy(org: OrgRecord, jobId: string): Promise<void> {
    const dnsRecordName = this.dnsRecordName(org);
    // The org's own recorded Deployment Version (ADR-0024), not whatever is currently
    // configured - a destroy must tear down what was actually deployed. Falls back to the
    // pending version when the audit fields are still blank: a prior `issue` can have failed
    // (or still be running) yet still moved this org to `active` and left real infrastructure
    // behind for `destroy` to clean up.
    const amiId = org.amiId ?? org.pendingAmiId;
    const tofuModuleGitSha = org.tofuModuleGitSha ?? org.pendingTofuModuleGitSha;
    await this.startExecution(org, jobId, 'destroy', {
      dnsRecordName,
      amiId,
      tofuModuleGitSha,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
    });
  }

  private async startExecution(
    org: OrgRecord,
    jobId: string,
    action: OrgAction,
    extraInput: Record<string, unknown>,
  ): Promise<void> {
    // Fixed, deterministic format (ADR-0019: `trial-<trial_org_id>-<job_id>`, generalized here
    // from `<orgId>` to cover a Client Org too, not only a Trial Org) - never auto-generated by
    // `startExecution` itself, so a retry with the same `jobId` derives the same execution name
    // every time.
    const executionName = `org-${org.orgId}-${jobId}`;
    const input = compact({ orgId: org.orgId, jobId, action, ...extraInput });

    let executionArn: string;
    try {
      const result = await this.gateway.stepFunctions.startExecution({
        stateMachineArn: this.config.stateMachineArn,
        executionName,
        input,
      });
      executionArn = result.executionArn;
    } catch (error) {
      if (!(error instanceof ExecutionAlreadyExistsError)) throw new StartExecutionError(org.orgId, action, error);
      // A genuine retry: the same job id derives the same execution name/input, which Step
      // Functions itself already recognizes as the same execution rather than starting a second
      // one (ADR-0019, this ticket's Acceptance Criteria) - not an error to surface.
      executionArn = error.executionArn;
    }

    await this.gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { lastExecutionArn: executionArn },
    });
  }

  private dnsRecordName(org: OrgRecord): string {
    const suffix = this.requireConfig('dnsDomainSuffix');
    return `${org.dnsSubdomainLabel}.${suffix}`;
  }

  /** Reads `name` off this instance's own config - keyed by `keyof AwsProvisionerConfig`, not a
   * free-standing string, so the field actually being checked can never drift out of sync with
   * the name reported in the error. */
  private requireConfig<K extends keyof AwsProvisionerConfig>(name: K): NonNullable<AwsProvisionerConfig[K]> {
    const value = this.config[name];
    if (!value) throw new ProvisionerConfigError(`Cannot provision an org: ${name} is not configured`);
    return value as NonNullable<AwsProvisionerConfig[K]>;
  }

  private requireInstanceId(org: OrgRecord, action: string): string {
    if (!org.instanceId) {
      throw new ProvisionerConfigError(`Cannot ${action} org ${org.orgId}: no EC2 instance id has been recorded for it yet`);
    }
    return org.instanceId;
  }
}

/** Chooses the no-op or the real `Provisioner` from config, mirroring `buildAwsGateway`
 * (`aws/gateway.ts`): no state machine ARN configured keeps every org on `StubProvisioner`
 * unchanged (this ticket's Acceptance Criteria); configuring one switches every org to
 * `AwsProvisioner`. */
export function buildProvisioner(env: Env, gateway: AwsGateway): Provisioner {
  if (!env.STEP_FUNCTIONS_STATE_MACHINE_ARN) return new StubProvisioner();
  return new AwsProvisioner(gateway, {
    stateMachineArn: env.STEP_FUNCTIONS_STATE_MACHINE_ARN,
    baseAmiId: env.BASE_AMI_ID,
    tofuModuleGitSha: env.TOFU_MODULE_GIT_SHA,
    dnsDomainSuffix: env.ORG_ROOT_DNS_ZONE,
  });
}
