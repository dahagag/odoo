from odoo import _, api, fields, models
from odoo.exceptions import UserError


class CrmMethodologyTrialIssueWizard(models.TransientModel):
    _name = 'crm.methodology.trial.issue.wizard'
    _description = "Issue Trial Org"

    lead_id = fields.Many2one('crm.lead', required=True, default=lambda self: self.env.context.get('active_id'))
    prospect_domain = fields.Char(
        required=True, default=lambda self: self._default_prospect_domain(),
        help="The prospect's expected email domain. Locked on the Trial Org once issued.",
    )
    seat_cap = fields.Integer(string="Seat Cap", default=5, required=True)
    invite_type = fields.Selection([
        ('targeted', "Targeted Invite"),
        ('open', "Open Invite Link"),
    ], default='targeted', required=True)
    invite_email = fields.Char(string="Invite Email")

    def _default_prospect_domain(self):
        lead = self.env['crm.lead'].browse(self.env.context.get('active_id'))
        email = lead.partner_id.email or lead.email_from
        if email and '@' in email:
            return email.rsplit('@', 1)[1]
        return False

    @api.onchange('invite_type')
    def _onchange_invite_type(self):
        if self.invite_type == 'open':
            self.invite_email = False

    def action_confirm(self):
        self.ensure_one()
        if self.invite_type == 'targeted' and not self.invite_email:
            raise UserError(_("Enter the specific email address for a Targeted Invite."))
        self.lead_id.action_issue_trial(
            prospect_domain=self.prospect_domain,
            seat_cap=self.seat_cap,
            invite_type=self.invite_type,
            invite_email=self.invite_email or False,
        )
        return {'type': 'ir.actions.client', 'tag': 'reload'}


class CrmMethodologyTrialExtendWizard(models.TransientModel):
    _name = 'crm.methodology.trial.extend.wizard'
    _description = "Extend Trial Org"

    lead_id = fields.Many2one('crm.lead', required=True, default=lambda self: self.env.context.get('active_id'))
    additional_days = fields.Integer(string="Additional Days", default=14, required=True)

    def action_confirm(self):
        self.ensure_one()
        self.lead_id.action_extend_trial(additional_days=self.additional_days)
        return {'type': 'ir.actions.client', 'tag': 'reload'}
