# Hosting Operations

Provisions and operates isolated Odoo instances for prospects and customers outside the primary agentic-erp deployment: sales trials today, paid hosting later. Owns instance lifecycle, not the commercial decision to offer one.

## Language

**Trial Org**:
An isolated Odoo instance provisioned for a single CRM Opportunity's prospect domain, running for a fixed window (default 14 days) before Auto-Destroy.
_Avoid_: Tenant, demo instance, sandbox

**Seat**:
A named user account within a Trial Org. The count is set per-trial at issuance (system-wide max 25) and each invite must match the Trial Org's prospect domain.
_Avoid_: License, user slot

**Active / Suspended**:
A Trial Org's two operating states. Active means its compute is running; Suspended means compute has been stopped after an idle timeout to save cost, with the database and any queued Seats intact. Moving from Suspended to Active is a Wake.
_Avoid_: Sleeping, paused (use Suspended); running, live (use Active)

**Wake**:
The explicit action ("Wake Up" button) an org user takes on a Suspended Trial Org to start its compute again. Not automatic — visiting the URL shows a static waiting page rather than triggering a wake by itself.
_Avoid_: Resume, start (use Wake as the noun/verb for this specific action)

**Auto-Destroy**:
Permanent teardown of a Trial Org's compute and database, firing when its expiry date is reached (or earlier by manual teardown). A short-lived (7-day) database snapshot is retained afterward in case of revival.
_Avoid_: Expiry (expiry is the date; Auto-Destroy is the action it triggers)

**Extension**:
An action available to the sales rep or manager who owns the Opportunity (via the sales methodology addon) that pushes out a Trial Org's expiry date before Auto-Destroy fires.

**Hosting Account**:
The AWS Organizations member account that holds all Trial Org infrastructure, kept separate from the Management account that owns billing and Organization structure, and from the Platform Account.

**Platform Account**:
The AWS Organizations member account holding agentic-erp's own production instance, migrated from Render. Kept separate from the Hosting Account so disposable trial-org infrastructure never shares an account boundary with production.

**Org Registration**:
The read-only summary of a Trial Org's own standing — name, domain, seats used/total, expiry date — surfaced inside that org's own Odoo instance via the `hosting` addon. The prelude to a self-service view paid hosting customers will later see (plan, billing) once that tier exists.
_Avoid_: Subscription info (not yet a subscription — no billing exists for Trial Orgs)

**Deployment Version**:
The base AMI and OpenTofu module version a Trial Org was provisioned from, recorded on its record as an audit fact ("what code was this demo actually running"). Not an upgrade mechanism — a Trial Org needing newer code is destroyed and reissued, never patched in place.
_Avoid_: Release, build (this identifies what a specific Trial Org runs, not a shippable artifact)
