from datetime import date, datetime, timedelta

from freezegun import freeze_time

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

    def test_salesperson_without_hosting_access_can_read_trial_expiry_display(self):
        # Regression test: trial_expiry_countdown/trial_expiry_display are plain compute=
        # fields, which default compute_sudo to False (unlike related= fields, which default it
        # to True) - without compute_sudo=True on both, reading them raised AccessError for any
        # user outside hosting_admin's own Administrator group, i.e. every real salesperson.
        lead = self._create_lead(user_id=self.salesperson.id)
        lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        salesperson_lead = lead.with_user(self.salesperson)
        # Not "days left": at the default 14-day issuance window, Babel's own locale data
        # (deliberately not hardcoded here - see _trial_expiry_countdown_label) renders this as
        # "2 weeks left" rather than "14 days left".
        self.assertTrue(salesperson_lead.trial_expiry_countdown.endswith("left"))
        self.assertIn("days of data retention", salesperson_lead.trial_expiry_display)

    def test_expiry_countdown_transitions_from_days_to_hours_to_expired(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        trial_org.expiry_date = date(2026, 9, 4)

        with freeze_time(datetime(2026, 9, 1, 12, 0, 0)):
            lead.invalidate_recordset()
            self.assertIn("days left", lead.trial_expiry_countdown)

        with freeze_time(datetime(2026, 9, 4, 12, 0, 0)):
            lead.invalidate_recordset()
            self.assertIn("hours left", lead.trial_expiry_countdown)

        with freeze_time(datetime(2026, 9, 4, 23, 55, 0)):
            lead.invalidate_recordset()
            self.assertIn("minutes left", lead.trial_expiry_countdown)

        with freeze_time(datetime(2026, 9, 5, 0, 0, 1)):
            lead.invalidate_recordset()
            self.assertEqual(lead.trial_expiry_countdown, "expired")

    def test_expiry_countdown_pluralizes_via_babel_not_a_hardcoded_template(self):
        # 14 days is exactly 2 weeks: Babel's own locale data (not a hand-rolled "%(n)s days"
        # template) chooses the coarser, more natural unit humans actually use for that
        # duration - proof this delegates real pluralization/unit choice to the localization
        # library rather than reimplementing it.
        lead = self._create_lead(user_id=self.salesperson.id)
        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        # Auto-Destroy runs through the end of expiry_date, so the frozen instant is set 13 full
        # days before it at midnight - a hair under 14 days remains, which Babel rounds to 14.
        trial_org.expiry_date = date(2026, 9, 18)

        with freeze_time(datetime(2026, 9, 5, 0, 0, 0)):
            lead.invalidate_recordset()
            self.assertEqual(lead.trial_expiry_countdown, "2 weeks left")

        # A little over one day remaining is not a whole number of weeks, so Babel reports it
        # in days instead, with correct singular agreement ("day", not "days").
        trial_org.expiry_date = date(2026, 9, 5)
        with freeze_time(datetime(2026, 9, 4, 23, 0, 0)):
            lead.invalidate_recordset()
            self.assertEqual(lead.trial_expiry_countdown, "1 day left")

    def test_expiry_countdown_respects_the_viewing_users_own_timezone(self):
        lead = self._create_lead(user_id=self.salesperson.id)
        trial_org = lead.with_user(self.salesperson).action_issue_trial(
            prospect_domain="prospect.example.com", seat_cap=5, invite_type='open',
        )
        trial_org.expiry_date = date(2026, 9, 4)

        # The same frozen UTC instant reads as already past midnight for a user far enough
        # ahead of UTC, but still hours from midnight for a user far enough behind it - proving
        # the countdown is computed against each viewer's own tz, not a single server clock.
        with freeze_time(datetime(2026, 9, 4, 12, 0, 0)):
            self.salesperson.tz = 'Pacific/Kiritimati'
            lead.invalidate_recordset()
            self.assertEqual(lead.with_user(self.salesperson).trial_expiry_countdown, "expired")

            self.salesperson.tz = 'Etc/GMT+12'
            lead.invalidate_recordset()
            self.assertIn("hours left", lead.with_user(self.salesperson).trial_expiry_countdown)

    def test_trial_org_id_cannot_be_written_directly(self):
        # Regression test for the IDOR CodeRabbit flagged on PR #131: readonly=True only hides
        # trial_org_id in form views, so without this guard any user with ordinary write access
        # to crm.lead could point a lead at an arbitrary hosting.trial.org record directly,
        # bypassing action_issue_trial()'s validation and redirecting action_extend_trial()'s
        # sudo()-elevated write at a Trial Org they were never authorized to touch.
        lead = self._create_lead(user_id=self.salesperson.id)
        other_trial_org = self.env['hosting.trial.org'].sudo().create({
            'name': "Someone Else's Trial Org", 'prospect_domain': "other.example.com",
        })
        with self.assertRaises(AccessError):
            lead.with_user(self.salesperson).write({'trial_org_id': other_trial_org.id})

    def test_trial_org_id_cannot_be_set_on_create(self):
        preexisting_trial_org = self.env['hosting.trial.org'].sudo().create({
            'name': "Preexisting Trial Org", 'prospect_domain': "preexisting.example.com",
        })
        with self.assertRaises(AccessError):
            self.env['crm.lead'].with_user(self.salesperson).create({
                'name': "Attempted IDOR Opportunity",
                'type': 'opportunity',
                'partner_id': self.client.id,
                'team_id': self.team.id,
                'trial_org_id': preexisting_trial_org.id,
            })
