from collections import defaultdict
from datetime import timedelta

from odoo import api, fields, models

from .cost_explorer import AwsCostExplorerClient, StubCostExplorerClient
from .trial_org import CONFIG_PARAM_AWS_REGION, CONFIG_PARAM_STATE_MACHINE_ARN

# ir.config_parameter keys the Cost Dashboard is configured from. Unset credit fields fall back to
# DEFAULT_CREDIT_AMOUNT/"today" respectively - see _cron_refresh_snapshot.
CONFIG_PARAM_CREDIT_AMOUNT = 'hosting_admin.aws_cost_credit_amount'
CONFIG_PARAM_CREDIT_START_DATE = 'hosting_admin.aws_cost_credit_start_date'

DEFAULT_CREDIT_AMOUNT = 200.0

# Burn rate is averaged over this trailing window rather than a single day's spend, which swings
# with ordinary daily variance and the 24h tag-activation lag itself (docs/adr/0030). Clamped to
# however many days have actually elapsed since the credit started - see _compute_figures.
BURN_RATE_WINDOW_DAYS = 7


class HostingCostDashboardSnapshot(models.Model):
    """One daily-refresh snapshot of AWS spend against the Trial Org fleet (issue #115): total
    spend since the configured AWS credit start date, a burn-rate figure averaged over the
    trailing BURN_RATE_WINDOW_DAYS days, and - while the credit lasts - a projected
    days-remaining figure. Stored rather than computed live on every view open, unlike
    hosting.trial.org's audit_trail_* fields - see docs/adr/0030 for why the two dashboards make
    the opposite choice.
    """
    _name = 'hosting.cost.dashboard.snapshot'
    _description = "Cost Dashboard Snapshot"
    _order = 'snapshot_date desc'

    snapshot_date = fields.Date(required=True, readonly=True, index=True)
    total_spend = fields.Float(
        required=True, readonly=True, digits=(16, 2),
        help="Total AWS spend attributed to a Trial Org tag since the configured credit start "
             "date.")
    burn_rate_per_day = fields.Float(
        required=True, readonly=True, digits=(16, 2),
        help=f"Average daily spend over the trailing {BURN_RATE_WINDOW_DAYS} days (or however "
             "many days have elapsed since the credit start date, if fewer).")
    credit_amount = fields.Float(
        required=True, readonly=True, digits=(16, 2),
        help="The AWS credit this snapshot's days_remaining_on_credit is projected against "
             f"(hosting_admin.aws_cost_credit_amount, default ${DEFAULT_CREDIT_AMOUNT:.0f}).")
    days_remaining_on_credit_known = fields.Boolean(
        readonly=True,
        help="Whether days_remaining_on_credit is a real projection. False when "
             "burn_rate_per_day is 0 (nothing to project from) - kept as its own field rather "
             "than a blank Float, since a Float field can't distinguish \"no projection\" from "
             "a genuine 0 (credit already exhausted).")
    days_remaining_on_credit = fields.Float(
        readonly=True, digits=(16, 1),
        help="Projected days until total_spend reaches credit_amount at the current burn "
             "rate. Meaningless when days_remaining_on_credit_known is False; 0 once the "
             "credit is already exhausted.")
    line_ids = fields.One2many(
        'hosting.cost.dashboard.line', 'snapshot_id', string="Spend by Trial Org",
        readonly=True)
    trial_org_count = fields.Integer(
        compute='_compute_trial_org_count',
        help="Number of distinct Trial Orgs with recorded spend on this snapshot (excludes "
             "the \"Unattributed\" line, if any) - the design-board's own \"across N Trial "
             "Orgs\" caption on the Total Spend figure.")
    credit_remaining = fields.Float(
        compute='_compute_credit_remaining', digits=(16, 2),
        help="credit_amount minus total_spend - the design-board's own \"$X left of $Y\" "
             "caption on the Days Remaining figure. Never negative (0 once exhausted).")

    _snapshot_date_unique = models.Constraint(
        'UNIQUE(snapshot_date)',
        "Only one snapshot is kept per day; refresh the existing one instead of creating a "
        "second.",
    )

    @api.depends('line_ids.trial_org_id')
    def _compute_trial_org_count(self):
        for snapshot in self:
            snapshot.trial_org_count = len(snapshot.line_ids.mapped('trial_org_id'))

    @api.depends('credit_amount', 'total_spend')
    def _compute_credit_remaining(self):
        for snapshot in self:
            snapshot.credit_remaining = max(0.0, snapshot.credit_amount - snapshot.total_spend)

    def _get_cost_explorer_client(self):
        """Return the ``CostExplorerClient`` implementation to call: ``AwsCostExplorerClient``
        once AWS wiring is configured, ``StubCostExplorerClient`` otherwise - same
        AWS-wiring-configured signal (CONFIG_PARAM_STATE_MACHINE_ARN) hosting.trial.org.
        _get_provisioner already keys off, since it's the one on/off switch for whether this
        Odoo instance has a real AWS account behind it at all. Tests override this method
        directly to inject a recording fake, or construct AwsCostExplorerClient(client=...)
        themselves and call _compute_figures directly."""
        ICP = self.env['ir.config_parameter'].sudo()
        if not ICP.get_param(CONFIG_PARAM_STATE_MACHINE_ARN):
            return StubCostExplorerClient()
        return AwsCostExplorerClient(region_name=ICP.get_param(CONFIG_PARAM_AWS_REGION))

    @api.model
    def _compute_figures(self, daily_rows, credit_amount, credit_start_date, today):
        """Pure computation from AWS's own daily cost rows (CostExplorerClient.
        get_daily_cost_by_trial_org's shape) to this snapshot's own figures - kept apart from
        any AWS/ORM call so tests can feed it fixture cost data directly (the ticket's own
        "assert on computed figures given fixture cost data" requirement).

        Returns a dict - ``total_spend``, ``burn_rate_per_day``, ``days_remaining_on_credit``
        (``None`` when burn_rate_per_day is 0 - nothing to project from), and
        ``per_trial_org_spend``, a ``{trial_org_id_or_None: spend}`` dict with one entry per
        distinct tag value seen, ``None`` keying the "Unattributed" bucket (docs/adr/0030). A
        dict of named figures rather than a positional tuple, matching how
        AwsProvisioner.get_audit_trail (models/provisioner.py) already returns its own
        multi-figure result in this addon."""
        per_trial_org_spend = defaultdict(float)
        for row in daily_rows:
            per_trial_org_spend[row['trial_org_id']] += row['amount']
        total_spend = sum(per_trial_org_spend.values())

        # Clamp the averaging window to however many days have actually elapsed since the
        # credit started, so a credit period only a few days old doesn't understate the rate by
        # averaging spend over days that don't exist yet.
        days_elapsed = (today - credit_start_date).days + 1
        window_days = max(1, min(BURN_RATE_WINDOW_DAYS, days_elapsed))
        window_start = today - timedelta(days=window_days - 1)
        recent_spend = sum(
            row['amount'] for row in daily_rows if window_start <= row['date'] <= today)
        burn_rate_per_day = recent_spend / window_days

        remaining_credit = credit_amount - total_spend
        if remaining_credit <= 0:
            days_remaining_on_credit = 0.0
        elif burn_rate_per_day <= 0:
            days_remaining_on_credit = None
        else:
            days_remaining_on_credit = remaining_credit / burn_rate_per_day

        return {
            'total_spend': total_spend,
            'burn_rate_per_day': burn_rate_per_day,
            'days_remaining_on_credit': days_remaining_on_credit,
            'per_trial_org_spend': dict(per_trial_org_spend),
        }

    def _cron_refresh_snapshot(self):
        """Scheduled action (daily, data/ir_cron.xml): pull AWS's own cost-and-usage data
        grouped by the TrialOrgId cost-allocation tag since the configured credit start date,
        and upsert today's snapshot from it. Idempotent - running it twice on the same day just
        recomputes and rewrites today's own snapshot/lines (the UNIQUE(snapshot_date)
        constraint), never creates a second one."""
        ICP = self.env['ir.config_parameter'].sudo()
        credit_amount = float(ICP.get_param(CONFIG_PARAM_CREDIT_AMOUNT) or DEFAULT_CREDIT_AMOUNT)
        credit_start_date = (
            fields.Date.from_string(ICP.get_param(CONFIG_PARAM_CREDIT_START_DATE))
            or fields.Date.context_today(self))
        today = fields.Date.context_today(self)

        client = self._get_cost_explorer_client()
        daily_rows = client.get_daily_cost_by_trial_org(
            credit_start_date, today + timedelta(days=1))

        figures = self._compute_figures(daily_rows, credit_amount, credit_start_date, today)

        snapshot = self.search([('snapshot_date', '=', today)], limit=1)
        snapshot_vals = {
            'snapshot_date': today,
            'total_spend': figures['total_spend'],
            'burn_rate_per_day': figures['burn_rate_per_day'],
            'credit_amount': credit_amount,
            'days_remaining_on_credit_known': figures['days_remaining_on_credit'] is not None,
            'days_remaining_on_credit': figures['days_remaining_on_credit'] or 0.0,
        }
        if snapshot:
            snapshot.line_ids.unlink()
            snapshot.write(snapshot_vals)
        else:
            snapshot = self.create(snapshot_vals)

        per_trial_org_spend = figures['per_trial_org_spend']
        trial_org_ids = [tid for tid in per_trial_org_spend if tid is not None]
        existing_trial_orgs = self.env['hosting.trial.org'].browse(trial_org_ids).exists()
        existing_trial_org_ids = set(existing_trial_orgs.ids)
        self.env['hosting.cost.dashboard.line'].create([
            {
                'snapshot_id': snapshot.id,
                'trial_org_id': trial_org_id if trial_org_id in existing_trial_org_ids else False,
                'spend': spend,
            }
            for trial_org_id, spend in per_trial_org_spend.items()
        ])
        return snapshot

    def action_refresh_now(self):
        """Admin-triggered manual refresh (form-view button), for an operator who wants this
        snapshot's figures brought current without waiting for the next daily cron run."""
        self.ensure_one()
        refreshed = self._cron_refresh_snapshot()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'hosting.cost.dashboard.snapshot',
            'view_mode': 'form',
            'res_id': refreshed.id,
            'target': 'current',
        }

    def action_open_dashboard(self):
        """Menu entry point: open the latest snapshot, refreshing once first if none exists yet
        (a fresh install with no cron run behind it) - never on every open, which would defeat
        the whole point of caching a daily-refresh snapshot (docs/adr/0030)."""
        snapshot = self.search([], limit=1)
        if not snapshot:
            snapshot = self._cron_refresh_snapshot()
        return {
            'type': 'ir.actions.act_window',
            'name': "Cost Dashboard",
            'res_model': 'hosting.cost.dashboard.snapshot',
            'view_mode': 'form',
            'res_id': snapshot.id,
            'target': 'current',
        }


class HostingCostDashboardLine(models.Model):
    """One Trial Org's (or the "Unattributed" bucket's) share of a single
    hosting.cost.dashboard.snapshot's total_spend."""
    _name = 'hosting.cost.dashboard.line'
    _description = "Cost Dashboard Line"
    _order = 'spend desc'

    snapshot_id = fields.Many2one(
        'hosting.cost.dashboard.snapshot', required=True, readonly=True, ondelete='cascade')
    trial_org_id = fields.Many2one(
        'hosting.trial.org', readonly=True,
        help="Blank for AWS spend carrying no TrialOrgId tag value at all (the shared "
             "foundation/CI infrastructure docs/adr/0013 keeps outside any single Trial Org's "
             "own tag), or for a tag value that no longer matches any Trial Org record.")
    org_label = fields.Char(
        compute='_compute_org_label', store=True,
        help="This line's display label: the Trial Org's own name, or \"Unattributed\" when "
             "trial_org_id is blank.")
    spend = fields.Float(required=True, readonly=True, digits=(16, 2))
    spend_share_pct = fields.Float(
        compute='_compute_spend_share_pct',
        help="This line's share of its snapshot's total_spend, as a percentage (0 when "
             "total_spend is 0).")

    @api.depends('trial_org_id', 'trial_org_id.name')
    def _compute_org_label(self):
        for line in self:
            line.org_label = line.trial_org_id.name or "Unattributed"

    @api.depends('spend', 'snapshot_id.total_spend')
    def _compute_spend_share_pct(self):
        for line in self:
            total = line.snapshot_id.total_spend
            line.spend_share_pct = (line.spend / total * 100) if total else 0.0
