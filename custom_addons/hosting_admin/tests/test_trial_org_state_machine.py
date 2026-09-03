from odoo.exceptions import ValidationError
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
