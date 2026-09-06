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


FAKE_RESPONSE_EXECUTION_ARN = (
    'arn:aws:states:us-east-1:123456789012:execution:trial-org-lifecycle:from-response')


def _make_fake_client():
    client = MagicMock()
    client.exceptions.ExecutionAlreadyExists = FakeExecutionAlreadyExists
    client.start_execution.return_value = {'executionArn': FAKE_RESPONSE_EXECUTION_ARN}
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
        # issue() requires both configured (see the dedicated tests below for what happens when
        # one is missing) - default them here so tests that only care about other behavior don't
        # each have to supply throwaway values. Pass base_ami_id=None/tofu_module_git_sha=None
        # explicitly to override.
        kwargs.setdefault('base_ami_id', 'ami-0abc123')
        kwargs.setdefault('tofu_module_git_sha', 'deadbeef')
        kwargs.setdefault('dns_domain_suffix', 'dev.method.factory1.io')
        return AwsProvisioner(
            state_machine_arn=STATE_MACHINE_ARN,
            client=client or _make_fake_client(),
            **kwargs,
        )

    def test_issue_starts_execution_with_expected_input_and_name(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, base_ami_id='ami-0abc123',
                                              tofu_module_git_sha='deadbeef',
                                              dns_domain_suffix='dev.method.factory1.io')

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
            'dns_record_name': f"{self.trial_org.dns_subdomain_label}.dev.method.factory1.io",
        })

    def test_issue_without_dns_domain_suffix_raises_a_clear_error_instead_of_calling_aws(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, dns_domain_suffix=None)

        with self.assertRaises(UserError):
            provisioner.issue(self.trial_org, 'job-1')
        client.start_execution.assert_not_called()

    def test_destroy_includes_the_dns_record_name(self):
        self.trial_org.write({'ami_id': 'ami-deployed', 'tofu_module_git_sha': 'deployedsha'})
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, dns_domain_suffix='dev.method.factory1.io')

        provisioner.destroy(self.trial_org, 'job-3')

        execution_input = json.loads(client.start_execution.call_args.kwargs['input'])
        self.assertEqual(
            execution_input['dns_record_name'],
            f"{self.trial_org.dns_subdomain_label}.dev.method.factory1.io")

    def test_issue_stages_ami_and_git_sha_as_pending_without_touching_the_audit_fields(self):
        provisioner = self._make_provisioner(base_ami_id='ami-0abc123', tofu_module_git_sha='deadbeef')

        provisioner.issue(self.trial_org, 'job-1')

        self.assertEqual(self.trial_org.pending_ami_id, 'ami-0abc123')
        self.assertEqual(self.trial_org.pending_tofu_module_git_sha, 'deadbeef')
        self.assertFalse(self.trial_org.ami_id)
        self.assertFalse(self.trial_org.tofu_module_git_sha)

    def test_issue_without_base_ami_id_raises_a_clear_error_instead_of_calling_aws(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, base_ami_id=None)

        with self.assertRaises(UserError):
            provisioner.issue(self.trial_org, 'job-1')
        client.start_execution.assert_not_called()

    def test_issue_without_module_git_sha_raises_a_clear_error_instead_of_calling_aws(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, tofu_module_git_sha=None)

        with self.assertRaises(UserError):
            provisioner.issue(self.trial_org, 'job-1')
        client.start_execution.assert_not_called()

    def test_destroy_forwards_the_org_s_own_recorded_deployment_version(self):
        # Not the currently-configured base_ami_id/tofu_module_git_sha - a destroy must tear
        # down what was actually deployed, and RunTofu (shared with 'issue') needs both keys
        # present in every execution input regardless of action.
        self.trial_org.write({'ami_id': 'ami-deployed', 'tofu_module_git_sha': 'deployedsha'})
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client, base_ami_id='ami-configured-now',
                                              tofu_module_git_sha='configuredshanow')

        provisioner.destroy(self.trial_org, 'job-3')

        execution_input = json.loads(client.start_execution.call_args.kwargs['input'])
        self.assertEqual(execution_input['ami_id'], 'ami-deployed')
        self.assertEqual(execution_input['module_git_sha'], 'deployedsha')

    def test_destroy_falls_back_to_pending_deployment_version_when_audit_fields_are_blank(self):
        # A prior Issue can move the org to 'active' and leave real infrastructure behind
        # without ever reaching check_status()'s SUCCEEDED promotion (still running, or it
        # failed) - the pending fields it staged are the only known-good values at that point.
        self.trial_org.write({
            'pending_ami_id': 'ami-pending',
            'pending_tofu_module_git_sha': 'pendingsha',
        })
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)

        provisioner.destroy(self.trial_org, 'job-3')

        execution_input = json.loads(client.start_execution.call_args.kwargs['input'])
        self.assertEqual(execution_input['ami_id'], 'ami-pending')
        self.assertEqual(execution_input['module_git_sha'], 'pendingsha')

    def test_issue_records_the_execution_arn_returned_by_start_execution(self):
        provisioner = self._make_provisioner()

        provisioner.issue(self.trial_org, 'job-1')

        self.assertEqual(self.trial_org.last_execution_arn, FAKE_RESPONSE_EXECUTION_ARN)

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

        # No response to read an executionArn from on this path - falls back to the
        # reconstructed (always-unqualified) ARN instead.
        self.assertEqual(
            self.trial_org.last_execution_arn,
            f"arn:aws:states:us-east-1:123456789012:execution:trial-org-lifecycle:trial-{self.trial_org.id}-job-1")

    def test_execution_already_exists_strips_a_version_or_alias_qualifier(self):
        # A qualified hosting_admin.aws_state_machine_arn (docs/adr/0022) is valid input to
        # StartExecution, but a Step Functions execution ARN never carries that qualifier -
        # reconstructing one that does would make describe_execution() fail on every later poll.
        client = _make_fake_client()
        client.start_execution.side_effect = FakeExecutionAlreadyExists()
        provisioner = AwsProvisioner(
            state_machine_arn=f"{STATE_MACHINE_ARN}:PROD",
            base_ami_id='ami-0abc123', tofu_module_git_sha='deadbeef',
            dns_domain_suffix='dev.method.factory1.io', client=client,
        )

        provisioner.issue(self.trial_org, 'job-1')

        self.assertEqual(
            self.trial_org.last_execution_arn,
            f"arn:aws:states:us-east-1:123456789012:execution:trial-org-lifecycle:trial-{self.trial_org.id}-job-1")

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
        provisioner = self._make_provisioner(client=client, base_ami_id='ami-0abc123',
                                              tofu_module_git_sha='deadbeef')
        provisioner.issue(self.trial_org, 'job-1')
        self.trial_org.write({'last_job_status': 'running'})
        client.describe_execution.return_value = {'status': 'SUCCEEDED'}

        provisioner.check_status(self.trial_org)

        client.describe_execution.assert_called_once_with(
            executionArn=self.trial_org.last_execution_arn)
        self.assertEqual(self.trial_org.last_job_status, 'succeeded')
        self.assertFalse(self.trial_org.last_job_error)
        self.assertEqual(self.trial_org.ami_id, 'ami-0abc123')
        self.assertEqual(self.trial_org.tofu_module_git_sha, 'deadbeef')

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
        self.assertFalse(self.trial_org.ami_id, "a failed execution must not claim a deployment")
        self.assertFalse(self.trial_org.tofu_module_git_sha)

    def test_check_status_leaves_running_executions_alone(self):
        client = _make_fake_client()
        provisioner = self._make_provisioner(client=client)
        provisioner.issue(self.trial_org, 'job-1')
        self.trial_org.write({'last_job_status': 'running'})
        client.describe_execution.return_value = {'status': 'RUNNING'}

        provisioner.check_status(self.trial_org)

        self.assertEqual(self.trial_org.last_job_status, 'running')
