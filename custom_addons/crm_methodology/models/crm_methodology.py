from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools.convert import convert_file

# The XML ID prefix every record in demo/crm_methodology_demo.xml is given, distinct from the
# permanent config records in data/crm_methodology_data.xml (crm_methodology_meddic, ...req_*,
# ...pb_*): lets the reset find exactly what that file seeded without hardcoding its record list.
DEMO_XMLID_PREFIX = 'crm_methodology_demo_'

# Generic Odoo demo logins the demo file assigns opportunities/activities to, alongside its own
# three named stakeholder personas. res.users itself is deliberately not reset: these logins
# persist across a reset, only the CRM data attributed to them does.
# Ownership-based matching (see RESET_PERSONA_OWNED_MODELS below) is DB-wide, not scoped to this
# module: on a database where other installed modules' own demo data also assigns leads/partners
# to base.user_admin/base.user_demo, a reset wipes those too. Accepted for this module's intended
# use as a dedicated single-purpose demo database, not a shared multi-app demo.
DEMO_PERSONA_USER_XMLIDS = (
    'base.user_admin',
    'base.user_demo',
    'crm_methodology.crm_methodology_demo_user_sales_manager',
    'crm_methodology.crm_methodology_demo_user_salesperson',
    'crm_methodology.crm_methodology_demo_user_viewer',
)

# Models with a 'user_id' ownership field: cleared both by seeded-record XML ID and by whichever
# persona a record is currently assigned to, so records created live during a demo session (no
# XML ID of their own) are caught too.
RESET_PERSONA_OWNED_MODELS = ('crm.lead', 'mail.activity', 'res.partner')

# Models this module seeds with no per-record owner: only the originally seeded rows (identified
# by XML ID) are in scope, never anything else a Sales Manager may have configured since.
RESET_SEEDED_ONLY_MODELS = (
    'crm.methodology', 'crm.methodology.requirement', 'crm.methodology.playbook.question')


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

    @api.model
    def action_reset_demo_data(self):
        """Wipe everything owned by the demo personas and replay demo/crm_methodology_demo.xml
        to restore the original seeded state. The feature's primary test seam: callable directly,
        independent of whatever UI wizard/button triggers it."""
        if not self.env.user.has_group('sales_team.group_sale_manager'):
            raise AccessError(_("Only a Sales Manager can reset the demo data."))
        self.sudo()._reset_demo_data()

    def _reset_demo_data(self):
        persona_user_ids = self._get_demo_persona_user_ids()
        for model_name in RESET_PERSONA_OWNED_MODELS:
            Model = self.env[model_name].with_context(active_test=False)
            # Includes each persona user's own delegated res.partner, registered under a
            # 'crm_methodology_demo_user_*_res_partner' XML ID by the ORM's own _inherits
            # handling: filtered back out below, since res.users is never part of the reset.
            record_ids = set(self._get_demo_seeded_ids(model_name))
            if persona_user_ids and 'user_id' in Model._fields:
                record_ids.update(Model.search([('user_id', 'in', persona_user_ids)]).ids)
            records = Model.browse(record_ids).exists()
            if 'user_ids' in Model._fields:
                records = records.filtered(lambda record: not record.user_ids)
            records.unlink()
        for model_name in RESET_SEEDED_ONLY_MODELS:
            self.env[model_name].browse(self._get_demo_seeded_ids(model_name)).exists().unlink()
        convert_file(
            self.env, 'crm_methodology', 'demo/crm_methodology_demo.xml', None,
            mode='init', noupdate=True,
        )

    def _get_demo_persona_user_ids(self):
        users = self.env['res.users']
        for xmlid in DEMO_PERSONA_USER_XMLIDS:
            user = self.env.ref(xmlid, raise_if_not_found=False)
            if user:
                users |= user
        return users.ids

    def _get_demo_seeded_ids(self, model_name):
        entries = self.env['ir.model.data'].search([
            ('module', '=', 'crm_methodology'),
            ('model', '=', model_name),
            ('name', '=like', f'{DEMO_XMLID_PREFIX}%'),
        ])
        return entries.mapped('res_id')
