from odoo import fields, models


class CrmMethodologyPlaybookQuestion(models.Model):
    _name = 'crm.methodology.playbook.question'
    _description = "Sales Methodology Playbook Question"
    _order = 'sequence, id'

    methodology_id = fields.Many2one('crm.methodology', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)
    activity_type_id = fields.Many2one(
        'mail.activity.type', required=True,
        help="The wizard for this question appears when a rep marks an activity of this type done "
             "on a lead using this methodology.",
    )
    question = fields.Char(required=True)
