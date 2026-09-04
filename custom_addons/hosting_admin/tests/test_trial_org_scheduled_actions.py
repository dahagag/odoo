from datetime import timedelta

from odoo import fields
from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.trial_org import (
    IDLE_TIMEOUT_MINUTES,
    SNAPSHOT_RETENTION_DAYS,
)


@tagged('post_install', '-at_install')
class TestTrialOrgScheduledActions(TransactionCase):

    def _create(self, **extra):
        values = {
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        }
        values.update(extra)
        return self.env['hosting.trial.org'].create(values)

    def test_issue_seeds_last_activity_at(self):
        trial_org = self._create()
        trial_org.action_issue()
        self.assertTrue(trial_org.last_activity_at)

    def test_cron_suspend_idle_leaves_recently_active_org_alone(self):
        trial_org = self._create()
        trial_org.action_issue()
        self.env['hosting.trial.org']._cron_suspend_idle()
        self.assertEqual(trial_org.state, 'active')

    def test_cron_suspend_idle_suspends_after_timeout(self):
        trial_org = self._create()
        trial_org.action_issue()
        # Simulate elapsed time: push the recorded activity into the past rather than waiting.
        stale = fields.Datetime.now() - timedelta(minutes=IDLE_TIMEOUT_MINUTES + 1)
        trial_org.with_context(hosting_trial_org_allow_state_write=True).write(
            {'last_activity_at': stale})

        self.env['hosting.trial.org']._cron_suspend_idle()

        self.assertEqual(trial_org.state, 'suspended')

    def test_cron_suspend_idle_ignores_non_active_orgs(self):
        trial_org = self._create()
        # still 'issued' - never activated, so it has no last_activity_at at all.
        self.env['hosting.trial.org']._cron_suspend_idle()
        self.assertEqual(trial_org.state, 'issued')

    def test_wake_only_via_explicit_action(self):
        trial_org = self._create()
        trial_org.action_issue()
        stale = fields.Datetime.now() - timedelta(minutes=IDLE_TIMEOUT_MINUTES + 1)
        trial_org.with_context(hosting_trial_org_allow_state_write=True).write(
            {'last_activity_at': stale})
        self.env['hosting.trial.org']._cron_suspend_idle()
        self.assertEqual(trial_org.state, 'suspended')

        # Nothing but the explicit Wake action moves it back to active - the suspend cron
        # sweeping again must not wake it, and it must stay suspended until action_wake().
        self.env['hosting.trial.org']._cron_suspend_idle()
        self.assertEqual(trial_org.state, 'suspended')

        trial_org.action_wake()
        self.assertEqual(trial_org.state, 'active')

    def test_cron_auto_destroy_expired_leaves_unexpired_org_alone(self):
        trial_org = self._create(expiry_date=fields.Date.today() + timedelta(days=1))
        trial_org.action_issue()
        self.env['hosting.trial.org']._cron_auto_destroy_expired()
        self.assertEqual(trial_org.state, 'active')

    def test_cron_auto_destroy_expired_destroys_active_org_past_expiry(self):
        trial_org = self._create(expiry_date=fields.Date.today() + timedelta(days=1))
        trial_org.action_issue()
        # Simulate elapsed time: push the expiry date into the past rather than waiting.
        trial_org.expiry_date = fields.Date.today() - timedelta(days=1)

        self.env['hosting.trial.org']._cron_auto_destroy_expired()

        self.assertEqual(trial_org.state, 'destroyed')

    def test_cron_auto_destroy_expired_destroys_suspended_org_past_expiry(self):
        trial_org = self._create(expiry_date=fields.Date.today() + timedelta(days=1))
        trial_org.action_issue()
        trial_org.action_suspend()
        trial_org.expiry_date = fields.Date.today() - timedelta(days=1)

        self.env['hosting.trial.org']._cron_auto_destroy_expired()

        self.assertEqual(trial_org.state, 'destroyed')

    def test_auto_destroy_records_snapshot_retention_marker(self):
        trial_org = self._create(expiry_date=fields.Date.today())
        trial_org.action_issue()

        self.env['hosting.trial.org']._cron_auto_destroy_expired()

        self.assertEqual(trial_org.state, 'destroyed')
        self.assertEqual(
            trial_org.snapshot_retention_until,
            fields.Date.today() + timedelta(days=SNAPSHOT_RETENTION_DAYS))

    def test_manual_destroy_also_records_snapshot_retention_marker(self):
        # Auto-Destroy's snapshot marker is unconditional, whether it was triggered by the
        # expiry sweep or by a manual teardown that never goes through the cron at all.
        trial_org = self._create()
        trial_org.action_issue()

        trial_org.action_destroy()

        self.assertEqual(
            trial_org.snapshot_retention_until,
            fields.Date.today() + timedelta(days=SNAPSHOT_RETENTION_DAYS))

    def test_cron_auto_destroy_expired_ignores_issued_org(self):
        # An 'issued' Trial Org was never provisioned - the expiry sweep must not try to
        # destroy it even if a (meaningless in that state) expiry_date has passed.
        trial_org = self._create(expiry_date=fields.Date.today() - timedelta(days=1))
        self.env['hosting.trial.org']._cron_auto_destroy_expired()
        self.assertEqual(trial_org.state, 'issued')
