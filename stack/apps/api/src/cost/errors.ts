/** Errors the cost dashboard module (`dashboard.ts`) raises - `server.ts` maps this to a Problem
 * Details response, mirroring `org/errors.ts`'s split between seam-level and domain-level
 * failures. */

/** Wraps whatever the injected `CostExplorerGateway` call itself threw (this ticket, #198,
 * porting `hosting_admin`'s `_describe_cost_explorer_failure`/`UserError` convention): the daily
 * refresh logs the exception and surfaces a plain reason naming why the AWS call failed - a
 * transient throttle, an IAM permissions gap, or the known cost-allocation-tag activation delay
 * (docs/adr/0030) - rather than a raw, unclear exception, and leaves the prior day's snapshot
 * untouched so a failed refresh never regresses the dashboard to "no data". `awsErrorCode` is the
 * AWS SDK's own error `name`/code when the failure carries one, mirroring
 * `_describe_cost_explorer_failure`'s `exc.response['Error']['Code']` read one language over. */
export class CostExplorerFailedError extends Error {
  constructor(readonly awsErrorCode: string, override readonly cause: unknown) {
    super(`Could not refresh AWS cost data (${awsErrorCode}). Try again shortly.`);
    this.name = 'CostExplorerFailedError';
  }
}
