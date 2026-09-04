from odoo import fields, models


class HostingOrgRegistration(models.Model):
    # This org's own view of its Trial Org standing (docs/contexts/hosting/CONTEXT.md's Org
    # Registration entry): name, prospect domain, seats used/total, and expiry date. Lives on
    # the Trial Org's own instance, populated from that org's `hosting.trial.org` record in
    # `hosting_admin` (a separate database - the real sync mechanism is a later ticket's
    # concern, not this addon's). Deliberately has no write-side actions of its own: nothing in
    # this addon can change a Trial Org's lifecycle state.
    _name = 'hosting.org.registration'
    _description = "Org Registration"
    _order = 'create_date desc'

    name = fields.Char(string="Org Name", required=True)
    prospect_domain = fields.Char(string="Domain", required=True)
    seats_used = fields.Integer(string="Seats Used", required=True, default=0)
    seat_cap = fields.Integer(string="Seat Cap", required=True, default=0)
    expiry_date = fields.Date(string="Expiry Date")
