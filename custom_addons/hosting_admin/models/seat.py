import re

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError

# Pragmatic RFC-5322-ish check: local part of at least one char, an '@', then a domain that
# looks like the same shape _DOMAIN_RE in trial_org.py validates (labels of letters/digits/
# hyphens, at least one dot) - good enough to reject an obviously-malformed invite email
# without pulling in a dedicated email-validation dependency.
_EMAIL_RE = re.compile(
    r'^[^@\s]+@(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$',
)


class HostingTrialOrgSeat(models.Model):
    # A named user account within a Trial Org (docs/contexts/hosting/CONTEXT.md's Seat entry).
    # Lives alongside hosting.trial.org in hosting_admin rather than in the not-yet-built
    # org-facing `hosting` addon (ADR-0018): the self-service invite rules this ticket enforces
    # (domain lock, seat cap) are pure Trial Org business logic, not the org-facing Org
    # Registration display, so they belong with the model that already owns prospect_domain and
    # seat_cap rather than duplicated into a thin addon that doesn't exist yet.
    _name = 'hosting.trial.org.seat'
    _description = "Trial Org Seat"
    _order = 'create_date'

    trial_org_id = fields.Many2one(
        'hosting.trial.org', required=True, ondelete='cascade', index=True)
    email = fields.Char(required=True)
    state = fields.Selection([
        ('invited', "Invited"),
        ('accepted', "Accepted"),
    ], default='invited', required=True)
    # Blank for a Trial Org's first Seat (created via a Targeted Invite or a confirmed Open
    # Invite Link - both out of this ticket's scope, per its parent spec's Invitation Paths
    # decision); set for every Seat created by a teammate's self-service invite.
    invited_by_id = fields.Many2one('hosting.trial.org.seat', string="Invited By")

    @api.constrains('email')
    def _check_email(self):
        for seat in self:
            if not _EMAIL_RE.fullmatch(seat.email or ''):
                raise ValidationError(_(
                    "%(email)r is not a valid email address.", email=seat.email,
                ))

    @api.constrains('email', 'trial_org_id')
    def _check_email_matches_prospect_domain(self):
        for seat in self:
            domain = seat.trial_org_id.prospect_domain or ''
            email_domain = (seat.email or '').rsplit('@', 1)[-1]
            if email_domain.lower() != domain.lower():
                raise ValidationError(_(
                    "%(email)s does not match this Trial Org's prospect domain "
                    "(%(domain)s).", email=seat.email, domain=domain,
                ))

    @api.constrains('trial_org_id')
    def _check_seat_cap(self):
        for trial_org in self.mapped('trial_org_id'):
            seat_count = self.search_count([('trial_org_id', '=', trial_org.id)])
            if seat_count > trial_org.seat_cap:
                raise ValidationError(_(
                    "%(name)s has no remaining Seats (cap is %(seat_cap)s).",
                    name=trial_org.name, seat_cap=trial_org.seat_cap,
                ))

    def action_invite(self, email):
        """Invite ``email`` to this Seat's Trial Org, on behalf of this Seat. Only an already
        ``accepted`` Seat may invite - a still-``invited`` Seat is not yet a member and cannot
        vouch for anyone else."""
        self.ensure_one()
        if self.state != 'accepted':
            raise AccessError(_(
                "Only an accepted Trial Org member can invite a teammate."))
        return self.env['hosting.trial.org.seat'].create({
            'trial_org_id': self.trial_org_id.id,
            'email': email,
            'invited_by_id': self.id,
        })

    def action_accept(self):
        self.write({'state': 'accepted'})
