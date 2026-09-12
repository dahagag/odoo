/** Errors the org record store/lifecycle module (`record.ts`) raises - `server.ts` maps each to
 * a Problem Details response. Kept separate from `AwsGateway`'s own errors (`ConditionalCheckFailedError`
 * et al.) because those are seam-level (what DynamoDB rejected); these are domain-level (what the
 * lifecycle rejected), even though a `ConcurrentWriteError` is often *caused by* one. */

export class OrgNotFoundError extends Error {
  constructor(readonly orgId: string) {
    super(`No such org: ${orgId}`);
    this.name = 'OrgNotFoundError';
  }
}

export class DnsLabelInUseError extends Error {
  constructor(readonly dnsSubdomainLabel: string) {
    super(`dnsSubdomainLabel already in use: ${dnsSubdomainLabel}`);
    this.name = 'DnsLabelInUseError';
  }
}

/** Raised both for "the label may only change while `issued`" and for the DB-level guard on the
 * same rule - see `record.ts`'s `updateDnsSubdomainLabel`. */
export class DnsLabelImmutableError extends Error {
  constructor(readonly orgId: string) {
    super(`dnsSubdomainLabel is immutable once an org has left the 'issued' state: ${orgId}`);
    this.name = 'DnsLabelImmutableError';
  }
}

/** A transition was attempted from a state the action does not allow (this ticket's Acceptance
 * Criteria: "every illegal transition is rejected and leaves the record's state unchanged"). */
export class IllegalTransitionError extends Error {
  constructor(readonly orgId: string, readonly action: string, readonly actualState: string) {
    super(`Cannot ${action} org ${orgId}: illegal from state '${actualState}'`);
    this.name = 'IllegalTransitionError';
  }
}

/** The org's state changed between this call's read and its conditional write - a concurrent
 * transition on the same org won the race first (this ticket's Acceptance Criteria: "exactly one
 * wins"). The loser gets this instead of a silently-stale success. */
export class ConcurrentWriteError extends Error {
  constructor(readonly orgId: string, readonly action: string) {
    super(`Org ${orgId} changed concurrently; ${action} was not applied`);
    this.name = 'ConcurrentWriteError';
  }
}
