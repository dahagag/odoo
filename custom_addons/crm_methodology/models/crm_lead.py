from datetime import datetime, timedelta
from datetime import time as dt_time

import babel.dates
import pytz

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools.misc import babel_locale_parse, format_date, get_lang

# docs/contexts/hosting/CONTEXT.md: "An isolated Odoo instance ... running for a fixed window
# (default 14 days) before Auto-Destroy." hosting_admin's own Trial Org model never sets
# expiry_date itself (it only tracks the issued/active/suspended/destroyed state machine), so
# this addon is responsible for the initial 14-day window.
TRIAL_INITIAL_EXPIRY_DAYS = 14

# docs/contexts/hosting/CONTEXT.md's Extension entry doesn't mandate a specific increment, only
# that the action "pushes out a Trial Org's expiry date". 14 days is a reasonable, editable
# starting point on the wizard, not a value the spec ties to TRIAL_INITIAL_EXPIRY_DAYS above -
# kept as its own constant so the two can diverge later without looking like a bug.
TRIAL_DEFAULT_EXTENSION_DAYS = 14

# docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry: "A short-lived (7-day) database
# snapshot is retained afterward in case of revival." This is a documented policy figure only -
# hosting_admin (#108) has no snapshot/retention model or job at all yet, so this constant drives
# informational display text here, not any enforced system behavior.
TRIAL_DATA_RETENTION_DAYS = 7


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    trial_org_id = fields.Many2one(
        'hosting.trial.org', string="Trial Org", copy=False, readonly=True,
        help="The Trial Org issued for this opportunity's prospect, if any.",
    )
    trial_expiry_date = fields.Date(
        related='trial_org_id.expiry_date', string="Trial Expiry",
        help="The date Auto-Destroy fires for this opportunity's Trial Org, absent a further "
             "Extension. Rendered in the viewing user's own date format/timezone by the Date "
             "widget, same as any other date field.",
    )
    trial_expiry_countdown = fields.Char(
        string="Trial Expiry Countdown", compute='_compute_trial_expiry_countdown',
        # A plain compute='' field defaults compute_sudo to False (unlike related='', which
        # defaults it to True) - without this, reading trial_org_id.expiry_date below raises
        # AccessError for every user without hosting_admin's Administrator group, i.e. every
        # real salesperson (docs/adr/0018). This mirrors what the related trial_expiry_date
        # field above already gets for free.
        compute_sudo=True,
        help="Time remaining until Auto-Destroy, computed against the viewing user's own "
             "timezone - not stored, so it reflects 'now' the moment this record is read.",
    )
    trial_expiry_display = fields.Html(
        string="Trial Expiry", compute='_compute_trial_expiry_countdown', compute_sudo=True,
        sanitize=False,
        help="The Trial Org's expiry date, formatted per the viewing user's own language, with "
             "the countdown to Auto-Destroy and the post-Auto-Destroy data retention window "
             "alongside it. The retention figure reflects the policy documented in "
             "docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry - hosting_admin does not "
             "yet automate that snapshot/retention itself, so this is informational, not a "
             "tracked system guarantee.",
    )

    @api.depends('trial_org_id.expiry_date')
    def _compute_trial_expiry_countdown(self):
        for lead in self:
            expiry_date = lead.trial_org_id.expiry_date
            countdown = lead._trial_expiry_countdown_label(expiry_date)
            lead.trial_expiry_countdown = countdown
            if not expiry_date:
                lead.trial_expiry_display = False
                continue
            lead.trial_expiry_display = _(
                "%(date)s <strong>%(countdown)s</strong> + %(retention_days)s days of data retention",
                date=format_date(lead.env, expiry_date), countdown=countdown,
                retention_days=TRIAL_DATA_RETENTION_DAYS,
            )

    def _trial_expiry_countdown_label(self, expiry_date):
        """A human countdown to Auto-Destroy in the viewing user's own timezone: days while more
        than a day remains, then hours, then minutes as the deadline gets close - since
        hosting.trial.org's ``expiry_date`` is a Date with no time-of-day, Auto-Destroy is taken
        to run through the end of that calendar day in the viewer's timezone, not its start.

        The magnitude+unit text (e.g. "5 days", "1 hour") is rendered by Babel's
        ``format_timedelta`` against the viewer's own language/locale (odoo.tools.misc.get_lang,
        babel_locale_parse) rather than a hand-rolled ``"%(n)s days"`` template: CLDR plural
        rules vary far more than English's singular/plural split (e.g. Arabic and Russian have
        several plural forms with different thresholds), so only Babel's own locale data can
        pluralize correctly across every language this instance might run in. Only the
        surrounding "... left"/"expired" wording goes through Odoo's own translation."""
        self.ensure_one()
        if not expiry_date:
            return False
        tz = pytz.timezone(self.env.user.tz or 'UTC')
        now_local = pytz.utc.localize(fields.Datetime.now()).astimezone(tz)
        expiry_local = tz.localize(datetime.combine(expiry_date, dt_time.max))
        remaining = expiry_local - now_local
        if remaining.total_seconds() <= 0:
            return _("expired")
        if remaining >= timedelta(days=1):
            granularity = 'day'
        elif remaining >= timedelta(hours=1):
            granularity = 'hour'
        else:
            granularity = 'minute'
        locale = babel_locale_parse(get_lang(self.env).code)
        # threshold=1 keeps the chosen granularity from rounding up into the next unit (Babel's
        # own default of 0.85 would otherwise render e.g. 23h50m as "1 day").
        duration = babel.dates.format_timedelta(remaining, granularity=granularity, threshold=1, locale=locale)
        return _("%(duration)s left", duration=duration)
    methodology_id = fields.Many2one(
        'crm.methodology', string="Sales Methodology",
        help="Defaults from the client's Sales Methodology when this opportunity is created. "
             "Stays independently editable afterward and never changes retroactively if the "
             "client's own methodology is changed later.",
    )
    methodology_completion = fields.Float(
        string="Qualification Completion", compute='_compute_methodology_completion', store=True,
        aggregator='avg',
        help="Percentage of this methodology's Block-enforcement Requirements that are filled in. "
             "Warn-level gaps don't affect this score.",
    )
    methodology_warning_labels = fields.Char(
        string="Qualification Warnings", compute='_compute_methodology_gaps',
    )
    methodology_block_labels = fields.Char(
        string="Qualification Blockers", compute='_compute_methodology_gaps',
    )
    methodology_properties_to_sync = fields.Integer(
        string="Properties to Sync", compute='_compute_methodology_properties_to_sync',
    )

    @api.model_create_multi
    def create(self, vals_list):
        default_methodology = self.env['crm.methodology']._get_default()
        for vals in vals_list:
            if vals.get('methodology_id'):
                continue
            partner_id = vals.get('partner_id')
            methodology = False
            if partner_id:
                methodology = self.env['res.partner'].browse(partner_id).methodology_id
            vals['methodology_id'] = (methodology or default_methodology).id
        return super().create(vals_list)

    @api.onchange('partner_id')
    def _onchange_partner_id_methodology(self):
        for lead in self:
            if lead.partner_id and not lead._origin.id:
                lead.methodology_id = lead.partner_id.methodology_id

    @api.constrains('methodology_id')
    def _check_methodology_id_required(self):
        for lead in self:
            if not lead.methodology_id:
                raise ValidationError(_("A Sales Methodology is required (use “None” if not yet decided)."))

    @api.depends('methodology_id', 'methodology_id.requirement_ids.enforcement',
                 'methodology_id.requirement_ids.property_key', 'lead_properties')
    def _compute_methodology_completion(self):
        for lead in self:
            block_requirements = lead.methodology_id.requirement_ids.filtered(lambda r: r.enforcement == 'block')
            if not block_requirements:
                lead.methodology_completion = 100.0
                continue
            filled = sum(1 for req in block_requirements if lead.lead_properties.get(req.property_key))
            lead.methodology_completion = 100.0 * filled / len(block_requirements)

    @api.depends('methodology_id', 'methodology_id.requirement_ids.enforcement', 'lead_properties')
    def _compute_methodology_gaps(self):
        for lead in self:
            missing_warn = lead._get_missing_requirements(enforcement='warn')
            missing_block = lead._get_missing_requirements(enforcement='block')
            lead.methodology_warning_labels = ", ".join(missing_warn.mapped('property_label'))
            lead.methodology_block_labels = ", ".join(missing_block.mapped('property_label'))

    @api.depends('methodology_id', 'methodology_id.requirement_ids.property_key',
                 'team_id', 'team_id.lead_properties_definition')
    def _compute_methodology_properties_to_sync(self):
        for lead in self:
            lead.methodology_properties_to_sync = len(lead._get_requirements_missing_from_team())

    def _get_missing_requirements(self, checkpoint=None, enforcement=None):
        self.ensure_one()
        requirements = self.methodology_id.requirement_ids
        if checkpoint:
            requirements = requirements.filtered(lambda r: r.checkpoint == checkpoint)
        if enforcement:
            requirements = requirements.filtered(lambda r: r.enforcement == enforcement)
        return requirements.filtered(lambda r: not self.lead_properties.get(r.property_key))

    def _get_requirements_missing_from_team(self):
        self.ensure_one()
        if not self.team_id or not self.methodology_id:
            return self.env['crm.methodology.requirement']
        existing_keys = {definition['name'] for definition in (self.team_id.lead_properties_definition or [])}
        return self.methodology_id.requirement_ids.filtered(lambda r: r.property_key not in existing_keys)

    def _check_methodology_checkpoint(self, checkpoint):
        for lead in self:
            missing_block = lead._get_missing_requirements(checkpoint=checkpoint, enforcement='block')
            if missing_block:
                raise ValidationError(_(
                    "%(lead)s is missing required %(methodology)s fields: %(fields)s",
                    lead=lead.name,
                    methodology=lead.methodology_id.name,
                    fields=", ".join(missing_block.mapped('property_label')),
                ))

    def action_set_won(self):
        self._check_methodology_checkpoint('won')
        return super().action_set_won()

    def action_sync_methodology_properties(self):
        self.ensure_one()
        if not self.env.user.has_group('sales_team.group_sale_salesman'):
            raise AccessError(_("Only Salespeople can sync methodology properties to a Sales Team."))
        self.check_access('write')
        if not self.team_id:
            raise UserError(_("Assign a Sales Team to this opportunity first."))
        self.team_id.check_access('read')
        self.methodology_id.requirement_ids._check_compatible_with_team(self.team_id)
        missing = self._get_requirements_missing_from_team()
        if not missing:
            return
        new_definition = list(self.team_id.lead_properties_definition or [])
        new_definition.extend(requirement._build_property_definition() for requirement in missing)
        # Salespeople may fill qualification values but cannot otherwise administer Sales Teams.
        # Elevate only the exact field write promised by this confirmed action, after validating
        # the caller, opportunity, team, and every property definition under the caller's access.
        self.team_id.sudo().write({'lead_properties_definition': new_definition})

    def action_issue_trial(self, prospect_domain, seat_cap, invite_type, invite_email=False):
        """Issue a Trial Org for this Opportunity's prospect via hosting_admin's model (docs/adr/
        0018, docs/adr/0026). Both invite paths lock the same ``prospect_domain`` on the Trial
        Org; only the delivery mechanism (a specific email vs. a domain-only link) differs -
        hosting_admin (ticket #108) has no Seat sub-model yet, so there is nothing here to
        pre-create for a Targeted Invite beyond the Trial Org itself; the distinction is
        recorded in the chatter message below instead."""
        self.ensure_one()
        if not self.env.user.has_group('sales_team.group_sale_salesman'):
            raise AccessError(_("Only Salespeople can issue a Trial Org."))
        self.check_access('write')
        if self.trial_org_id:
            raise UserError(_("A Trial Org has already been issued for this opportunity."))
        if invite_type not in ('targeted', 'open'):
            raise ValidationError(_(
                "Invite type must be either a Targeted Invite or an Open Invite Link."))
        if invite_type == 'targeted' and not invite_email:
            raise UserError(_("A Targeted Invite needs a specific email address."))
        if invite_type == 'open' and invite_email:
            raise UserError(_("An Open Invite Link doesn't take a specific email address."))
        if not prospect_domain:
            raise UserError(_("A prospect domain is required to issue a Trial Org."))
        if not isinstance(seat_cap, int) or seat_cap <= 0:
            raise UserError(_("Seat count must be a positive whole number."))
        # hosting.trial.org is Platform-only, cross-org data (docs/adr/0018) that an ordinary
        # salesperson has no direct access to. Elevate only after validating the caller and the
        # collected inputs above, and only for the exact create()/action_issue() this confirmed
        # action promises. hosting.trial.org's own constraints (domain format, system-wide seat
        # cap) still apply on top of these checks - this only stops obviously-bad input from
        # ever reaching the elevated call.
        trial_org = self.env['hosting.trial.org'].sudo().create({
            'name': self.partner_id.name or self.name,
            'prospect_domain': prospect_domain,
            'seat_cap': seat_cap,
            'expiry_date': fields.Date.context_today(self) + timedelta(days=TRIAL_INITIAL_EXPIRY_DAYS),
        })
        trial_org.action_issue()
        self.trial_org_id = trial_org.id
        if invite_type == 'targeted':
            message = _("Trial Org issued via a Targeted Invite to %(email)s.", email=invite_email)
        else:
            message = _(
                "Trial Org issued via an Open Invite Link for %(domain)s.", domain=prospect_domain)
        self.message_post(body=message)
        return trial_org

    def action_extend_trial(self, additional_days=TRIAL_DEFAULT_EXTENSION_DAYS):
        """Push out the linked Trial Org's expiry date (docs/contexts/hosting/CONTEXT.md's
        Extension), restricted to the Opportunity's owning salesperson or a sales manager."""
        self.ensure_one()
        if not (self.user_id == self.env.user or self.env.user.has_group('sales_team.group_sale_manager')):
            raise AccessError(_("Only this Opportunity's owner or a Sales Manager can extend its Trial Org."))
        self.check_access('write')
        if not self.trial_org_id:
            raise UserError(_("No Trial Org has been issued for this opportunity yet."))
        if not isinstance(additional_days, int) or additional_days <= 0:
            raise UserError(_("Additional days must be a positive whole number."))
        # See action_issue_trial() above: same narrow, post-validation sudo() boundary.
        trial_org = self.trial_org_id.sudo()
        base_date = trial_org.expiry_date or fields.Date.context_today(self)
        trial_org.write({'expiry_date': base_date + timedelta(days=additional_days)})
        self.message_post(body=_(
            "Trial Org extended by %(days)s days, new expiry %(expiry)s.",
            days=additional_days, expiry=trial_org.expiry_date,
        ))
        return True
