from odoo import models


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    def _get_methodology_playbook_questions(self):
        """Return applicable questions after validating the activity's RPC boundary."""
        self.ensure_one()
        self.check_access('write')
        if self.res_model != 'crm.lead' or not self.res_id:
            return self.env['crm.methodology.playbook.question']
        lead = self.env['crm.lead'].browse(self.res_id).exists()
        if not lead:
            return self.env['crm.methodology.playbook.question']
        lead.check_access('read')
        return lead.methodology_id.playbook_question_ids.filtered(
            lambda question: question.activity_type_id == self.activity_type_id,
        )

    def action_feedback(self, feedback=False, attachment_ids=None):
        # The playbook wizard only makes sense one activity at a time (its questions are asked
        # about a single opportunity); fall through to the stock batch behavior otherwise.
        if not self.env.context.get('crm_methodology_playbook_bypass') and len(self) == 1:
            activity = self
            questions = activity._get_methodology_playbook_questions()
            if questions:
                wizard = self.env['crm.methodology.playbook.wizard'].create({
                    'activity_id': activity.id,
                    'feedback': feedback or '',
                    'attachment_ids': [(6, 0, attachment_ids or [])],
                })
                return wizard._open_wizard()
        return super().action_feedback(feedback=feedback, attachment_ids=attachment_ids)
