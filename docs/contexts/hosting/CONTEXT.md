# Hosting Operations

Provisions and operates isolated Odoo instances for prospects and customers outside the primary agentic-erp deployment: evaluation orgs for leads, and hosted orgs for paying clients. Owns instance lifecycle, not the commercial decision to offer one.

## Language

**Trial Org**:
An isolated Odoo instance provisioned for a single CRM Opportunity's prospect domain — the low-cost, ephemeral evaluation offering issued to a lead so they and their colleagues can evaluate our addons. It runs for a fixed window (default 14 days), after which Auto-Destroy is its default outcome, pre-empted only by Promotion.
_Avoid_: Tenant, demo instance, sandbox

**Client Org**:
A stable hosted Odoo instance operated for a paying client, anchored to a won deal rather than an Opportunity, with no expiry window and no Auto-Destroy. Reached by Promotion of a Trial Org, or provisioned directly for a client who never evaluated.
_Avoid_: Production org, tenant, customer instance (a Client Org is one client's own hosted org, not a tier of our own production)

**Promotion**:
A Trial Org becoming a Client Org without moving its data — the client keeps what they entered while evaluating. The only event that pre-empts Auto-Destroy, and it never crosses Org Regions.
_Avoid_: Conversion (that's the CRM Opportunity's own word), upgrade, migration (nothing moves)

**Seat**:
A named user account within a Trial Org. The count is set per-trial at issuance (system-wide max 25) and each invite must match the Trial Org's prospect domain.
_Avoid_: License, user slot

**Open Invite Link**:
A shareable, trial-join link not addressed to any specific email, used when the sales rep knows the expected prospect domain but not yet who specifically will join. The first person to complete login through it must confirm a company email matching that domain before the Seat is created; a mismatch is rejected rather than silently accepted. Contrast with a **Targeted Invite**, sent to a known email and confirmed by construction.
_Avoid_: Magic link, public link (it's domain-guarded, not truly public)

**Active / Suspended**:
A Trial Org's two operating states. Active means its compute is running; Suspended means compute has been stopped after an idle timeout to save cost, with the database and any queued Seats intact. Moving from Suspended to Active is a Wake.
_Avoid_: Sleeping, paused (use Suspended); running, live (use Active)

**Wake**:
The explicit action ("Wake Up" button) an org user takes on a Suspended Trial Org to start its compute again. Not automatic — visiting the URL shows the Asleep Page rather than triggering a wake by itself.
_Avoid_: Resume, start (use Wake as the noun/verb for this specific action)

**Asleep Page**:
What an org's own people see at its URL while it is Suspended: an explanation that the org is asleep, and the Wake action — so a stopped instance does not look like a broken product.
_Avoid_: Error page, maintenance page (it's a working state, not a fault)

**Auto-Destroy**:
Permanent teardown of a Trial Org's compute and database — the default outcome when its expiry date is reached, pre-empted by Promotion, available earlier by manual teardown, and never applicable to a Client Org. A short-lived (7-day) database snapshot is retained afterward in case of revival.
_Avoid_: Expiry (expiry is the date; Auto-Destroy is the action it triggers)

**Extension**:
An action available to the sales rep or manager who owns the Opportunity (via the sales methodology addon) that pushes out a Trial Org's expiry date before Auto-Destroy fires.

**Administration Stack**:
The system of record for every Trial Org and Client Org, and the system that operates them: issuance, seats, suspend/wake, extension, auto-destroy, cost, and logs. Deliberately not part of any Odoo instance, and it serves two surfaces — the Staff App and the Client App.
_Avoid_: Control plane, backend, admin panel (name the stack, or name the surface)

**Staff App**:
The Administration Stack's internal surface, where staff operate the whole fleet: every org's state, its provisioning logs, and what each one costs. For staff only — never a surface an org's own people reach.
_Avoid_: Admin dashboard, back office

**Client App**:
The Administration Stack's outward surface, and the only one Hosting Operations exposes publicly: where an org's own people see their standing, accept invitations, Wake a Suspended org, and land on the Asleep Page.
_Avoid_: Portal (Odoo uses that word for something else), customer dashboard

**Hosting Account**:
The AWS Organizations member account that holds all Trial Org and Client Org infrastructure, kept separate from the Management account that owns billing and Organization structure, and from the Platform Account.

**Platform Account**:
The AWS Organizations member account holding agentic-erp's own instances — production and staging — along with the Administration Stack and the static public surfaces. Kept separate from the Hosting Account so disposable trial-org infrastructure never shares an account boundary with production.

**Org Region**:
The one region an org's infrastructure and data live in, fixed when the org is provisioned and immutable thereafter. Choosing it per org is a captured requirement, not a capability we have.
_Avoid_: Data residency, availability zone, location

**Org Registration**:
The read-only summary of an org's own standing — name, domain, seats used/total, expiry date — shown inside that org's own instance and scoped so an org sees only its own. The prelude to a self-service view paid hosting customers will later see (plan, billing) once that tier exists.
_Avoid_: Subscription info (not yet a subscription — no billing exists for Trial Orgs)

**Deployment Version**:
The base AMI and OpenTofu module version a Trial Org was provisioned from, recorded on its record as an audit fact ("what code was this demo actually running"). Not an upgrade mechanism — a Trial Org needing newer code is destroyed and reissued, never patched in place.
_Avoid_: Release, build (this identifies what a specific Trial Org runs, not a shippable artifact)

**Onboarding Guide**:
The doc/video/screenshot content covering trial mechanics (seats, expiry/extension, invites, suspend/Wake) shown once on first login to any Trial Org and permanently linked from Org Registration afterward. Scoped to trial mechanics only — product/CRM education is the separate, pre-existing crm_methodology teach-doc content, not owned by Hosting Operations.
_Avoid_: Teach doc (that's the mechanism/pipeline this content is built with, not this content itself); tutorial
