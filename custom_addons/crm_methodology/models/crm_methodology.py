from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError


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

    def _get_seeded_default(self):
        """Return the immutable fallback record shipped by this module."""
        return self.env.ref('crm_methodology.crm_methodology_none', raise_if_not_found=False)

    @api.constrains('is_default')
    def _check_single_default(self):
        count = self.env['crm.methodology'].with_context(active_test=False).search_count(
            [('is_default', '=', True)])
        if count > 1:
            raise ValidationError(_("Only one Sales Methodology can be the default."))

    @api.constrains('active', 'is_default')
    def _check_default_not_archived(self):
        for methodology in self:
            if methodology.is_default and not methodology.active:
                raise ValidationError(_("The default Sales Methodology can't be archived."))

    @api.ondelete(at_uninstall=False)
    def _unlink_except_default(self):
        seeded_default = self._get_seeded_default()
        if any(self.mapped('is_default')) or (seeded_default and seeded_default in self):
            raise UserError(_("The default Sales Methodology can't be deleted."))

    def write(self, vals):
        seeded_default = self._get_seeded_default()
        if 'is_default' in vals and not vals['is_default'] and seeded_default and seeded_default in self:
            raise ValidationError(_("The ‘None’ Sales Methodology must remain the default."))
        return super().write(vals)
