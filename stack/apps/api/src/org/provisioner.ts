import type { OrgAction } from '@stack/domain';
import type { OrgRecord } from './record';

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
}

export class StubProvisioner implements Provisioner {
  async issue(): Promise<void> {}
  async suspend(): Promise<void> {}
  async wake(): Promise<void> {}
  async destroy(): Promise<void> {}
}

export function callProvisioner(provisioner: Provisioner, action: OrgAction, org: OrgRecord, jobId: string): Promise<void> {
  return provisioner[action](org, jobId);
}
