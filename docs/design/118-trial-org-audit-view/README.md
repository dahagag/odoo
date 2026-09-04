# Trial Org Audit View — design board

Live artifact: https://claude.ai/code/artifact/a1ca55e4-9e7a-465d-b153-861e3144e505

Settled via a `/design` session for [issue #118](https://github.com/dahagag/odoo/issues/118)
(`hosting_admin`: live AWS-pulled audit view). Odoo-themed clickable prototype, two artboards:

- **`Main.dc.html`** — the Trial Org record form: lifecycle buttons (Issue/Suspend/Wake/Destroy)
  drive a real statusbar + ribbon, plus the "Lifecycle Audit Trail" tab with tweak-backed
  degraded-state previews (AWS unavailable / history unavailable). Includes a "Last Job Actor"
  row — illustrative only; the model has no actor field yet (see below).
- **`AuditLog.dc.html`** — a second, admin-only screen: a native Odoo list view of lifecycle
  actions across every Trial Org, with a working Filters dropdown (Action/Status/Actor type) and
  removable chips.

## Direction agreed

The statusbar, button placement, and audit-trail-as-timeline treatment (rather than the shipped
view's plain `Text` widget) were reviewed and approved.

## Follow-ups surfaced, not yet built

Raised in the design-board discussion (see the artifact's own comment thread) and confirmed
against the actual code (`custom_addons/hosting_admin/models/trial_org.py`,
`provisioner.py`):

- **Cheap to add to the real view** (fields already exist, just not displayed):
  `last_job_id`, `last_execution_arn`, `create_date`, and a seats-used count (derivable from the
  existing `hosting.trial.org.seat` model).
- **Needs a new model field first** (doesn't exist at all yet — a follow-up ticket, not a view
  change): who/what triggered the last lifecycle job (no actor field on the model at all today),
  a retry/attempt count, and prospect-domain DNS verification status.
- The audit-steps-as-timeline treatment is a genuine departure from the shipped
  `audit_trail_steps` `Text` field — worth a follow-up ticket if the timeline direction is wanted
  in the real view.
