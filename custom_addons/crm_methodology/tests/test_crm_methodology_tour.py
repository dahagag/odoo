from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestCrmMethodologyTour(HttpCase):

    def test_playbook_wizard_tour(self):
        spin = self.env.ref('crm_methodology.crm_methodology_spin')
        admin = self.env.ref('base.user_admin')
        partner = self.env['res.partner'].create({
            'name': "Tour Test Client",
            'methodology_id': spin.id,
        })
        lead = self.env['crm.lead'].create({
            'name': "Tour Test Opportunity",
            'type': 'opportunity',
            'partner_id': partner.id,
            'team_id': self.env.ref('sales_team.team_sales_department').id,
            'user_id': admin.id,
        })
        self.env['mail.activity'].create({
            'res_model_id': self.env.ref('crm.model_crm_lead').id,
            'res_id': lead.id,
            'activity_type_id': self.env.ref('mail.mail_activity_data_call').id,
            'user_id': admin.id,
            'summary': "Discovery call",
        })
        self.start_tour("/odoo", "crm_methodology_playbook_tour", login="admin")
