import json
import logging
from abc import ABC, abstractmethod

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class Provisioner(ABC):
    """Injectable seam standing in for the AWS/OpenTofu call surface behind every Trial Org
    lifecycle action (Issue, Suspend, Wake, Auto-Destroy - see docs/adr/0016 and
    docs/adr/0018). ``AwsProvisioner`` below is the real implementation: it starts a Step
    Functions execution per action and reads back its status (docs/adr/0019);
    ``hosting.trial.org`` never runs ``tofu`` or talks to AWS itself. ``StubProvisioner`` is a
    no-op stand-in for environments (tests, dev) with no AWS wiring configured.

    Each method takes the ``hosting.trial.org`` record the action targets and a ``job_id`` -
    the UUID persisted on the record for that action (docs/adr/0019) so an implementation can
    derive a deterministic Step Functions execution name / ECS ``ClientToken`` and safely
    dedupe a retry within its 24-hour window. Returns a Provisioner-defined execution handle
    (e.g. a Step Functions execution ARN); ``StubProvisioner`` returns ``None``.
    """

    @abstractmethod
    def issue(self, trial_org, job_id):
        """Start provisioning ``trial_org``'s infrastructure (issued -> active)."""

    @abstractmethod
    def suspend(self, trial_org, job_id):
        """Start stopping ``trial_org``'s compute (active -> suspended). Bypasses OpenTofu and
        calls the EC2 API directly in the real implementation (docs/adr/0021)."""

    @abstractmethod
    def wake(self, trial_org, job_id):
        """Start starting ``trial_org``'s compute again (suspended -> active). Bypasses
        OpenTofu, same as suspend (docs/adr/0021)."""

    @abstractmethod
    def destroy(self, trial_org, job_id):
        """Start permanently tearing down ``trial_org``'s infrastructure (-> destroyed)."""

    def check_status(self, trial_org):
        """Poll (or otherwise observe) the status of ``trial_org``'s most recently started
        lifecycle action and surface it back onto the record (docs/adr/0019). Not an
        ``abstractmethod`` - a concrete no-op default so ``StubProvisioner`` and test doubles
        that only implement the four lifecycle methods above stay valid Provisioner
        implementations; ``AwsProvisioner`` overrides it."""


class StubProvisioner(Provisioner):
    """No-op stand-in injected when no AWS wiring is configured (dev/test environments).
    Makes no network or AWS call of any kind; callers must stay indifferent to which
    ``Provisioner`` implementation is injected."""

    def issue(self, trial_org, job_id):
        return None

    def suspend(self, trial_org, job_id):
        return None

    def wake(self, trial_org, job_id):
        return None

    def destroy(self, trial_org, job_id):
        return None


class AwsProvisioner(Provisioner):
    """Real Provisioner: starts an AWS Step Functions execution on the Trial Org lifecycle
    state machine (docs/adr/0016, infra/foundation/state_machine.tf) for each lifecycle action,
    then polls it back onto the ``hosting.trial.org`` record (docs/adr/0019). Never runs
    ``tofu`` or talks to EC2/DynamoDB/S3 itself - all of that lives in the state machine and
    its ECS task. Only ever calls the two Step Functions actions hosting_admin's IAM role is
    scoped to (docs/adr/0019, docs/adr/0022): ``StartExecution`` and ``DescribeExecution``.
    """

    def __init__(self, state_machine_arn, base_ami_id=None, tofu_module_git_sha=None,
                 client=None, region_name=None):
        if not state_machine_arn:
            error_message = "AwsProvisioner requires a state_machine_arn."
            raise ValueError(error_message)
        self._state_machine_arn = state_machine_arn
        self._base_ami_id = base_ami_id
        self._tofu_module_git_sha = tofu_module_git_sha
        self._client = client
        self._region_name = region_name

    @property
    def client(self):
        """Lazily creates the boto3 Step Functions client, so a test can inject a fake/mock
        client via ``client=`` in ``__init__`` without boto3 needing to be installed to run the
        test suite at all (the ticket's own mocking requirement)."""
        if self._client is None:
            import boto3  # noqa: PLC0415 - lazy so tests never need boto3 installed at all
            self._client = boto3.client('stepfunctions', region_name=self._region_name)
        return self._client

    def issue(self, trial_org, job_id):
        self._start_execution(trial_org, job_id, 'issue', extra_input={
            'ami_id': self._base_ami_id,
            'module_git_sha': self._tofu_module_git_sha,
        })
        # Both the AMI id and the module's git SHA are already known here - hosting_admin is
        # telling the per-trial OpenTofu module which of each to use (they're inputs to the
        # module, not something to discover from the apply's result), so they can be recorded
        # onto the Deployment Version fields (docs/adr/0024) right away rather than waiting for
        # the execution to finish.
        trial_org.write({
            'ami_id': self._base_ami_id,
            'tofu_module_git_sha': self._tofu_module_git_sha,
        })

    def suspend(self, trial_org, job_id):
        self._start_execution(trial_org, job_id, 'suspend', extra_input={
            'instance_id': self._require_instance_id(trial_org, 'suspend'),
        })

    def wake(self, trial_org, job_id):
        self._start_execution(trial_org, job_id, 'wake', extra_input={
            'instance_id': self._require_instance_id(trial_org, 'wake'),
        })

    def destroy(self, trial_org, job_id):
        self._start_execution(trial_org, job_id, 'destroy')

    def check_status(self, trial_org):
        """Poll this Trial Org's most recently started execution and surface
        running/succeeded/failed back onto the record. A no-op unless the record actually has
        an unfinished job with a recorded execution ARN to check."""
        if trial_org.last_job_status != 'running' or not trial_org.last_execution_arn:
            return

        try:
            response = self.client.describe_execution(executionArn=trial_org.last_execution_arn)
        except Exception:
            # Transient AWS/network trouble describing the execution isn't itself a lifecycle
            # failure - last_job_status stays 'running' and the next poll tries again.
            _logger.exception(
                "Could not describe Step Functions execution %s for Trial Org %s",
                trial_org.last_execution_arn, trial_org.id)
            return

        status = response.get('status')
        if status == 'RUNNING':
            return
        if status == 'SUCCEEDED':
            trial_org.write({'last_job_status': 'succeeded', 'last_job_error': False})
        else:
            # FAILED, TIMED_OUT or ABORTED - including a failure Step Functions itself
            # terminates the execution for (e.g. after exhausting a Task's Retry). Surfaced as
            # a clear, readable error on the record rather than left for an admin to go dig up
            # in the AWS console.
            trial_org.write({
                'last_job_status': 'failed',
                'last_job_error': self._describe_failure(status, response),
            })

    @staticmethod
    def _describe_failure(status, response):
        error = response.get('error') or status
        cause = response.get('cause')
        return f"{error}: {cause}" if cause else error

    @staticmethod
    def _execution_name(trial_org, job_id):
        # Fixed format both the state machine's own definition and hosting_admin's IAM
        # execution-ARN scoping assume holds (docs/adr/0019,
        # infra/foundation/state_machine.asl.json.tftpl's own top-level Comment) - never
        # auto-generated by StartExecution itself.
        return f"trial-{trial_org.id}-{job_id}"

    def _execution_arn(self, execution_name):
        # arn:aws:states:<region>:<account>:stateMachine:<name>
        #   -> arn:aws:states:<region>:<account>:execution:<name>:<execution_name>
        return self._state_machine_arn.replace(':stateMachine:', ':execution:') + f":{execution_name}"

    @staticmethod
    def _require_instance_id(trial_org, action):
        # SuspendInstance/WakeInstance (infra/foundation/state_machine.asl.json.tftpl) resolve
        # "$.instance_id" from the execution input; an execution started without it would fail
        # inside AWS with an opaque JSONPath error. Fail clearly here instead - see
        # instance_id's own field docstring on hosting.trial.org for why it may still be blank.
        if not trial_org.instance_id:
            raise UserError(_(
                "Cannot %(action)s Trial Org %(name)s: no EC2 instance id has been recorded "
                "for it yet.",
                action=action, name=trial_org.name,
            ))
        return trial_org.instance_id

    @staticmethod
    def _state_key(trial_org):
        # Deterministic per-org OpenTofu remote-state key (docs/adr/0016's State-key/workspace
        # boundary): derived from the Trial Org's own immutable numeric id, never from mutable
        # fields like the prospect domain, so a retry can never cross-target another Trial
        # Org's state.
        return f"trial-orgs/{trial_org.id}/terraform.tfstate"

    def _start_execution(self, trial_org, job_id, action, extra_input=None):
        execution_name = self._execution_name(trial_org, job_id)
        execution_input = {
            'trial_org_id': str(trial_org.id),
            'job_id': job_id,
            'action': action,
            'state_key': self._state_key(trial_org),
        }
        if extra_input:
            execution_input.update({k: v for k, v in extra_input.items() if v is not None})

        try:
            self.client.start_execution(
                stateMachineArn=self._state_machine_arn,
                name=execution_name,
                input=json.dumps(execution_input),
            )
        except self.client.exceptions.ExecutionAlreadyExists:
            # A genuine retry of the same request: the same job id derives the same execution
            # name/input, which Step Functions itself already recognizes as the same execution
            # rather than starting a second one (docs/adr/0019) - nothing else to do.
            _logger.info(
                "StartExecution retry for Trial Org %s job %s already exists; reusing it.",
                trial_org.id, job_id)
        except Exception as exc:
            raise UserError(_(
                "Could not start the %(action)s action for Trial Org %(name)s: %(error)s",
                action=action, name=trial_org.name, error=exc,
            )) from exc

        trial_org.write({'last_execution_arn': self._execution_arn(execution_name)})
