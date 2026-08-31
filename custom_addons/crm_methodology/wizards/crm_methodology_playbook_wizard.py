from odoo import _, api, fields, models
from odoo.exceptions import UserError


class CrmMethodologyPlaybookWizard(models.TransientModel):
    _name = 'crm.methodology.playbook.wizard'
    _description = "Sales Methodology Playbook"

    activity_id = fields.Many2one('mail.activity', required=True)
    activity_type_name = fields.Char(related='activity_id.activity_type_id.name', readonly=True)
    feedback = fields.Text()
    attachment_ids = fields.Many2many('ir.attachment')
    line_ids = fields.One2many('crm.methodology.playbook.wizard.line', 'wizard_id', string="Questions")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            activity_id = vals.get('activity_id')
            activity = self.env['mail.activity'].browse(activity_id).exists() if activity_id else activity_id
            questions = (
                activity._get_methodology_playbook_questions()
                if activity else self.env['crm.methodology.playbook.question']
            )
            if not questions:
                raise UserError(_("This activity has no applicable Sales Methodology Playbook."))
            # RPC callers cannot forge the question set: it always comes from the activity's
            # current opportunity, methodology, and activity type.
            vals['line_ids'] = [
                (0, 0, {'sequence': question.sequence, 'question_id': question.id})
                for question in questions
            ]
        return super().create(vals_list)

    def _validate_playbook(self):
        self.ensure_one()
        questions = self.activity_id._get_methodology_playbook_questions()
        actual_question_ids = self.line_ids.sorted().question_id.ids
        if not questions or actual_question_ids != questions.ids:
            raise UserError(_("This Playbook no longer matches the activity's Sales Methodology."))
        self.attachment_ids.check_access('read')
        return questions

    def _open_wizard(self):
        return {
            'type': 'ir.actions.act_window',
            'name': _("Discovery Playbook"),
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'views': [(False, 'form')],
            'target': 'new',
        }

    def _complete_activity(self, note):
        self.ensure_one()
        self._validate_playbook()
        full_feedback = "\n\n".join(filter(None, [self.feedback, note]))
        self.activity_id.with_context(crm_methodology_playbook_bypass=True).action_feedback(
            feedback=full_feedback, attachment_ids=self.attachment_ids.ids,
        )
        # Completing the activity here (via a button on this wizard) posts a new chatter message
        # on the underlying record, but nothing else tells that record's still-open form view to
        # notice - unlike Odoo's own "Mark Done" button, which explicitly refreshes the chatter
        # itself. A plain act_window_close only closes this dialog and leaves the stale view
        # behind, so reload the whole page instead: simple, and correct for a wizard that's an
        # occasional interaction, not a hot path worth a more surgical partial refresh.
        return {'type': 'ir.actions.client', 'tag': 'reload'}

    def action_confirm(self):
        self.ensure_one()
        answered = "\n".join(
            _("- %(question)s: %(answer)s", question=line.question, answer=line.answer or _("(no answer)"))
            for line in self.line_ids
        )
        return self._complete_activity(_("Playbook answered:\n%(answers)s", answers=answered))

    def action_skip(self):
        self.ensure_one()
        return self._complete_activity(_("Playbook skipped for this activity."))


class CrmMethodologyPlaybookWizardLine(models.TransientModel):
    _name = 'crm.methodology.playbook.wizard.line'
    _description = "Sales Methodology Playbook Wizard Line"
    _order = 'sequence, id'

    wizard_id = fields.Many2one('crm.methodology.playbook.wizard', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)
    question_id = fields.Many2one(
        'crm.methodology.playbook.question', string="Playbook Question", required=True, readonly=True,
    )
    question = fields.Char(related='question_id.question', readonly=True)
    answer = fields.Text()
