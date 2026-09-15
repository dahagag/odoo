import type { ExecutionHistoryEvent, ExecutionStatus } from '@stack/aws-gateway';
import type { OrgAction } from '@stack/domain';
import type { OrgRecord } from './record';

/**
 * `org`'s lifecycle audit trail (#281, docs/adr/0022): the overall status/timing of its most
 * recently started execution plus step-by-step detail, read live - never cached or persisted.
 * A plain discriminated union rather than a bespoke class, mirroring `AwsProvisioner.
 * get_audit_trail`'s own plain-dict return (`custom_addons/hosting_admin/models/provisioner.py`)
 * one language over: the route layer reads it directly and it never round-trips back through a
 * `Provisioner` call.
 *
 * `steps`/`stepsUnavailableReason` degrade independently of `available`: a `GetExecutionHistory`
 * failure alone still leaves the overall status/timing worth showing (`stepsAvailable: false`),
 * distinct from `available: false` (no execution to ask about at all, or `DescribeExecution`
 * itself failed).
 */
export type AuditTrail =
  | { available: false }
  | {
      available: true;
      action?: OrgAction;
      jobId?: string;
      status?: ExecutionStatus;
      startDate?: Date;
      stopDate?: Date;
      stepsAvailable: boolean;
      stepsUnavailableReason?: string;
      steps: ExecutionHistoryEvent[];
    };

/**
 * Injectable seam standing in for the AWS/Step-Functions call surface behind every org lifecycle
 * action (this ticket, #278; docs/adr/0016, docs/adr/0019) - mirrors `Provisioner`
 * (custom_addons/hosting_admin/models/provisioner.py) one language over. `applyTransition`
 * (`record.ts`) calls exactly one of these methods per action, passing the org record as it
 * stood immediately before the transition and a freshly-minted job id (ADR-0019: "a fresh id is
 * minted before any write"). The persisted state change only happens once the call here
 * resolves - a throw here prevents the state change entirely (this ticket's Acceptance
 * Criteria: "a provisioner failure ... prevents the state change entirely - no partial write").
 *
 * `StubProvisioner` is the default: a true no-op, so this ticket needs no real AWS wiring. A
 * later sub-ticket (#280) swaps in the Step Functions-backed implementation without any caller
 * of `applyTransition` changing.
 */
export interface Provisioner {
  issue(org: OrgRecord, jobId: string): Promise<void>;
  suspend(org: OrgRecord, jobId: string): Promise<void>;
  wake(org: OrgRecord, jobId: string): Promise<void>;
  destroy(org: OrgRecord, jobId: string): Promise<void>;
  /** Poll `org`'s most recently started job to a terminal status, if it hasn't reached one
   * already, promoting/failing the record as observed (#281, docs/adr/0019) - mirrors
   * `Provisioner.check_status` (`custom_addons/hosting_admin/models/provisioner.py`) one
   * language over. A true no-op on `StubProvisioner`, matching its never-called-AWS reality;
   * real behavior lives on `AwsProvisioner` alone. */
  checkStatus(org: OrgRecord): Promise<void>;
  /** See `AuditTrail`'s own docstring. `{available: false}` on `StubProvisioner`, matching its
   * never-called-AWS reality and giving a caller its "unavailable" state for free rather than a
   * bespoke per-implementation check - mirrors `Provisioner.get_audit_trail`'s own concrete
   * default. */
  getAuditTrail(org: OrgRecord): Promise<AuditTrail>;
}

export class StubProvisioner implements Provisioner {
  async issue(): Promise<void> {}
  async suspend(): Promise<void> {}
  async wake(): Promise<void> {}
  async destroy(): Promise<void> {}
  async checkStatus(): Promise<void> {}
  async getAuditTrail(): Promise<AuditTrail> {
    return { available: false };
  }
}

export function callProvisioner(provisioner: Provisioner, action: OrgAction, org: OrgRecord, jobId: string): Promise<void> {
  return provisioner[action](org, jobId);
}
