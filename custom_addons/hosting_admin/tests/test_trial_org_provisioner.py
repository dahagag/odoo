from datetime import timedelta

from odoo import fields
from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.provisioner import (
    AwsProvisioner,
    Provisioner,
    StubProvisioner,
)
from odoo.addons.hosting_admin.models.trial_org import (
    CONFIG_PARAM_STATE_MACHINE_ARN,
    JOB_ID_RETRY_WINDOW,
)


class RecordingProvisioner(Provisioner):
    """Test double that records every call it receives instead of doing nothing (like
    StubProvisioner) or talking to AWS (like the real implementation a later ticket adds)."""

    def __init__(self):
        self.calls = []

    def issue(self, trial_org, job_id):
        self.calls.append(('issue', trial_org.id, job_id))

    def suspend(self, trial_org, job_id):
        self.calls.append(('suspend', trial_org.id, job_id))

    def wake(self, trial_org, job_id):
        self.calls.append(('wake', trial_org.id, job_id))

    def destroy(self, trial_org, job_id):
        self.calls.append(('destroy', trial_org.id, job_id))


@tagged('post_install', '-at_install')
class TestTrialOrgProvisioner(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })

    def test_default_provisioner_is_the_stub(self):
        self.assertIsInstance(self.trial_org._get_provisioner(), StubProvisioner)

    def test_stub_provisioner_makes_every_transition_a_no_op_call(self):
        # No assertion beyond "doesn't raise / doesn't reach out anywhere" - this is the whole
        # point of the stub: real AWS/OpenTofu calls only exist once a later ticket swaps it in.
        self.trial_org.action_issue()
        self.trial_org.action_suspend()
        self.trial_org.action_wake()
        self.trial_org.action_destroy()
        self.assertEqual(self.trial_org.state, 'destroyed')

    def _inject_provisioner(self, provisioner):
        # hosting.trial.org uses ORM __slots__, so an instance can't take an ad hoc attribute;
        # patch the model class's _get_provisioner instead, via the base TransactionCase helper
        # that also schedules the patch's cleanup.
        self.patch(type(self.env['hosting.trial.org']), '_get_provisioner', lambda self: provisioner)

    def test_transition_calls_provisioner_with_record_and_job_id(self):
        provisioner = RecordingProvisioner()
        self._inject_provisioner(provisioner)

        self.trial_org.action_issue()

        self.assertEqual(len(provisioner.calls), 1)
        method, trial_org_id, job_id = provisioner.calls[0]
        self.assertEqual(method, 'issue')
        self.assertEqual(trial_org_id, self.trial_org.id)
        self.assertTrue(job_id)
        self.assertEqual(self.trial_org.last_job_id, job_id)

    def test_each_transition_generates_a_distinct_job_id(self):
        provisioner = RecordingProvisioner()
        self._inject_provisioner(provisioner)

        self.trial_org.action_issue()
        self.trial_org.action_suspend()

        job_ids = [call[2] for call in provisioner.calls]
        self.assertEqual(len(job_ids), len(set(job_ids)), "each lifecycle action must get its own job id")

    def test_provisioner_is_called_once_per_record_in_a_batch(self):
        other = self.env['hosting.trial.org'].create({
            'name': "Other Trial",
            'prospect_domain': "other.example.com",
            'seat_cap': 5,
        })
        provisioner = RecordingProvisioner()
        self._inject_provisioner(provisioner)
        batch = (self.trial_org | other)

        batch.action_issue()

        called_ids = sorted(call[1] for call in provisioner.calls)
        self.assertEqual(called_ids, sorted(batch.ids))

    def test_provisioner_failure_prevents_state_change(self):
        failure_message = "simulated provisioner failure"

        class FailingProvisioner(Provisioner):
            def issue(self, trial_org, job_id):
                raise RuntimeError(failure_message)

            def suspend(self, trial_org, job_id):
                raise RuntimeError(failure_message)

            def wake(self, trial_org, job_id):
                raise RuntimeError(failure_message)

            def destroy(self, trial_org, job_id):
                raise RuntimeError(failure_message)

        self._inject_provisioner(FailingProvisioner())

        with self.assertRaises(RuntimeError):
            self.trial_org.action_issue()
        self.assertEqual(self.trial_org.state, 'issued')

    def test_provisioner_failure_on_one_record_rolls_back_the_whole_batch(self):
        # A batch call is applied inside one savepoint: if the Provisioner fails partway
        # through, even a record it already succeeded on must not keep its new state.
        other = self.env['hosting.trial.org'].create({
            'name': "Other Trial",
            'prospect_domain': "other.example.com",
            'seat_cap': 5,
        })
        failure_message = "simulated provisioner failure on the second record"

        class FailsOnSecondCallProvisioner(Provisioner):
            def __init__(self):
                self.issue_calls = 0

            def issue(self, trial_org, job_id):
                self.issue_calls += 1
                if self.issue_calls == 2:
                    raise RuntimeError(failure_message)

            def suspend(self, trial_org, job_id):
                pass

            def wake(self, trial_org, job_id):
                pass

            def destroy(self, trial_org, job_id):
                pass

        self._inject_provisioner(FailsOnSecondCallProvisioner())
        batch = self.trial_org | other

        with self.assertRaises(RuntimeError):
            batch.action_issue()

        self.assertEqual(self.trial_org.state, 'issued', "the first record's write must be rolled back too")
        self.assertEqual(other.state, 'issued')

    def test_default_provisioner_falls_back_to_stub_when_unconfigured(self):
        self.env['ir.config_parameter'].sudo().set_param(CONFIG_PARAM_STATE_MACHINE_ARN, '')
        self.assertIsInstance(self.trial_org._get_provisioner(), StubProvisioner)

    def test_provisioner_is_aws_backed_once_state_machine_arn_is_configured(self):
        self.env['ir.config_parameter'].sudo().set_param(
            CONFIG_PARAM_STATE_MACHINE_ARN, 'arn:aws:states:us-east-1:123456789012:stateMachine:x')
        self.assertIsInstance(self.trial_org._get_provisioner(), AwsProvisioner)

    def test_reissuing_within_the_retry_window_reuses_the_job_id(self):
        # _get_or_create_job_id() is exercised directly here rather than through two real
        # action_issue() calls, since a second action_issue() while still 'active' is rejected
        # by source-state validation - see _apply_transition()'s docstring on why the reuse
        # path is only reachable across separate transaction boundaries (docs/adr/0019).
        first_job_id, first_started_at = self.trial_org._get_or_create_job_id('issue')
        self.trial_org.with_context(hosting_trial_org_allow_state_write=True).write({
            'last_job_id': first_job_id,
            'last_job_action': 'issue',
            'last_job_started_at': first_started_at,
            'last_job_status': 'running',
        })

        reused_job_id, reused_started_at = self.trial_org._get_or_create_job_id('issue')

        self.assertEqual(reused_job_id, first_job_id)
        self.assertEqual(reused_started_at, first_started_at)

    def test_a_different_action_never_reuses_the_job_id(self):
        job_id, started_at = self.trial_org._get_or_create_job_id('issue')
        self.trial_org.with_context(hosting_trial_org_allow_state_write=True).write({
            'last_job_id': job_id,
            'last_job_action': 'issue',
            'last_job_started_at': started_at,
            'last_job_status': 'running',
        })

        other_job_id, _started_at = self.trial_org._get_or_create_job_id('destroy')

        self.assertNotEqual(other_job_id, job_id)

    def test_a_finished_job_is_never_reused(self):
        job_id, started_at = self.trial_org._get_or_create_job_id('issue')
        self.trial_org.with_context(hosting_trial_org_allow_state_write=True).write({
            'last_job_id': job_id,
            'last_job_action': 'issue',
            'last_job_started_at': started_at,
            'last_job_status': 'succeeded',
        })

        fresh_job_id, _started_at = self.trial_org._get_or_create_job_id('issue')

        self.assertNotEqual(fresh_job_id, job_id)

    def test_a_job_past_the_retry_window_is_never_reused(self):
        stale_start = fields.Datetime.now() - JOB_ID_RETRY_WINDOW - timedelta(minutes=1)
        self.trial_org.with_context(hosting_trial_org_allow_state_write=True).write({
            'last_job_id': 'stale-job',
            'last_job_action': 'issue',
            'last_job_started_at': stale_start,
            'last_job_status': 'running',
        })

        fresh_job_id, fresh_started_at = self.trial_org._get_or_create_job_id('issue')

        self.assertNotEqual(fresh_job_id, 'stale-job')
        self.assertNotEqual(fresh_started_at, stale_start)

    def test_cron_poll_pending_jobs_calls_check_status_on_running_jobs_only(self):
        calls = []

        class RecordingCheckStatusProvisioner(RecordingProvisioner):
            def check_status(self, trial_org):
                calls.append(trial_org.id)

        provisioner = RecordingCheckStatusProvisioner()
        self._inject_provisioner(provisioner)
        self.trial_org.action_issue()
        other = self.env['hosting.trial.org'].create({
            'name': "Other Trial",
            'prospect_domain': "other.example.com",
            'seat_cap': 5,
        })  # left 'issued' - never gets a running job, so never polled

        self.env['hosting.trial.org']._cron_poll_pending_jobs()

        self.assertEqual(calls, [self.trial_org.id])
        self.assertNotIn(other.id, calls)
