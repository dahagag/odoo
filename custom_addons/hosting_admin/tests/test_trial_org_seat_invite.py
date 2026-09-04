from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestTrialOrgSeatInvite(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 3,
        })
        # Stand in for the Trial Org's first Seat (created out of this ticket's scope via a
        # Targeted Invite / confirmed Open Invite Link) - already accepted, so it can invite.
        cls.first_seat = cls.env['hosting.trial.org.seat'].create({
            'trial_org_id': cls.trial_org.id,
            'email': "first@acme.example.com",
            'state': 'accepted',
        })

    def test_accepted_seat_can_invite_same_domain_teammate(self):
        seat = self.first_seat.action_invite("teammate@acme.example.com")
        self.assertEqual(seat.state, 'invited')
        self.assertEqual(seat.invited_by_id, self.first_seat)
        self.assertEqual(seat.trial_org_id, self.trial_org)

    def test_invite_to_cross_domain_email_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.first_seat.action_invite("teammate@other.example.com")

    def test_invite_beyond_seat_cap_is_rejected(self):
        # seat_cap=3: first_seat already uses one, two more invites reach the cap exactly...
        self.first_seat.action_invite("second@acme.example.com")
        self.first_seat.action_invite("third@acme.example.com")
        # ...and a fourth must be rejected.
        with self.assertRaises(ValidationError):
            self.first_seat.action_invite("fourth@acme.example.com")

    def test_invite_at_cap_exactly_succeeds(self):
        self.first_seat.action_invite("second@acme.example.com")
        seat = self.first_seat.action_invite("third@acme.example.com")
        self.assertEqual(seat.state, 'invited')

    def test_invited_seat_cannot_invite(self):
        invited_seat = self.first_seat.action_invite("teammate@acme.example.com")
        with self.assertRaises(AccessError):
            invited_seat.action_invite("another@acme.example.com")

    def test_invite_with_malformed_email_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.first_seat.action_invite("not-an-email")

    def test_invited_seat_can_invite_after_accepting(self):
        invited_seat = self.first_seat.action_invite("teammate@acme.example.com")
        invited_seat.action_accept()
        seat = invited_seat.action_invite("another@acme.example.com")
        self.assertEqual(seat.invited_by_id, invited_seat)
