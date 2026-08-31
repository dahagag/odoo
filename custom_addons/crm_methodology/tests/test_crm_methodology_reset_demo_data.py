from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tools.convert import convert_file


@tagged('post_install', '-at_install')
class TestCrmMethodologyResetDemoData(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        demo_env = cls.env(context={**cls.env.context, 'install_demo': True})
        # Same loading path as test_crm_methodology_demo.py: the standard test wrapper disables
        # demo data, so load the upstream records this file references, then the addon's own.
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
        cls.sales_manager = cls.env.ref('crm_methodology.crm_methodology_demo_user_sales_manager')
        cls.salesperson = cls.env.ref('crm_methodology.crm_methodology_demo_user_salesperson')
        cls.viewer = cls.env.ref('crm_methodology.crm_methodology_demo_user_viewer')
        cls.demo_salesperson = cls.env.ref('base.user_demo')
        cls.demo_manager = cls.env.ref('base.user_admin')

    def _assert_seeded_state_restored(self):
        demo_leads = self.env['crm.lead'].with_context(active_test=False).browse([
            self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_new').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_qualified').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_proposition').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_won').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_new').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_proposition').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_sandler_lost').id,
            self.env.ref('crm_methodology.crm_methodology_demo_lead_spin_new').id,
        ])

        companies = demo_leads.partner_id
        self.assertEqual(
            set(companies.mapped('name')),
            {'Nimbus Robotics', 'Falcon Logistics', 'Comet Analytics'},
        )
        self.assertTrue(all(companies.mapped('is_company')))
        self.assertEqual(len(demo_leads), 8)

        open_stage_names = set(demo_leads.filtered('active').stage_id.mapped('name'))
        lost_leads = demo_leads.filtered(lambda lead: lead.won_status == 'lost')
        self.assertEqual(open_stage_names, {'New', 'Qualified', 'Proposition', 'Won'})
        self.assertEqual(lost_leads.mapped('name'), ['Falcon Logistics - Cold Chain Monitoring'])

        activity = self.env.ref('crm_methodology.crm_methodology_demo_activity_spin_call')
        wizard_action = activity.with_user(self.demo_salesperson).action_feedback()
        self.assertEqual(wizard_action.get('res_model'), 'crm.methodology.playbook.wizard')

    def test_reset_removes_extra_persona_owned_leads_and_partners(self):
        extra_partner = self.env['res.partner'].create({
            'name': "Extra Demo Client",
            'is_company': True,
            'user_id': self.demo_manager.id,
        })
        extra_lead = self.env['crm.lead'].create({
            'name': "Extra Demo Opportunity",
            'type': 'opportunity',
            'partner_id': extra_partner.id,
            'user_id': self.demo_salesperson.id,
        })

        self.env['crm.methodology'].with_user(self.sales_manager).action_reset_demo_data()

        self.assertFalse(extra_lead.exists())
        self.assertFalse(extra_partner.exists())

    def test_reset_restores_the_original_seeded_state(self):
        self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_won').with_user(
            self.demo_manager).write({'name': "Tampered Name"})
        self.env.ref('crm_methodology.crm_methodology_demo_partner_nimbus').write({
            'name': "Tampered Company",
        })

        self.env['crm.methodology'].with_user(self.sales_manager).action_reset_demo_data()

        self._assert_seeded_state_restored()
        self.assertEqual(
            self.env.ref('crm_methodology.crm_methodology_demo_lead_meddic_won').name,
            "Nimbus Robotics - Phase 1 Rollout",
        )
        self.assertEqual(
            self.env.ref('crm_methodology.crm_methodology_demo_partner_nimbus').name,
            "Nimbus Robotics",
        )

    def test_reset_is_idempotent(self):
        Model = self.env['crm.methodology'].with_user(self.sales_manager)

        Model.action_reset_demo_data()
        Model.action_reset_demo_data()

        self._assert_seeded_state_restored()

    def test_reset_requires_sales_manager_group(self):
        with self.assertRaises(AccessError):
            self.env['crm.methodology'].with_user(self.salesperson).action_reset_demo_data()

        with self.assertRaises(AccessError):
            self.env['crm.methodology'].with_user(self.viewer).action_reset_demo_data()
