from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class ResPartner(models.Model):
    _inherit = 'res.partner'

    methodology_id = fields.Many2one(
        'crm.methodology', string="Sales Methodology",
        default=lambda self: self.env['crm.methodology'].search([('is_default', '=', True)], limit=1).id,
        help="Governs which qualification properties and discovery playbooks apply to this "
             "client's opportunities. New opportunities default to this methodology at creation "
             "time; changing it here does not retroactively change already-open opportunities.",
    )

    # Not declared required=True: that would make Odoo try to backfill this column with its
    # default during this module's own installation, before data/crm_methodology_data.xml (which
    # creates the default record) has necessarily run. Enforced here instead, once real usage
    # (long after install) can rely on the default record already existing.
    @api.constrains('methodology_id')
    def _check_methodology_id_required(self):
        for partner in self:
            if not partner.methodology_id:
                raise ValidationError(_("A Sales Methodology is required (use “None” if not yet decided)."))
