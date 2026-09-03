# Per-Trial-Org deployment versioning: record, don't upgrade

Each Trial Org record stores which base AMI it was provisioned from and which git SHA of the
per-trial OpenTofu module ([ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md))
created it — an audit answer to "what code was this demo actually running," not a release/upgrade
mechanism. The AMI ID captures the full baked snapshot (OS, Odoo, and the `hosting`/`hosting_admin`
addon code together — see [ADR-0018](0018-hosting-split-into-admin-and-org-facing-addons.md)), so
no separate addon-version field is needed. The module version is the git SHA at apply time, not a
maintained semver: it's always available with zero extra process, and this repo has no other
precedent of hand-maintaining version numbers for infrastructure code the way
[ADR-0004](0004-oca-style-module-versioning.md) does for Odoo addons specifically.

We deliberately did not build an upgrade path for already-provisioned Trial Orgs. A trial is
14 days and disposable by design (Auto-Destroy, [ADR-0014](0014-per-org-ec2-with-suspend-wake-for-trials.md));
one that needs to run newer code is destroyed and a fresh one issued against the current AMI/module,
not patched in place. This intentionally leaves agentic-erp's own production release/rollback
mechanism — a real, separate design question for a long-lived deployment — out of scope here; it
belongs to the production migration's own design pass ([ADR-0015](0015-production-migrates-to-aws-platform-account.md)).
