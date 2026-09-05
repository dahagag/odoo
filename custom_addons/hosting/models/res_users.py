from odoo import fields, models


class ResUsers(models.Model):
    # Tracks whether this user has already dismissed the Trial Org's first-login onboarding
    # prompt (#121) - one flag per user, not a separate model (see docs/agents/
    # odoo-19-development.md's "One-time, per-user UI state" note). Not scoped to a specific
    # Trial Org record: safe only because `hosting` is deliberately installed on exactly one
    # Trial Org's own instance per database (org_registration.py's module docstring) - a
    # database that ever held more than one Trial Org would need this scoped instead.
    _inherit = 'res.users'

    hosting_onboarding_seen = fields.Boolean(default=False)

    @property
    def SELF_READABLE_FIELDS(self):
        return super().SELF_READABLE_FIELDS + ['hosting_onboarding_seen']

    @property
    def SELF_WRITEABLE_FIELDS(self):
        return super().SELF_WRITEABLE_FIELDS + ['hosting_onboarding_seen']
