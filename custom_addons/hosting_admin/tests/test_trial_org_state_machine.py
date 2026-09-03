from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestTrialOrgStateMachine(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })

    def test_new_trial_org_starts_issued(self):
        self.assertEqual(self.trial_org.state, 'issued')

    def test_issue_moves_issued_to_active(self):
        self.trial_org.action_issue()
        self.assertEqual(self.trial_org.state, 'active')

    def test_full_lifecycle_issued_active_suspended_active_destroyed(self):
        self.trial_org.action_issue()
        self.assertEqual(self.trial_org.state, 'active')

        self.trial_org.action_suspend()
        self.assertEqual(self.trial_org.state, 'suspended')

        self.trial_org.action_wake()
        self.assertEqual(self.trial_org.state, 'active')

        self.trial_org.action_destroy()
        self.assertEqual(self.trial_org.state, 'destroyed')

    def test_suspend_from_active(self):
        self.trial_org.action_issue()
        self.trial_org.action_suspend()
        self.assertEqual(self.trial_org.state, 'suspended')

    def test_destroy_from_suspended(self):
        self.trial_org.action_issue()
        self.trial_org.action_suspend()
        self.trial_org.action_destroy()
        self.assertEqual(self.trial_org.state, 'destroyed')

    def test_issue_from_active_is_rejected(self):
        self.trial_org.action_issue()
        with self.assertRaises(ValidationError):
            self.trial_org.action_issue()

    def test_suspend_from_issued_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.trial_org.action_suspend()

    def test_wake_from_issued_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.trial_org.action_wake()

    def test_wake_from_active_is_rejected(self):
        self.trial_org.action_issue()
        with self.assertRaises(ValidationError):
            self.trial_org.action_wake()

    def test_destroy_from_issued_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.trial_org.action_destroy()

    def test_any_action_from_destroyed_is_rejected(self):
        self.trial_org.action_issue()
        self.trial_org.action_destroy()
        with self.assertRaises(ValidationError):
            self.trial_org.action_issue()
        with self.assertRaises(ValidationError):
            self.trial_org.action_suspend()
        with self.assertRaises(ValidationError):
            self.trial_org.action_wake()
        with self.assertRaises(ValidationError):
            self.trial_org.action_destroy()

    def test_rejected_transition_leaves_state_unchanged(self):
        with self.assertRaises(ValidationError):
            self.trial_org.action_suspend()
        self.assertEqual(self.trial_org.state, 'issued')

    def test_direct_write_of_state_is_rejected(self):
        # readonly=True on the state field only hides it in form views - it does not stop a
        # direct ORM/RPC write() from a caller with model access. That must be rejected
        # regardless, so _apply_transition() stays the only path that can ever change state.
        with self.assertRaises(AccessError):
            self.trial_org.write({'state': 'active'})
        self.assertEqual(self.trial_org.state, 'issued')

    def test_direct_create_with_state_is_rejected(self):
        with self.assertRaises(AccessError):
            self.env['hosting.trial.org'].create({
                'name': "Sneaky Trial",
                'prospect_domain': "sneaky.example.com",
                'seat_cap': 5,
                'state': 'active',
            })

    def test_apply_transition_can_still_write_state(self):
        # The legitimate path - action_issue() calling _apply_transition() - must keep working
        # even though direct writes of 'state' are now rejected.
        self.trial_org.action_issue()
        self.assertEqual(self.trial_org.state, 'active')

    def test_batch_transition_is_all_or_nothing(self):
        # One org already active, one still issued: neither should transition when the batch
        # as a whole contains an invalid move for the second record.
        other = self.env['hosting.trial.org'].create({
            'name': "Other Trial",
            'prospect_domain': "other.example.com",
            'seat_cap': 5,
        })
        self.trial_org.action_issue()
        batch = self.trial_org | other
        with self.assertRaises(ValidationError):
            batch.action_issue()
        self.assertEqual(self.trial_org.state, 'active')
        self.assertEqual(other.state, 'issued')
