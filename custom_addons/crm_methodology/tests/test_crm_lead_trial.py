from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCrmLeadTrial(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.team = cls.env['crm.team'].create({'name': "Trial Test Team"})
        cls.client = cls.env['res.partner'].create({
            'name': "Prospect Co",
            'email': "buyer@prospect.example.com",
        })
        cls.salesperson = cls._create_user("Trial Salesperson", 'sales_team.group_sale_salesman')
        cls.other_salesperson = cls._create_user("Other Trial Salesperson", 'sales_team.group_sale_salesman')
        cls.sales_manager = cls._create_user("Trial Sales Manager", 'sales_team.group_sale_manager')
        cls.internal_user = cls._create_user("Trial Internal User", 'base.group_user')

    @classmethod
    def _create_user(cls, name, group_xmlid):
        return cls.env['res.users'].create({
            'name': name,
            'login': name.lower().replace(' ', '_'),
            'lang': 'en_US',
            'group_ids': [(6, 0, cls.env.ref(group_xmlid).ids)],
        })

    def _create_lead(self, **extra):
        return self.env['crm.lead'].create({
            'name': "Trial Opportunity",
            'type': 'opportunity',
            'partner_id': self.client.id,
            'team_id': self.team.id,
            **extra,
        })

    def test_issue_trial_via_targeted_invite_activates_trial_org(self):
        lead = self._create_lead(user_id=self.salesperson.id)

        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=10,
            invite_type='targeted', invite_email="buyer@prospect.example.com",
        )

        self.assertEqual(lead.trial_org_id, trial_org)
        self.assertEqual(trial_org.state, 'active')
        self.assertEqual(trial_org.prospect_domain, "prospect.example.com")
        self.assertEqual(trial_org.seat_cap, 10)
        self.assertEqual(trial_org.expiry_date, fields.Date.today() + timedelta(days=14))

    def test_issue_trial_via_open_invite_link_locks_same_domain(self):
        lead = self._create_lead(user_id=self.salesperson.id)

        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5,
            invite_type='open',
        )

        self.assertEqual(trial_org.state, 'active')
        self.assertEqual(trial_org.prospect_domain, "prospect.example.com")

    def test_targeted_invite_requires_an_email(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        with self.assertRaises(UserError):
            lead.with_user(self.salesperson).action_issue_trial(
                prospect_domain="prospect.example.com", seat_cap=5, invite_type='targeted',
            )

    def test_open_invite_link_rejects_an_email(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        with self.assertRaises(UserError):
            lead.with_user(self.salesperson).action_issue_trial(
                prospect_domain="prospect.example.com", seat_cap=5,
                invite_type='open', invite_email="buyer@prospect.example.com",
            )

    def test_cannot_issue_a_second_trial_for_the_same_opportunity(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        with self.assertRaises(UserError):
            lead.with_user(self.salesperson).action_issue_trial(
                prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
            )

    def test_non_salesperson_cannot_issue_trial(self):
        lead = self._create_lead()
        with self.assertRaises(AccessError):
            lead.with_user(self.internal_user).action_issue_trial(
                prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
            )

    def test_owning_salesperson_can_extend_trial(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        original_expiry = trial_org.expiry_date

        lead.with_user(self.salesperson).action_extend_trial(additional_days=30)

        self.assertEqual(trial_org.expiry_date, original_expiry + timedelta(days=30))

    def test_sales_manager_can_extend_another_salespersons_trial(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        original_expiry = trial_org.expiry_date

        lead.with_user(self.sales_manager).action_extend_trial(additional_days=7)

        self.assertEqual(trial_org.expiry_date, original_expiry + timedelta(days=7))

    def test_other_salesperson_cannot_extend_trial(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        # Prime the shared prefetch as administrator: the public action must enforce the
        # ownership check explicitly rather than depending on a later field fetch to do it.
        lead.read(['user_id', 'trial_org_id'])
        with self.assertRaises(AccessError):
            lead.with_user(self.other_salesperson).action_extend_trial(additional_days=7)

    def test_cannot_extend_trial_before_one_is_issued(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        with self.assertRaises(UserError):
            lead.with_user(self.salesperson).action_extend_trial(additional_days=7)
