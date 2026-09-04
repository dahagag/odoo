import json
from unittest.mock import MagicMock

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.provisioner import AwsProvisioner

STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:trial-org-lifecycle'


class FakeExecutionAlreadyExists(Exception):
    """Stands in for botocore's dynamically-generated
    client.exceptions.ExecutionAlreadyExists - a real Exception subclass, since Python's
    ``except`` machinery needs an actual class, not a Mock."""


def _make_fake_client():
    client = MagicMock()
    client.exceptions.ExecutionAlreadyExists = FakeExecutionAlreadyExists
    client.start_execution.return_value = {'executionArn': 'unused - AwsProvisioner derives its own'}
    return client


@tagged('post_install', '-at_install')
class TestAwsProvisioner(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })

    def _make_provisioner(self, client=None, **kwargs):
        return AwsProvisioner(
            state_machine_arn=STATE_MACHINE_ARN,
            client=client or _make_fake_client(),
            **kwargs,
        )

    def test_issue_starts_execution_with_expected_input_and_name(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, base_ami_id='ami-0abc123',
                                              tofu_module_git_sha='deadbeef')

        provisioner.issue(self.trial_org, 'job-1')

        client.start_execution.assert_called_once()
        call_kwargs = client.start_execution.call_args.kwargs
        self.assertEqual(call_kwargs['stateMachineArn'], STATE_MACHINE_ARN)
        self.assertEqual(call_kwargs['name'], f"trial-{self.trial_org.id}-job-1")
        execution_input = json.loads(call_kwargs['input'])
        self.assertEqual(execution_input, {
            'trial_org_id': str(self.trial_org.id),
            'job_id': 'job-1',
            'action': 'issue',
            'state_key': f"trial-orgs/{self.trial_org.id}/terraform.tfstate",
            'ami_id': 'ami-0abc123',
            'module_git_sha': 'deadbeef',
        })

    def test_issue_records_ami_and_git_sha_on_the_record(self):
        provisioner = self._make_provisioner(base_ami_id='ami-0abc123', tofu_module_git_sha='deadbeef')

        provisioner.issue(self.trial_org, 'job-1')

        self.assertEqual(self.trial_org.ami_id, 'ami-0abc123')
        self.assertEqual(self.trial_org.tofu_module_git_sha, 'deadbeef')

    def test_issue_records_execution_arn(self):
        provisioner = self._make_provisioner()

        provisioner.issue(self.trial_org, 'job-1')

        self.assertEqual(
            self.trial_org.last_execution_arn,
            f"arn:aws:states:us-east-1:123456789012:execution:trial-org-lifecycle:trial-{self.trial_org.id}-job-1")

    def test_suspend_and_wake_omit_module_version_fields(self):
        self.trial_org.write({'instance_id': 'i-0123456789abcdef0'})
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, base_ami_id='ami-0abc123',
                                              tofu_module_git_sha='deadbeef')

        provisioner.suspend(self.trial_org, 'job-2')

        execution_input = json.loads(client.start_execution.call_args.kwargs['input'])
        self.assertEqual(execution_input['action'], 'suspend')
        self.assertEqual(execution_input['instance_id'], 'i-0123456789abcdef0')
        self.assertNotIn('ami_id', execution_input)
        self.assertNotIn('module_git_sha', execution_input)

    def test_suspend_without_an_instance_id_raises_a_clear_error_instead_of_calling_aws(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)

        with self.assertRaises(UserError):
            provisioner.suspend(self.trial_org, 'job-2')
        client.start_execution.assert_not_called()

    def test_wake_without_an_instance_id_raises_a_clear_error_instead_of_calling_aws(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)

        with self.assertRaises(UserError):
            provisioner.wake(self.trial_org, 'job-2')
        client.start_execution.assert_not_called()

    def test_start_execution_already_exists_is_treated_as_a_successful_retry(self):
        client = _make_fake_client()
        client.start_execution.side_effect = FakeExecutionAlreadyExists()
        provisioner = self._make_provisioner(client=client)

        # Must not raise - a retry of the same job id/execution name is AWS's own idempotent
        # dedup working as intended (docs/adr/0019), not a failure.
        provisioner.issue(self.trial_org, 'job-1')

        self.assertTrue(self.trial_org.last_execution_arn)

    def test_start_execution_other_failure_raises_a_clear_user_error(self):
        client = _make_fake_client()
        client.start_execution.side_effect = RuntimeError("boom")
        provisioner = self._make_provisioner(client=client)

        with self.assertRaises(UserError):
            provisioner.issue(self.trial_org, 'job-1')

    def test_check_status_ignores_records_with_no_running_job(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)

        provisioner.check_status(self.trial_org)

        client.describe_execution.assert_not_called()

    def test_check_status_surfaces_succeeded(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)
        provisioner.issue(self.trial_org, 'job-1')
        self.trial_org.write({'last_job_status': 'running'})
        client.describe_execution.return_value = {'status': 'SUCCEEDED'}

        provisioner.check_status(self.trial_org)

        client.describe_execution.assert_called_once_with(
            executionArn=self.trial_org.last_execution_arn)
        self.assertEqual(self.trial_org.last_job_status, 'succeeded')
        self.assertFalse(self.trial_org.last_job_error)

    def test_check_status_surfaces_failed_with_a_clear_error(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)
        provisioner.issue(self.trial_org, 'job-1')
        self.trial_org.write({'last_job_status': 'running'})
        client.describe_execution.return_value = {
            'status': 'FAILED',
            'error': 'TrialOrgLifecycleActionFailed',
            'cause': "the lock has been released",
        }

        provisioner.check_status(self.trial_org)

        self.assertEqual(self.trial_org.last_job_status, 'failed')
        self.assertIn('TrialOrgLifecycleActionFailed', self.trial_org.last_job_error)
        self.assertIn('the lock has been released', self.trial_org.last_job_error)

    def test_check_status_leaves_running_executions_alone(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)
        provisioner.issue(self.trial_org, 'job-1')
        self.trial_org.write({'last_job_status': 'running'})
        client.describe_execution.return_value = {'status': 'RUNNING'}

        provisioner.check_status(self.trial_org)

        self.assertEqual(self.trial_org.last_job_status, 'running')
