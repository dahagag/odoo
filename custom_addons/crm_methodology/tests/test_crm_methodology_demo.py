from odoo.tests import TransactionCase, tagged
from odoo.tools.convert import convert_file


@tagged('post_install', '-at_install')
class TestCrmMethodologyDemo(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        demo_env = cls.env(context={**cls.env.context, 'install_demo': True})
        # The standard test wrapper disables demo data. Load the upstream records this file
        # references, then the addon's real demo XML because that dataset is the contract here.
        for module, filename in (
            ('base', 'data/res_users_demo.xml'),
            ('sales_team', 'data/crm_team_demo.xml'),
        ):
            convert_file(demo_env, module, filename, None, mode='init', noupdate=True)
        convert_file(
            demo_env,
            'crm_methodology',
            'demo/crm_methodology_demo.xml',
            None,
            mode='init',
            noupdate=True,
        )
        cls.demo_leads = cls.env['crm.lead'].browse([
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_new').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_qualified').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_proposition').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_won').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_new').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_proposition').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_lost').id,
            cls.env.ref('crm_methodology.crm_methodology_demo_lead_spin_new').id,
        ])

    def test_demo_creates_client_companies_and_opportunities(self):
        companies = self.demo_leads.partner_id

        self.assertEqual(
            set(companies.mapped('name')),
            {'Nimbus Robotics', 'Falcon Logistics', 'Comet Analytics'},
        )
        self.assertTrue(all(companies.mapped('is_company')))
        self.assertEqual(len(self.demo_leads), 8)
        self.assertTrue(all(lead.type == 'opportunity' for lead in self.demo_leads))

    def test_demo_opportunities_span_the_pipeline(self):
        open_stage_names = set(self.demo_leads.filtered('active').stage_id.mapped('name'))
        lost_leads = self.demo_leads.filtered(lambda lead: lead.won_status == 'lost')

        self.assertEqual(open_stage_names, {'New', 'Qualified', 'Proposition', 'Won'})
        self.assertEqual(lost_leads.mapped('name'), ['Falcon Logistics - Cold Chain Monitoring'])

    def test_demo_covers_methodologies_and_completion_levels(self):
        self.assertEqual(
            set(self.demo_leads.methodology_id.mapped('name')),
            {'MEDDIC', 'Sandler Selling System', 'SPIN Selling'},
        )
        self.assertEqual(set(self.demo_leads.mapped('methodology_completion')), {0.0, 50.0, 100.0})

    def test_demo_has_a_staged_activity_that_opens_the_playbook(self):
        activity = self.env.ref('crm_methodology.crm_methodology_demo_activity_spin_call')
        salesperson = self.env.ref('base.user_demo')

        wizard_action = activity.with_user(salesperson).action_feedback()

        self.assertEqual(wizard_action.get('res_model'), 'crm.methodology.playbook.wizard')

    def test_demo_opportunities_are_split_between_salesperson_and_manager(self):
        salesperson = self.env.ref('base.user_demo')
        manager = self.env.ref('base.user_admin')

        self.assertTrue(self.demo_leads.filtered(lambda lead: lead.user_id == salesperson))
        self.assertTrue(self.demo_leads.filtered(lambda lead: lead.user_id == manager))
        self.assertEqual(self.demo_leads.user_id, salesperson | manager)
