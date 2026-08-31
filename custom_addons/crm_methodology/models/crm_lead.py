from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError


class CrmLead(models.Model):
    _inherit = 'crm.lead'

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
    methodology_property_keys = fields.Char(
        compute='_compute_methodology_property_keys',
        help="Comma-separated Property keys owned by this opportunity's own methodology. Lets the "
             "Qualification tab's widget filter the team's Properties (shared, and possibly also "
             "populated by other methodologies) down to just this methodology's own fields; see "
             "docs/adr/0005.",
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

    @api.depends('methodology_id', 'methodology_id.requirement_ids.enforcement', 'lead_properties')
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

    @api.depends('methodology_id.requirement_ids.property_key')
    def _compute_methodology_property_keys(self):
        for lead in self:
            lead.methodology_property_keys = ",".join(lead.methodology_id.requirement_ids.mapped('property_key'))

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

    def action_set_lost(self, **additional_values):
        self._check_methodology_checkpoint('lost')
        return super().action_set_lost(**additional_values)

    def action_sync_methodology_properties(self):
        self.ensure_one()
        if not self.team_id:
            raise UserError(_("Assign a Sales Team to this opportunity first."))
        missing = self._get_requirements_missing_from_team()
        if not missing:
            return
        new_definition = list(self.team_id.lead_properties_definition or [])
        new_definition.extend(requirement._build_property_definition() for requirement in missing)
        self.team_id.lead_properties_definition = new_definition
