from odoo import _, api, fields, models
from odoo.exceptions import UserError


class CrmMethodology(models.Model):
    _name = 'crm.methodology'
    _description = "Sales Methodology"
    _order = 'sequence, name'

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    is_default = fields.Boolean(
        string="Default (None)",
        help="Marks the fallback methodology assigned to clients with no real methodology chosen yet. "
             "Protected from deletion.",
    )
    description = fields.Text()
    requirement_ids = fields.One2many('crm.methodology.requirement', 'methodology_id', string="Requirements")
    playbook_question_ids = fields.One2many(
        'crm.methodology.playbook.question', 'methodology_id', string="Playbook Questions")

    _name_unique = models.Constraint(
        'unique(name)',
        "A Sales Methodology with this name already exists.",
    )

    @api.model
    def _get_default(self):
        """Return the "None" fallback methodology, the single source of truth for every place
        that needs it (a new client's default, a new opportunity with no client methodology)."""
        return self.search([('is_default', '=', True)], limit=1)

    def unlink(self):
        if any(self.mapped('is_default')):
            raise UserError(_("The default Sales Methodology can't be deleted."))
        return super().unlink()
