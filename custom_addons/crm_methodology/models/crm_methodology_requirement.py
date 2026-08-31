from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError

PROPERTY_TYPES = [
    ('char', "Text"),
    ('many2one', "Link to a record"),
    ('boolean', "Checkbox"),
]


class CrmMethodologyRequirement(models.Model):
    _name = 'crm.methodology.requirement'
    _description = "Sales Methodology Requirement"
    _order = 'sequence, id'

    methodology_id = fields.Many2one('crm.methodology', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)

    property_key = fields.Char(
        required=True,
        help="Technical key stored in the opportunity's Properties. Must be unique across every "
             "methodology, since Properties on a team share one flat namespace.",
    )
    property_label = fields.Char(
        required=True, string="Field Label",
        help="Shown as the Properties field's label once synced onto a team.",
    )
    property_type = fields.Selection(PROPERTY_TYPES, required=True, default='char')
    property_comodel = fields.Char(
        string="Linked Model",
        help="Technical model name (e.g. res.partner) for a Link-type field.",
    )

    checkpoint = fields.Selection([
        ('quotation', "Quotation Created"),
        ('won', "Marked Won"),
        ('lost', "Marked Lost"),
        ('continuous', "Continuous (no gate)"),
    ], required=True, default='continuous')
    enforcement = fields.Selection([
        ('block', "Block"),
        ('warn', "Warn"),
    ], required=True, default='warn')

    _property_key_unique = models.Constraint(
        'unique(property_key)',
        "This property key is already used by another Requirement (Properties share one "
        "namespace per team, across every methodology).",
    )

    @api.constrains('property_type', 'property_comodel')
    def _check_comodel_for_many2one(self):
        for requirement in self:
            if requirement.property_type == 'many2one' and not requirement.property_comodel:
                raise ValidationError(_("A Link-type Requirement needs a Linked Model."))

    def _check_compatible_with_team(self, team):
        """Raise if any of these Requirements' keys already exist on the team's Properties with a
        different type/model than this Requirement now expects (e.g. a Requirement was edited
        after an earlier sync already pushed its old shape onto the team)."""
        existing_by_key = {d['name']: d for d in (team.lead_properties_definition or [])}

        def is_incompatible(requirement):
            existing = existing_by_key.get(requirement.property_key)
            if not existing:
                return False
            return (existing.get('type'), existing.get('comodel') or False) \
                != (requirement.property_type, requirement.property_comodel or False)

        incompatible = self.filtered(is_incompatible)
        if incompatible:
            raise UserError(_(
                "%(fields)s already exist on %(team)s with a different type. Resolve the "
                "conflict on the Sales Team's Properties before syncing.",
                fields=", ".join(incompatible.mapped('property_label')),
                team=team.display_name,
            ))

    def _build_property_definition(self):
        """Return the dict shape Odoo's Properties field expects, so this Requirement's field
        can be materialized onto any team's lead_properties_definition."""
        self.ensure_one()
        definition = {
            'name': self.property_key,
            'string': self.property_label,
            'type': self.property_type,
            'default': False,
            'view_in_cards': False,
        }
        if self.property_type == 'many2one':
            definition['comodel'] = self.property_comodel
            definition['domain'] = False
        return definition
