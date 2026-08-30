from odoo import api, fields, models


class ExampleAnnouncement(models.Model):
    _name = "example.announcement"
    _description = "Internal Announcement"
    _order = "create_date desc"

    name = fields.Char(string="Title", required=True)
    body = fields.Text(string="Message", required=True)
    author_id = fields.Many2one(
        "res.users",
        string="Author",
        default=lambda self: self.env.user,
        readonly=True,
    )
    expires_on = fields.Date(string="Expires On")
    active = fields.Boolean(default=True)
    is_expired = fields.Boolean(string="Expired", compute="_compute_is_expired")

    @api.depends("expires_on")
    def _compute_is_expired(self):
        today = fields.Date.context_today(self)
        for announcement in self:
            announcement.is_expired = bool(
                announcement.expires_on and announcement.expires_on < today,
            )
