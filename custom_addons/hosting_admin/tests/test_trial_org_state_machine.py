from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged


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
        # An ordinary member of the group that grants write access to hosting.trial.org -
        # not the superuser cls.env runs as by default. self.env.su is unconditionally True
        # for a superuser env (odoo/orm/environments.py), which would make the guard tests
        # below pass without actually exercising the guard a real caller hits.
        cls.administrator = new_test_user(
            cls.env, login='hosting_admin_user',
            groups='hosting_admin.group_hosting_admin_administrator')

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
        # Exercised as an ordinary administrator, not the superuser cls.env defaults to -
        # self.env.su is unconditionally True for a superuser env, which would let this write
        # through without actually testing the guard.
        with self.assertRaises(AccessError):
            self.trial_org.with_user(self.administrator).write({'state': 'active'})
        self.assertEqual(self.trial_org.state, 'issued')

    def test_direct_create_with_state_is_rejected(self):
        with self.assertRaises(AccessError):
            self.env['hosting.trial.org'].with_user(self.administrator).create({
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

    def test_state_write_guard_cannot_be_forged_via_context(self):
        # Regression test for #135: an earlier version of this guard checked a context flag
        # (self.env.context.get('hosting_trial_org_allow_state_write')) rather than self.env.su.
        # context is a plain caller-supplied dict on every ORM/RPC call - with_context() is
        # ordinary public API, and RPC's execute_kw takes a context kwarg straight from the
        # client - so any caller with ordinary write access to hosting.trial.org could forge
        # that exact key and defeat the guard entirely, bypassing _apply_transition()'s
        # source-state validation and Provisioner call. Only self.env.su (settable only by an
        # internal .sudo() call, never by RPC-supplied context) is a genuine server-only signal
        # - exercised as an ordinary administrator, since a superuser env's self.env.su is
        # already unconditionally True regardless of context, which would make this pass
        # without proving anything about the forgery.
        forged_context = {'hosting_trial_org_allow_state_write': True}
        with self.assertRaises(AccessError):
            self.trial_org.with_user(self.administrator).with_context(**forged_context).write(
                {'state': 'active'})
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
