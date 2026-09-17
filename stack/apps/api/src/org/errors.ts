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

/** Raised by `record.ts`'s `createOrg` when `dnsSubdomainLabel` was omitted and the label
 * slugified from `name` (`slugifyDnsLabel`, `@stack/domain`) doesn't itself satisfy
 * `DnsSubdomainLabelSchema` - e.g. a punctuation-only `name` slugifies to an empty string.
 * Mirrors `_check_dns_subdomain_label`'s own `ValidationError`
 * (`custom_addons/hosting_admin/models/trial_org.py`), which catches a bad *derived* value the
 * same way it catches a bad explicit one - an explicit value gets this same shape guarantee via
 * `CreateOrgRequestSchema` at the API boundary. */
export class InvalidDnsLabelError extends Error {
  constructor(readonly orgName: string, readonly derivedLabel: string) {
    super(`Could not derive a valid dnsSubdomainLabel from name '${orgName}' (got '${derivedLabel}')`);
    this.name = 'InvalidDnsLabelError';
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

/** Raised by `org/seat.ts` when an invite/join email fails the same pragmatic shape check
 * `hosting.trial.org.seat._EMAIL_RE` uses - checked before any seat is created (this ticket's
 * Acceptance Criteria: "a malformed email is rejected before any seat is created"). */
export class MalformedEmailError extends Error {
  constructor(readonly email: string) {
    super(`Not a valid email address: ${email}`);
    this.name = 'MalformedEmailError';
  }
}

/** An invite/join email's domain doesn't match the org's own prospect domain (`OrgRecord.domain`)
 * - this ticket's Acceptance Criteria: "a cross-domain invite is rejected and creates no seat",
 * checked identically for both a Targeted Invite and an Open Invite Link join
 * (ADR-0026: "the same safety property"). */
export class CrossDomainInviteError extends Error {
  constructor(readonly orgId: string, readonly email: string) {
    super(`${email} does not match org ${orgId}'s prospect domain`);
    this.name = 'CrossDomainInviteError';
  }
}

/** Raised by `org/seat.ts` when the seat named as inviter doesn't exist. Distinct from
 * `SeatNotAcceptedError` so a route layer can tell "no such seat" (404-shaped) apart from
 * "that seat exists but isn't allowed to invite yet" (409-shaped). */
export class SeatNotFoundError extends Error {
  constructor(readonly orgId: string, readonly seatId: string) {
    super(`No such seat ${seatId} on org ${orgId}`);
    this.name = 'SeatNotFoundError';
  }
}

/** Only an `accepted` seat may invite a teammate (this ticket's Acceptance Criteria: "an
 * invited-but-not-yet-accepted seat cannot invite") - mirrors
 * `hosting.trial.org.seat.action_invite`'s own `AccessError` guard. */
export class SeatNotAcceptedError extends Error {
  constructor(readonly orgId: string, readonly seatId: string) {
    super(`Seat ${seatId} on org ${orgId} has not accepted and cannot invite`);
    this.name = 'SeatNotAcceptedError';
  }
}

/** `joinOpenInvite` was called against an org whose `inviteType` is `targeted` (this ticket's
 * Acceptance Criteria: "joining via the open-invite path on an org configured for targeted
 * invites only is rejected") - mirrors `action_join_open_invite`'s own `UserError` guard. */
export class OpenInviteNotEnabledError extends Error {
  constructor(readonly orgId: string) {
    super(`Org ${orgId} does not accept open-invite joins (inviteType is 'targeted')`);
    this.name = 'OpenInviteNotEnabledError';
  }
}

/** Raised by `auth/magicLink.ts`'s `requestMagicLink` when the email has no existing Seat and
 * the org doesn't accept Open Invite joins - there is no invitation this email could be signing
 * in to (#200's User Story 5: "an invitation to a non-company email rejected clearly" extends to
 * "there was never an invitation at all"). Distinct from `CrossDomainInviteError`, which fires
 * for a *wrong-domain* email; this fires for a *right-domain* email with nothing to sign in to. */
export class NoSuchInvitationError extends Error {
  constructor(readonly orgId: string, readonly email: string) {
    super(`${email} has no invitation on org ${orgId}`);
    this.name = 'NoSuchInvitationError';
  }
}

/** The transactional seat-counter increment (`docs/dynamodb-access-patterns.md`) rejected a new
 * seat because it would push `seatsUsed` past `seatsTotal` - this ticket's Acceptance Criteria:
 * "an invite that would exceed the org's seat cap is rejected". Raised whether the seat came
 * from a Targeted Invite or an Open Invite Link join; the cap is enforced identically either
 * way. */
export class SeatCapExceededError extends Error {
  constructor(readonly orgId: string) {
    super(`Org ${orgId} has no remaining seats`);
    this.name = 'SeatCapExceededError';
  }
}

/** Raised by `record.ts`'s `extendOrgExpiry` when the target org has no `expiryDate` to push out
 * - a Client Org, which never carries one (docs/adr/0034: an org's `type` decides this, not its
 * current state). Mirrors the fact that `crm_lead.action_extend_trial` only ever exists for a
 * Trial Org in the first place (a Client Org has no `trial_org_id` counterpart in Odoo). */
export class ExpiryNotSupportedError extends Error {
  constructor(readonly orgId: string) {
    super(`Org ${orgId} has no expiryDate to extend (not a Trial Org)`);
    this.name = 'ExpiryNotSupportedError';
  }
}

/** Raised by `record.ts`'s `extendOrgExpiry` when the computed expiry timestamp would overflow
 * JavaScript's own `Date` range (CodeRabbit, PR #313) - defense in depth alongside
 * `ExtendOrgRequestSchema`'s own upper bound on `additionalDays`, for any caller of this
 * function that bypasses the HTTP schema validation. */
export class InvalidExpiryDateError extends Error {
  constructor(readonly orgId: string, readonly additionalDays: number) {
    super(`Org ${orgId}: extending by ${additionalDays} days would produce an out-of-range date`);
    this.name = 'InvalidExpiryDateError';
  }
}

/** Wraps whatever the injected `Provisioner` itself threw (`applyTransition`, `record.ts`), so
 * `server.ts` can map *specifically* a provisioner failure to 502 - and nothing else. Without
 * this wrapper, a later failure in the same call (e.g. the conditional `updateItem` after the
 * provisioner already succeeded) would be indistinguishable from a provisioner failure by type
 * alone, and get the same misleading "the provisioner failed" response even though the
 * provisioner didn't fail at all (CodeRabbit, PR #284). */
export class ProvisionerFailedError extends Error {
  constructor(readonly orgId: string, readonly action: string, readonly provisionerError: unknown) {
    super(`Provisioner failed for org ${orgId} action ${action}: ${provisionerError instanceof Error ? provisionerError.message : String(provisionerError)}`);
    this.name = 'ProvisionerFailedError';
  }
}
