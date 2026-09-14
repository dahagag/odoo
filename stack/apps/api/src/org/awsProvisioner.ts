import { ConditionalCheckFailedError, ExecutionAlreadyExistsError } from '@stack/aws-gateway';
import type { AwsGateway } from '@stack/aws-gateway';
import type { OrgAction } from '@stack/domain';
import type { Env } from '../config/env';
import { ORGS_TABLE, compact, orgPk } from './record';
import type { OrgRecord } from './record';
import type { Provisioner } from './provisioner';
import { StubProvisioner } from './provisioner';
import type { LifecycleOperation } from './lifecycleOperation';

/** The snapshot retention window `destroy`'s execution input carries (docs/contexts/hosting/
 * CONTEXT.md's Auto-Destroy entry: "A short-lived (7-day) database snapshot is retained
 * afterward in case of revival") - mirrors `SNAPSHOT_RETENTION_DAYS`
 * (`custom_addons/hosting_admin/models/provisioner.py`) one language over, so both ports agree
 * on the figure rather than drifting apart. */
export const SNAPSHOT_RETENTION_DAYS = 7;
const OPERATION_SNAPSHOT_TTL_MS = 92 * 24 * 60 * 60 * 1000;

interface LifecycleOperationSnapshot {
  operationId: string;
  orgId: string;
  action: OrgAction;
  executionName: string;
  input: Record<string, unknown>;
}

function lifecycleOperationPk(operationId: string): string {
  return `lifecycle-operation#${operationId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

  async issue(org: OrgRecord, operation: LifecycleOperation): Promise<void> {
    const snapshot = await this.startExecution(org, operation, 'issue', () => ({
      amiId: this.requireConfig('baseAmiId'),
      tofuModuleGitSha: this.requireConfig('tofuModuleGitSha'),
      dnsRecordName: this.dnsRecordName(org),
    }));

    // Stashed as pending, not written onto the audit `amiId`/`tofuModuleGitSha` fields (ADR-0024)
    // - those are promoted only once the execution actually reports success, which nothing in
    // this ticket observes yet (mirrors `AwsProvisioner.issue`'s own comment,
    // `custom_addons/hosting_admin/models/provisioner.py`).
    await this.gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: {
        pendingAmiId: snapshot.input.amiId as string,
        pendingTofuModuleGitSha: snapshot.input.tofuModuleGitSha as string,
      },
    });
  }

  async suspend(org: OrgRecord, operation: LifecycleOperation): Promise<void> {
    await this.startExecution(org, operation, 'suspend', () => ({ instanceId: this.requireInstanceId(org, 'suspend') }));
  }

  async wake(org: OrgRecord, operation: LifecycleOperation): Promise<void> {
    await this.startExecution(org, operation, 'wake', () => ({ instanceId: this.requireInstanceId(org, 'wake') }));
  }

  async destroy(org: OrgRecord, operation: LifecycleOperation): Promise<void> {
    // The org's own recorded Deployment Version (ADR-0024), not whatever is currently
    // configured - a destroy must tear down what was actually deployed. Falls back to the
    // pending version when the audit fields are still blank: a prior `issue` can have failed
    // (or still be running) yet still moved this org to `active` and left real infrastructure
    // behind for `destroy` to clean up.
    // Both can still be blank: an org that reached `active` while `StubProvisioner` was in
    // effect never had `issue` stage a pending version to fall back to. Reject before the AWS
    // call rather than starting an execution missing required input, which would only fail
    // deep inside the state machine with an opaque error (this ticket's own "fails fast ...
    // rather than surfacing an opaque AWS error later" principle, applied here too).
    await this.startExecution(org, operation, 'destroy', () => {
      const amiId = org.amiId ?? org.pendingAmiId;
      const tofuModuleGitSha = org.tofuModuleGitSha ?? org.pendingTofuModuleGitSha;
      if (!amiId || !tofuModuleGitSha) {
        throw new ProvisionerConfigError(`Cannot destroy org ${org.orgId}: no deployment version has been recorded`);
      }
      return {
        dnsRecordName: this.dnsRecordName(org),
        amiId,
        tofuModuleGitSha,
        snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
      };
    });
  }

  private async startExecution(
    org: OrgRecord,
    operation: LifecycleOperation,
    action: OrgAction,
    freshInput: () => Record<string, unknown>,
  ): Promise<LifecycleOperationSnapshot> {
    const snapshot = await this.loadOrCreateSnapshot(org, operation, action, freshInput);

    let executionArn: string;
    try {
      const result = await this.gateway.stepFunctions.startExecution({
        stateMachineArn: this.config.stateMachineArn,
        executionName: snapshot.executionName,
        input: snapshot.input,
      });
      executionArn = result.executionArn;
    } catch (error) {
      if (!(error instanceof ExecutionAlreadyExistsError)) throw new StartExecutionError(org.orgId, action, error);
      const existing = await this.gateway.stepFunctions.describeExecution(error.executionArn);
      if (!['RUNNING', 'SUCCEEDED'].includes(existing.status)) {
        throw new StartExecutionError(
          org.orgId,
          action,
          new Error(`existing lifecycle execution ${error.executionArn} ended ${existing.status}`),
        );
      }
      executionArn = error.executionArn;
    }

    await this.gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { lastExecutionArn: executionArn },
    });
    return snapshot;
  }

  /**
   * The persisted provider input is first-writer-wins. A reclaimed leader reads the snapshot
   * before consulting mutable org fields or configuration.
   */
  private async loadOrCreateSnapshot(
    org: OrgRecord,
    operation: LifecycleOperation,
    action: OrgAction,
    freshInput: () => Record<string, unknown>,
  ): Promise<LifecycleOperationSnapshot> {
    const key = { pk: lifecycleOperationPk(operation.id) };
    const existing = await this.readSnapshot(key, operation, org.orgId, action);
    if (existing) return existing;

    const snapshot: LifecycleOperationSnapshot = {
      operationId: operation.id,
      orgId: org.orgId,
      action,
      executionName: operation.id,
      // Identity fields come last so no action-specific provider input can ever replace them.
      input: compact({ ...freshInput(), orgId: org.orgId, operationId: operation.id, action }),
    };
    try {
      await this.gateway.dynamoDb.putItem({
        table: ORGS_TABLE,
        item: {
          pk: key.pk,
          ...snapshot,
          createdAt: new Date().toISOString(),
          // Standard Step Functions reserves a closed name for 90 days. The lifecycle workflow
          // is bounded to hours, so this extra two-day margin covers its full reservation period.
          ttl: Math.floor((Date.now() + OPERATION_SNAPSHOT_TTL_MS) / 1000),
        },
        condition: { type: 'attribute_not_exists', attribute: 'pk' },
      });
      return snapshot;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedError)) throw error;
      const raced = await this.readSnapshot(key, operation, org.orgId, action);
      if (raced) return raced;
      throw new Error(`Lifecycle operation snapshot ${operation.id} disappeared after its conditional write lost`);
    }
  }

  private async readSnapshot(
    key: { pk: string },
    operation: LifecycleOperation,
    orgId: string,
    action: OrgAction,
  ): Promise<LifecycleOperationSnapshot | undefined> {
    const item = await this.gateway.dynamoDb.getItem({ table: ORGS_TABLE, key });
    if (!item) return undefined;
    if (
      item.operationId !== operation.id
      || item.orgId !== orgId
      || item.action !== action
      || item.executionName !== operation.id
      || !isRecord(item.input)
    ) {
      throw new Error(`Lifecycle operation snapshot ${operation.id} has an invalid immutable identity`);
    }
    return {
      operationId: item.operationId as string,
      orgId: item.orgId as string,
      action: item.action as OrgAction,
      executionName: item.executionName as string,
      input: item.input,
    };
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
