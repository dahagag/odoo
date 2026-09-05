from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestTrialOrgOpenInvite(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.open_trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 2,
            'invite_type': 'open',
        })
        # The person completing a login through an Open Invite Link is an ordinary internal
        # user, never a Platform operator (hosting.trial.org/seat are Platform-only models per
        # docs/adr/0018 - see security/ir.model.access.csv, which grants neither any
        # base.group_user access at all).
        cls.ordinary_user = cls.env['res.users'].create({
            'name': "Ordinary Joiner",
            'login': 'ordinary_joiner',
            'group_ids': [(6, 0, cls.env.ref('base.group_user').ids)],
        })

    def test_matching_domain_first_login_creates_accepted_seat(self):
        seat = self.open_trial_org.action_join_open_invite("first@acme.example.com")

        self.assertEqual(seat.trial_org_id, self.open_trial_org)
        self.assertEqual(seat.state, 'accepted')
        self.assertFalse(seat.invited_by_id)

    def test_mismatched_domain_first_login_is_rejected_and_creates_no_seat(self):
        with self.assertRaises(ValidationError):
            self.open_trial_org.action_join_open_invite("stranger@other.example.com")

        self.assertEqual(
            self.env['hosting.trial.org.seat'].search_count(
                [('trial_org_id', '=', self.open_trial_org.id)]),
            0,
        )

    def test_second_use_of_the_link_follows_the_self_service_invite_rules(self):
        self.open_trial_org.action_join_open_invite("first@acme.example.com")

        second_seat = self.open_trial_org.action_join_open_invite("second@acme.example.com")
        self.assertEqual(second_seat.state, 'accepted')

        # seat_cap=2: the two joins above already fill it, so a third is rejected exactly as
        # ticket #110's self-service invite cap already enforces for a teammate-invited Seat.
        with self.assertRaises(ValidationError):
            self.open_trial_org.action_join_open_invite("third@acme.example.com")

    def test_cross_domain_second_use_is_still_rejected(self):
        self.open_trial_org.action_join_open_invite("first@acme.example.com")

        with self.assertRaises(ValidationError):
            self.open_trial_org.action_join_open_invite("stranger@other.example.com")

    def test_join_open_invite_rejected_for_a_targeted_invite_trial_org(self):
        targeted_trial_org = self.env['hosting.trial.org'].create({
            'name': "Targeted Trial",
            'prospect_domain': "targeted.example.com",
            'invite_type': 'targeted',
        })
        with self.assertRaises(UserError):
            targeted_trial_org.action_join_open_invite("buyer@targeted.example.com")

    def test_ordinary_user_has_no_direct_access_to_platform_only_models(self):
        # Establishes why action_join_open_invite() needs its own sudo() boundary below: without
        # it, the very user this feature exists for couldn't call it at all.
        with self.assertRaises(AccessError):
            self.open_trial_org.with_user(self.ordinary_user).read(['prospect_domain'])
        with self.assertRaises(AccessError):
            self.env['hosting.trial.org.seat'].with_user(self.ordinary_user).create({
                'trial_org_id': self.open_trial_org.id,
                'email': "first@acme.example.com",
            })

    def test_ordinary_user_can_join_via_open_invite_despite_no_direct_model_access(self):
        seat = self.open_trial_org.with_user(self.ordinary_user).action_join_open_invite(
            "first@acme.example.com")

        self.assertEqual(seat.state, 'accepted')
        self.assertEqual(seat.trial_org_id, self.open_trial_org)

    def test_ordinary_user_mismatched_domain_is_still_rejected(self):
        # The sudo() boundary elevates access, not business rules - a mismatched domain from an
        # ordinary user gets the same ValidationError (not silently accepted, and not masked by
        # an AccessError instead).
        with self.assertRaises(ValidationError):
            self.open_trial_org.with_user(self.ordinary_user).action_join_open_invite(
                "stranger@other.example.com")

        self.assertEqual(
            self.env['hosting.trial.org.seat'].search_count(
                [('trial_org_id', '=', self.open_trial_org.id)]),
            0,
        )
