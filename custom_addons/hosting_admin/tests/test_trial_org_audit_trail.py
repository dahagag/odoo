from datetime import datetime, timezone
from unittest.mock import MagicMock

from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.provisioner import (
    AwsProvisioner,
    Provisioner,
    StubProvisioner,
)

STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:trial-org-lifecycle'
EXECUTION_ARN = 'arn:aws:states:us-east-1:123456789012:execution:trial-org-lifecycle:trial-1-job-1'


class RecordingProvisioner(Provisioner):
    """Minimal Provisioner test double that only implements the four abstract lifecycle
    methods, to prove get_audit_trail()'s concrete no-op default (docs/adr/0022) is inherited
    rather than required from every implementation."""

    def issue(self, trial_org, job_id):
        pass

    def suspend(self, trial_org, job_id):
        pass

    def wake(self, trial_org, job_id):
        pass

    def destroy(self, trial_org, job_id):
        pass


@tagged('post_install', '-at_install')
class TestProvisionerAuditTrailDefault(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })

    def test_stub_provisioner_has_no_audit_trail(self):
        self.assertEqual(
            StubProvisioner().get_audit_trail(self.trial_org), {'available': False})

    def test_provisioner_default_has_no_audit_trail(self):
        self.assertEqual(
            RecordingProvisioner().get_audit_trail(self.trial_org), {'available': False})


@tagged('post_install', '-at_install')
class TestAwsProvisionerAuditTrail(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })
        cls.trial_org.write({
            'last_job_action': 'issue',
            'last_job_id': 'job-1',
            'last_execution_arn': EXECUTION_ARN,
        })

    def _make_provisioner(self, client):
        return AwsProvisioner(state_machine_arn=STATE_MACHINE_ARN, client=client)

    def test_no_recorded_execution_is_unavailable_without_calling_aws(self):
        never_issued = self.env['hosting.trial.org'].create({
            'name': "Never Issued",
            'prospect_domain': "never.example.com",
            'seat_cap': 5,
        })
        client = MagicMock()
        provisioner = self._make_provisioner(client)

        trail = provisioner.get_audit_trail(never_issued)

        self.assertEqual(trail, {'available': False})
        client.describe_execution.assert_not_called()

    def test_describe_execution_failure_degrades_to_unavailable(self):
        client = MagicMock()
        client.describe_execution.side_effect = RuntimeError("boom")
        provisioner = self._make_provisioner(client)

        trail = provisioner.get_audit_trail(self.trial_org)

        self.assertEqual(trail, {'available': False})

    def test_renders_status_timing_and_steps_from_fixture_responses(self):
        client = MagicMock()
        client.describe_execution.return_value = {
            'status': 'SUCCEEDED',
            'startDate': datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc),
            'stopDate': datetime(2026, 1, 1, 10, 2, 30, tzinfo=timezone.utc),
        }
        client.get_execution_history.return_value = {'events': [
            {
                'timestamp': datetime(2026, 1, 1, 10, 0, 1, tzinfo=timezone.utc),
                'type': 'TaskStateEntered',
                'stateEnteredEventDetails': {'name': 'AcquireLock'},
            },
            {
                'timestamp': datetime(2026, 1, 1, 10, 0, 5, tzinfo=timezone.utc),
                'type': 'TaskStateEntered',
                'stateEnteredEventDetails': {'name': 'RunTofu'},
            },
            {
                'timestamp': datetime(2026, 1, 1, 10, 2, 30, tzinfo=timezone.utc),
                'type': 'ExecutionSucceeded',
                'executionSucceededEventDetails': {'output': '{}'},
            },
        ]}
        provisioner = self._make_provisioner(client)

        trail = provisioner.get_audit_trail(self.trial_org)

        client.describe_execution.assert_called_once_with(executionArn=EXECUTION_ARN)
        client.get_execution_history.assert_called_once_with(
            executionArn=EXECUTION_ARN, reverseOrder=False)
        self.assertTrue(trail['available'])
        self.assertEqual(trail['action'], 'issue')
        self.assertEqual(trail['job_id'], 'job-1')
        self.assertEqual(trail['status'], 'SUCCEEDED')
        self.assertTrue(trail['steps_available'])
        self.assertEqual(len(trail['steps']), 3)
        self.assertEqual(trail['steps'][0]['name'], 'AcquireLock')
        self.assertEqual(trail['steps'][1]['name'], 'RunTofu')
        self.assertIsNone(trail['steps'][2]['name'])

    def test_failed_execution_step_carries_error_and_cause(self):
        client = MagicMock()
        client.describe_execution.return_value = {'status': 'FAILED'}
        client.get_execution_history.return_value = {'events': [
            {
                'timestamp': datetime(2026, 1, 1, 10, 0, 5, tzinfo=timezone.utc),
                'type': 'ExecutionFailed',
                'executionFailedEventDetails': {
                    'error': 'TrialOrgLifecycleActionFailed',
                    'cause': "the lock has been released",
                },
            },
        ]}
        provisioner = self._make_provisioner(client)

        trail = provisioner.get_audit_trail(self.trial_org)

        self.assertEqual(trail['status'], 'FAILED')
        self.assertEqual(trail['steps'][0]['error'], 'TrialOrgLifecycleActionFailed')
        self.assertEqual(trail['steps'][0]['cause'], "the lock has been released")

    def test_history_retention_gap_keeps_status_but_marks_steps_unavailable(self):
        # The overall execution is still describable (it exists) but its step-by-step history
        # has aged out of Step Functions' own retention window - degrade only the steps, not
        # the whole trail, per the ticket's own requirement.
        client = MagicMock()
        client.describe_execution.return_value = {'status': 'SUCCEEDED'}
        client.get_execution_history.side_effect = RuntimeError("HistoryEventsNotFoundOrExpired")
        provisioner = self._make_provisioner(client)

        trail = provisioner.get_audit_trail(self.trial_org)

        self.assertTrue(trail['available'])
        self.assertEqual(trail['status'], 'SUCCEEDED')
        self.assertFalse(trail['steps_available'])
        self.assertEqual(trail['steps'], [])


@tagged('post_install', '-at_install')
class TestTrialOrgAuditTrailFields(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })

    def _inject_provisioner(self, provisioner):
        self.patch(type(self.env['hosting.trial.org']), '_get_provisioner', lambda self: provisioner)

    def test_stub_backed_record_has_no_audit_trail(self):
        self.assertFalse(self.trial_org.audit_trail_available)
        self.assertFalse(self.trial_org.audit_trail_status)
        self.assertFalse(self.trial_org.audit_trail_steps_available)
        self.assertFalse(self.trial_org.audit_trail_steps)

    def test_available_trail_populates_every_field(self):
        class FakeAwsProvisioner(Provisioner):
            def issue(self, trial_org, job_id):
                pass

            def suspend(self, trial_org, job_id):
                pass

            def wake(self, trial_org, job_id):
                pass

            def destroy(self, trial_org, job_id):
                pass

            def get_audit_trail(self, trial_org):
                return {
                    'available': True,
                    'action': 'issue',
                    'job_id': 'job-1',
                    'status': 'SUCCEEDED',
                    'start_date': datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc),
                    'stop_date': datetime(2026, 1, 1, 10, 2, 30, tzinfo=timezone.utc),
                    'steps_available': True,
                    'steps': [
                        {'timestamp': datetime(2026, 1, 1, 10, 0, 1, tzinfo=timezone.utc),
                         'type': 'TaskStateEntered', 'name': 'AcquireLock',
                         'error': None, 'cause': None},
                        {'timestamp': datetime(2026, 1, 1, 10, 0, 5, tzinfo=timezone.utc),
                         'type': 'TaskStateEntered', 'name': 'RunTofu',
                         'error': None, 'cause': None},
                    ],
                }

        self._inject_provisioner(FakeAwsProvisioner())
        self.trial_org.invalidate_recordset()

        self.assertTrue(self.trial_org.audit_trail_available)
        self.assertEqual(self.trial_org.audit_trail_action, 'issue')
        self.assertEqual(self.trial_org.audit_trail_status, 'SUCCEEDED')
        self.assertEqual(
            self.trial_org.audit_trail_started_at, datetime(2026, 1, 1, 10, 0, 0))
        self.assertEqual(
            self.trial_org.audit_trail_stopped_at, datetime(2026, 1, 1, 10, 2, 30))
        self.assertTrue(self.trial_org.audit_trail_steps_available)
        self.assertIn('AcquireLock', self.trial_org.audit_trail_steps)
        self.assertIn('RunTofu', self.trial_org.audit_trail_steps)

    def test_failed_step_is_rendered_with_error_and_cause(self):
        class FakeAwsProvisioner(RecordingProvisioner):
            def get_audit_trail(self, trial_org):
                return {
                    'available': True,
                    'action': 'destroy',
                    'job_id': 'job-2',
                    'status': 'FAILED',
                    'start_date': None,
                    'stop_date': None,
                    'steps_available': True,
                    'steps': [{
                        'timestamp': datetime(2026, 1, 1, 10, 0, 5, tzinfo=timezone.utc),
                        'type': 'ExecutionFailed', 'name': None,
                        'error': 'TrialOrgLifecycleActionFailed',
                        'cause': "the lock has been released",
                    }],
                }

        self._inject_provisioner(FakeAwsProvisioner())
        self.trial_org.invalidate_recordset()

        self.assertIn('TrialOrgLifecycleActionFailed', self.trial_org.audit_trail_steps)
        self.assertIn("the lock has been released", self.trial_org.audit_trail_steps)

    def test_steps_unavailable_leaves_steps_text_blank(self):
        class FakeAwsProvisioner(RecordingProvisioner):
            def get_audit_trail(self, trial_org):
                return {
                    'available': True,
                    'action': 'issue',
                    'job_id': 'job-1',
                    'status': 'SUCCEEDED',
                    'start_date': None,
                    'stop_date': None,
                    'steps_available': False,
                    'steps': [],
                }

        self._inject_provisioner(FakeAwsProvisioner())
        self.trial_org.invalidate_recordset()

        self.assertTrue(self.trial_org.audit_trail_available)
        self.assertFalse(self.trial_org.audit_trail_steps_available)
        self.assertFalse(self.trial_org.audit_trail_steps)
