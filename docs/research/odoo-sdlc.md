# Odoo's Software Development Lifecycle (SDLC)

Research date: 2026-08-30. Scope: how a change moves from idea to release for
(A) Odoo core (the `odoo/odoo` project, maintained by Odoo S.A.) and (B)
third-party/custom addon development, contrasted with the Odoo Community
Association (OCA)'s formalized process for community addons. This repo
(`dahagag/odoo`, a private fork) is not currently a contributor to either
upstream project — this note exists to inform how closely our own workflow
(`docs/agents/*.md`, `docs/adr/*.md`) should mirror official practice, not
because we intend to upstream changes.

Every claim below is tied to the primary source it came from. Where a claim
could not be pinned to primary-source text (the fetch tool returned only
navigation chrome, a 404, or an empty page), it is listed under
[Unverified / could not confirm](#unverified--could-not-confirm) instead of
being stated as fact.

## A. Odoo core development lifecycle (`odoo/odoo`)

**Branching model.** The repository is organized as numbered version
branches (`16.0`, `17.0`, `18.0`, `19.0`, ...) plus `master` for
in-development, unreleased work. Contributors must target the correct
branch based on the nature of the change:

| Change type | Stable branches (e.g. 17.0–19.0) | `master` |
|---|---|---|
| Bug fixes | ✓ | ✗ |
| Localizations | ✓ | ✓ |
| New features / unstable work | ✗ | ✓ |

Source: [odoo/odoo wiki — Contributing](https://github.com/odoo/odoo/wiki/Contributing).

**Stable-branch restrictions.** Once a version branch is released, it is
frozen against anything but corrective work:

> "No 'improvement' (technical or functional) should be done in stable"

Also disallowed on stable branches: public API signature changes, data model
modifications, and purely cosmetic changes. Critical security fixes must
work without requiring an explicit module update. Fixes made against the
oldest-supported stable branch are automatically forward-ported to newer
branches — contributors are explicitly told **not** to open the same patch
against multiple target branches themselves.
Source: [odoo/odoo wiki — Contributing](https://github.com/odoo/odoo/wiki/Contributing).

**Pull request process (idea → merge).**
1. Verify the issue still reproduces on the latest version using Runbot (Odoo's CI/staging instance).
2. Write a test that reproduces the issue, if possible.
3. Open a PR against the correct branch (see table above); keep the diff "minimal, and strictly related to your issue"; match surrounding code style.
4. Sign the Odoo CLA.
5. Address any Runbot test failures.
6. Rebase and squash before submitting ("Minimal commits!"); rebase onto the target branch immediately before submission to avoid conflicts.
7. Do not open a separate GitHub issue for something already described in a PR description.

Tests are described as recommended, not stated as an absolute hard gate for
every PR in this wiki text — though Runbot (CI) failures must be resolved.
Source: [odoo/odoo wiki — Contributing](https://github.com/odoo/odoo/wiki/Contributing), redirect target of the official [odoo.com/submit-pr](https://www.odoo.com/submit-pr) link.

**Coding guidelines / module structure.** The official coding guidelines
prescribe a fixed addon directory layout and file-naming scheme:

- `data/` — demo and data XML
- `models/` — model definitions, one file per "main model" grouping
- `controllers/` — HTTP routes
- `views/` — views and templates, files suffixed `_views.xml`
- `static/` — web assets
- `wizard/` — transient models and their views (optional)
- `report/` — printable reports and SQL-view-backed models (optional)
- Security: `ir.model.access.csv` for ACLs, `<module>_groups.xml` for
  groups, `<model>_security.xml` for record rules
- File names restricted to `[a-z0-9_]`

For guideline changes on already-shipped stable code: "Never modify existing
files in order to apply these guidelines... Diff should be kept minimal." On
`master`/in-development code, guidelines apply only to touched code or files
under major revision, with a separate "move" commit preceding functional
changes.
Source: [odoo/documentation, `content/contributing/development/coding_guidelines.rst` (19.0 branch)](https://raw.githubusercontent.com/odoo/documentation/19.0/content/contributing/development/coding_guidelines.rst).

**Release cadence.** Search results (not independently confirmed against
primary-source page text — see caveats below) consistently describe an
annual major-version release, historically timed to the Odoo Experience
conference in October. The existence of sequential yearly numbered branches
(16.0 → 19.0) in the primary-sourced branch table above is consistent with
this but does not itself state a cadence.

**Support window.** Odoo's own upgrade documentation states that Odoo
Online customers get "an additional two years... after three years of
initial support" to complete a mandatory upgrade once a version's support
window ends, implying a baseline support duration of three years per
version.
Source: [Odoo 19.0 documentation — Upgrade your database](https://www.odoo.com/documentation/19.0/administration/upgrade.html).

## B. Module manifest versioning

**Official Odoo position.** The only manifest-level guidance found in
primary Odoo documentation is generic:

> `version` (`str`): "this module's version, should follow semantic
> versioning rules"

No official Odoo S.A. source found states that a module's version string
must be prefixed with the Odoo series number (e.g. `19.0.x.y.z`) — that is
a **community (OCA) convention**, not an Odoo S.A. requirement.
Source: [odoo/documentation, `content/developer/reference/backend/module.rst` (19.0 branch)](https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/module.rst).

**OCA convention.** OCA's contribution guidelines document the
series-prefixed scheme explicitly:

> Format: `{Odoo_Version}.{Major}.{Minor}.{Patch}`, e.g. `12.0.1.0.0` is the
> first release of a module for Odoo 12.0.

- **Major** increments for data-model/view changes that require a migration.
- **Minor** increments for backward-compatible new features requiring a
  module upgrade.
- **Patch** increments for bug fixes, typically needing only a server
  restart.

Source: [OCA/odoo-community.org, `website/Contribution/CONTRIBUTING.rst`](https://raw.githubusercontent.com/OCA/odoo-community.org/master/website/Contribution/CONTRIBUTING.rst).

This repo's own [`docs/agents/odoo-19-development.md`](../agents/odoo-19-development.md)
does not currently prescribe either scheme for `custom_addons/` modules —
worth deciding deliberately rather than by omission, since the two
conventions imply different upgrade signaling (OCA's scheme lets a version
bump alone communicate "needs migration" vs. "safe hot-upgrade").

## C. OCA's formalized third-party contribution lifecycle

Unlike Odoo S.A.'s core process, OCA documents an explicit, gated lifecycle
from proposal to release:

1. **Proposal & development** — contributor writes the module against OCA
   guidelines, opens a PR with documentation.
2. **Peer review** — at least one reviewer (PSC or core maintainer);
   reviewers assess code quality, design, documentation, redundancy with
   existing modules, and use case.
3. **Requirements verification** — PEP8 + OCA conventions, tests included
   and passing, imperative-present-tense commit messages, migration scripts
   for breaking changes.
4. **Maintainer/PSC approval** — an OCA Core Maintainer approves merge
   eligibility.
5. **Merge** — integrated with author attribution preserved.
6. **Release to the OCA Apps Store.**

Stale PRs (6 months inactive) may be closed.
Source: [OCA/odoo-community.org, `website/Contribution/CONTRIBUTING.rst`](https://raw.githubusercontent.com/OCA/odoo-community.org/master/website/Contribution/CONTRIBUTING.rst).

**Module maturity levels** (mirrors PyPI's development-status vocabulary):

| Level | Purpose | Merge requirements |
|---|---|---|
| Beta | Incubation; testing only, not production; may change or be abandoned without notice | OCA coding standards; CI (historically TravisCI) green; ≥1 peer review; installs cleanly on OCA Runbot |
| Stable | Production-ready baseline | All CI checks green at all times; tests included (no minimum coverage %); cannot depend on Beta modules; **two** peer reviews; minimum 5-day review window (shorter allowed with 3+ approvals) |
| Mature | Proven across multiple deployments, actively maintained | All Stable criteria; ≥80% code coverage, zero lint warnings; OpenUpgrade migration scripts for major changes; ≥2 contributors; depends only on Mature modules; ideally exists in a prior Odoo version already |

Source: [The Odoo Community Association — Module maturity levels](https://www.odoo-community.org/page/module-maturity-levels).

This is meaningfully more formal than anything in this repo's own docs.
[`docs/agents/odoo-19-development.md`](../agents/odoo-19-development.md)'s
"Human or designated review gates merge" section names *categories* of
change requiring escalation (ACLs, migrations, deletions, external
dependencies, upstream changes) but does not define reviewer counts, a
minimum review window, or coverage thresholds the way OCA's Stable/Mature
tiers do. Whether this repo wants that level of formality is a separate
decision — noted here only because it is a direct, verifiable point of
contrast with documented community practice.

## D. Testing's role in the lifecycle

Odoo's own testing reference documents the test framework (`TransactionCase`,
tags, `at_install`/`post_install` tags, Runbot-executed tours) in detail, but
the primary-source page content retrieved here did not contain an explicit
statement that tests are a mandatory merge gate for core Odoo — the
[odoo/odoo wiki — Contributing](https://github.com/odoo/odoo/wiki/Contributing)
page treats "write a test to reproduce the issue if possible" as
recommended practice tied to bug fixes specifically, while Runbot
(CI) failures do have to be resolved before merge. OCA is more explicit:
Stable and Mature modules require CI to stay green and reviewers to confirm
tests exist, as a hard precondition of merge (Section C above).

This repo's own [`docs/agents/local-development.md`](../agents/local-development.md)
and [`docs/agents/odoo-19-development.md`](../agents/odoo-19-development.md)
already require a regression test for every reproducible bug fix and route
all testing through `scripts/dev.ps1`/`dev.sh test` — closer in spirit to
OCA's explicit gate than to core Odoo's "recommended" framing.

## Unverified / could not confirm

- **Exact annual release cadence, in Odoo's own words.** Multiple secondary
  sources (not primary) describe an October/November yearly cadence tied to
  the Odoo Experience conference; no official odoo.com page text confirming
  this in those terms could be fetched in this session (the
  `administration/supported_versions.html` page returned empty content to
  the fetch tool on every attempt, likely because it renders its table via
  client-side JavaScript).
- **Exact Odoo 19 release date.** Search results state September 18, 2025 or
  October 2025 depending on source; not confirmed against a primary
  odoo.com page in this session.
- **Precise per-version support end-of-life dates.** Same root cause as
  above (`supported_versions.html` not renderable via fetch).
- **Internal module lifecycle state machine** (e.g. `uninstalled`,
  `installed`, `to upgrade`, `to remove` on `ir.module.module`). The
  manifest reference page was fetched successfully but its content, as
  extracted, covered only the manifest fields and install/uninstall hooks —
  not the state machine itself. This would need a direct read of
  `odoo/addons/base/models/ir_module.py` in the checked-out source (available
  locally in this repo's `odoo/` reference tree) rather than another web
  fetch.
- **Whether tests are a hard, universal merge gate for core Odoo PRs** (as
  opposed to "recommended" for bug fixes specifically) — the wiki text
  found does not state this in absolute terms; Runbot/CI passing is
  required, but that is not identical to "a new test is mandatory."

## Sources

- [odoo/odoo wiki — Contributing](https://github.com/odoo/odoo/wiki/Contributing)
- [odoo.com/submit-pr](https://www.odoo.com/submit-pr) (redirects to the above)
- [odoo/documentation — coding_guidelines.rst, 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/contributing/development/coding_guidelines.rst)
- [odoo/documentation — module.rst (manifest reference), 19.0 branch](https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/module.rst)
- [Odoo 19.0 documentation — Upgrade your database](https://www.odoo.com/documentation/19.0/administration/upgrade.html)
- [OCA/odoo-community.org — CONTRIBUTING.rst](https://raw.githubusercontent.com/OCA/odoo-community.org/master/website/Contribution/CONTRIBUTING.rst)
- [The Odoo Community Association — Module maturity levels](https://www.odoo-community.org/page/module-maturity-levels)
