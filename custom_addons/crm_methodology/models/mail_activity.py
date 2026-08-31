from odoo import models


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    def action_feedback(self, feedback=False, attachment_ids=None):
        # The playbook wizard only makes sense one activity at a time (its questions are asked
        # about a single opportunity); fall through to the stock batch behavior otherwise.
        if not self.env.context.get('crm_methodology_playbook_bypass') and len(self) == 1:
            activity = self
            if activity.res_model == 'crm.lead':
                lead = self.env['crm.lead'].browse(activity.res_id)
                questions = lead.methodology_id.playbook_question_ids.filtered(
                    lambda q: q.activity_type_id == activity.activity_type_id,
                )
                if questions:
                    wizard = self.env['crm.methodology.playbook.wizard'].create({
                        'activity_id': activity.id,
                        'feedback': feedback or '',
                        'attachment_ids': [(6, 0, attachment_ids or [])],
                    })
                    return wizard._open_wizard()
        return super().action_feedback(feedback=feedback, attachment_ids=attachment_ids)
