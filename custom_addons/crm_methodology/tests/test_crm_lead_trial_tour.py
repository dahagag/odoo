from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestCrmLeadTrialTour(HttpCase):

    def test_issue_and_extend_trial_tour(self):
        admin = self.env.ref('base.user_admin')
        partner = self.env['res.partner'].create({
            'name': "Tour Test Trial Client",
            'email': "buyer@tour-trial.example.com",
        })
        self.env['crm.lead'].create({
            'name': "Tour Test Trial Opportunity",
            'type': 'opportunity',
            'partner_id': partner.id,
            'team_id': self.env.ref('sales_team.team_sales_department').id,
            'user_id': admin.id,
        })
        self.start_tour("/odoo", "crm_methodology_trial_tour", login="admin")
