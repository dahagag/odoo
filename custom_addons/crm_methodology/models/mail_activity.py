from odoo import models


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    def action_feedback(self, feedback=False, attachment_ids=None):
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
                    })
                    return wizard._open_wizard()
        return super().action_feedback(feedback=feedback, attachment_ids=attachment_ids)
