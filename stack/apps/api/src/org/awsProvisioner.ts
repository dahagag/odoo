import { ExecutionAlreadyExistsError } from '@stack/aws-gateway';
import type { AwsGateway, DescribeExecutionResult, ExecutionHistoryEvent } from '@stack/aws-gateway';
import type { OrgAction } from '@stack/domain';
import type { Env } from '../config/env';
import { ORGS_TABLE, compact, orgPk } from './record';
import type { OrgRecord } from './record';
import type { AuditTrail, Provisioner } from './provisioner';
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
    // Both can still be blank: an org that reached `active` while `StubProvisioner` was in
    // effect never had `issue` stage a pending version to fall back to. Reject before the AWS
    // call rather than starting an execution missing required input, which would only fail
    // deep inside the state machine with an opaque error (this ticket's own "fails fast ...
    // rather than surfacing an opaque AWS error later" principle, applied here too).
    if (!amiId || !tofuModuleGitSha) {
      throw new ProvisionerConfigError(`Cannot destroy org ${org.orgId}: no deployment version has been recorded`);
    }
    await this.startExecution(org, jobId, 'destroy', {
      dnsRecordName,
      amiId,
      tofuModuleGitSha,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
    });
  }

  /**
   * Poll `org`'s most recently started job to a terminal status, if it hasn't reached one
   * already (#281, mirrors `AwsProvisioner.check_status`,
   * `custom_addons/hosting_admin/models/provisioner.py`). A no-op unless the record actually has
   * an unfinished job with a recorded execution ARN to check - covers both "no job was ever
   * started" and "the last job already settled", so a caller can call this unconditionally for
   * every org without pre-filtering.
   */
  async checkStatus(org: OrgRecord): Promise<void> {
    if (org.lastJobStatus !== 'running' || !org.lastExecutionArn) return;

    let execution: DescribeExecutionResult;
    try {
      execution = await this.gateway.stepFunctions.describeExecution(org.lastExecutionArn);
    } catch (error) {
      // Transient AWS/network trouble describing the execution isn't itself a lifecycle
      // failure - lastJobStatus stays 'running' and the next poll tries again.
      console.error(`Could not describe Step Functions execution ${org.lastExecutionArn} for org ${org.orgId}:`, error);
      return;
    }

    if (execution.status === 'RUNNING') return;

    if (execution.status === 'SUCCEEDED') {
      await this.gateway.dynamoDb.updateItem({
        table: ORGS_TABLE,
        key: { pk: orgPk(org.orgId) },
        // Promotes the pending Deployment Version (ADR-0024) staged by issue() onto the
        // recorded/audit fields - a no-op re-copy for a suspend/wake/destroy success, since only
        // issue() ever changes the pending fields. compact() drops either key entirely rather
        // than clobbering an already-recorded version with `undefined` for an org that reached
        // 'active' under StubProvisioner before this Provisioner ever ran.
        set: compact({
          lastJobStatus: 'succeeded',
          lastJobError: '',
          amiId: org.pendingAmiId,
          tofuModuleGitSha: org.pendingTofuModuleGitSha,
        }),
      });
      return;
    }

    // FAILED, TIMED_OUT or ABORTED - including a failure Step Functions itself terminates the
    // execution for (e.g. after exhausting a Task's Retry). Surfaced as a clear, readable error
    // on the record rather than left for an admin to go dig up in the AWS console.
    await this.gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { lastJobStatus: 'failed', lastJobError: describeFailure(execution) },
    });
  }

  /**
   * `org`'s lifecycle audit trail (#281, docs/adr/0022): `DescribeExecution` for the overall
   * status/timing of its most recently started execution, plus `GetExecutionHistory` for
   * step-by-step detail. Read fresh on every call; never cached or persisted (mirrors
   * `AwsProvisioner.get_audit_trail`, `custom_addons/hosting_admin/models/provisioner.py`).
   *
   * Degrades to `{available: false}` rather than throwing when there's no recorded execution to
   * ask about, or `DescribeExecution` itself fails (e.g. transient AWS/network trouble). A
   * `GetExecutionHistory` failure alone instead keeps `available: true` with
   * `stepsAvailable: false` - the overall status/timing is still real and worth showing even
   * without the step detail.
   */
  async getAuditTrail(org: OrgRecord): Promise<AuditTrail> {
    if (!org.lastExecutionArn) return { available: false };

    let execution: DescribeExecutionResult;
    try {
      execution = await this.gateway.stepFunctions.describeExecution(org.lastExecutionArn);
    } catch (error) {
      console.error(`Could not describe Step Functions execution ${org.lastExecutionArn} for org ${org.orgId}'s audit trail:`, error);
      return { available: false };
    }

    let stepsAvailable = true;
    let stepsUnavailableReason: string | undefined;
    const steps: ExecutionHistoryEvent[] = [];
    try {
      let nextToken: string | undefined;
      do {
        // GetExecutionHistory defaults to (and caps a single page at) 100 events; a retried Task
        // (ADR-0019's Retry/BackoffRate) or a long execution can exceed that, so a single-page
        // read can silently truncate the trail - keep following nextToken until AWS stops
        // returning one.
        const history = await this.gateway.stepFunctions.getExecutionHistory(org.lastExecutionArn, nextToken);
        steps.push(...history.events);
        nextToken = history.nextToken;
      } while (nextToken);
    } catch (error) {
      stepsAvailable = false;
      stepsUnavailableReason = describeHistoryFailure(error);
      console.error(`Could not get Step Functions execution history for ${org.lastExecutionArn} for org ${org.orgId}'s audit trail:`, error);
    }

    return {
      available: true,
      action: org.lastJobAction,
      jobId: org.lastJobId,
      status: execution.status,
      startDate: execution.startDate,
      stopDate: execution.stopDate,
      stepsAvailable,
      stepsUnavailableReason,
      steps,
    };
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

/** Mirrors `AwsProvisioner._describe_failure`
 * (`custom_addons/hosting_admin/models/provisioner.py`): a clear, readable label for a
 * terminal-but-not-`SUCCEEDED` execution, using whatever AWS itself reported rather than a
 * generic "job failed". */
function describeFailure(execution: DescribeExecutionResult): string {
  const error = execution.error ?? execution.status;
  return execution.cause ? `${error}: ${execution.cause}` : error;
}

/** Mirrors `AwsProvisioner._describe_history_failure`
 * (`custom_addons/hosting_admin/models/provisioner.py`): a best-effort label for why
 * `GetExecutionHistory` failed, read from the AWS SDK error's own name (e.g.
 * `AccessDeniedException`, `ThrottlingException`) when it raised a real SDK error - never a
 * guessed cause. Falls back to `String(error)` for anything that isn't an `Error` at all (e.g. a
 * network-level failure that never reached AWS). */
function describeHistoryFailure(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
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
