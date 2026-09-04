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
    a fresh UUID minted for this call (docs/adr/0019) so an implementation can derive a
    deterministic Step Functions execution name / ECS ``ClientToken``, making a Step
    Functions-level Task retry of the same execution attempt safely idempotent. Returns a
    Provisioner-defined execution handle (e.g. a Step Functions execution ARN);
    ``StubProvisioner`` returns ``None``.
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

    def get_audit_trail(self, trial_org):
        """Return ``trial_org``'s lifecycle audit trail (docs/adr/0022): the overall status/
        timing of its most recently started execution plus step-by-step detail, read live -
        never cached or persisted in Odoo. A plain dict (see ``AwsProvisioner``'s override for
        its shape) rather than a bespoke object, since the view reads it directly and it never
        round-trips back through a Provisioner call.

        Concrete no-op default, like ``check_status`` above: ``{'available': False}``,
        matching ``StubProvisioner``'s never-called-AWS reality and giving the view its
        "unavailable" state for free rather than a bespoke per-implementation check."""
        return {'available': False}


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
            'ami_id': self._require_module_config('base_ami_id', self._base_ami_id),
            'module_git_sha': self._require_module_config(
                'tofu_module_git_sha', self._tofu_module_git_sha),
        })
        # The AMI id and the module's git SHA are already known here - hosting_admin is telling
        # the per-trial OpenTofu module which of each to use - but the execution can still fail
        # (FAILED/TIMED_OUT/ABORTED) after StartExecution returns. Stash them as pending rather
        # than writing the Deployment Version fields (docs/adr/0024) directly: check_status()
        # only promotes them once the execution actually reports SUCCEEDED, so a failed deploy
        # never claims a version it didn't complete.
        trial_org.write({
            'pending_ami_id': self._base_ami_id,
            'pending_tofu_module_git_sha': self._tofu_module_git_sha,
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
        # RunTofu (infra/foundation/state_machine.asl.json.tftpl) is the same Task for 'issue'
        # and 'destroy', and now always reads $.ami_id/$.module_git_sha for the ECS task's
        # AMI_ID/MODULE_GIT_SHA env vars - a destroy execution input missing either key would
        # fail the state machine itself with a JSONPath resolution error before ever reaching
        # ECS. Use the org's own recorded Deployment Version (docs/adr/0024), not the
        # currently-configured one, since a destroy must tear down what was actually deployed.
        # Fall back to the pending fields when the audit fields are still blank: a prior Issue
        # can have failed (or still be running) without ever reaching check_status()'s SUCCEEDED
        # promotion, yet still moved this org to 'active' and left real infrastructure behind for
        # destroy() to clean up - pending_ami_id/pending_tofu_module_git_sha are what that Issue
        # actually told RunTofu to use.
        self._start_execution(trial_org, job_id, 'destroy', extra_input={
            'ami_id': trial_org.ami_id or trial_org.pending_ami_id,
            'module_git_sha': trial_org.tofu_module_git_sha or trial_org.pending_tofu_module_git_sha,
        })

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
            # Promoting pending_ami_id/pending_tofu_module_git_sha here is a no-op for a
            # suspend/wake/destroy success - only issue() ever changes those pending fields, so
            # this just re-copies whatever the last issue already recorded (or blanks, if this
            # Trial Org has never been issued through this Provisioner).
            trial_org.write({
                'last_job_status': 'succeeded',
                'last_job_error': False,
                'ami_id': trial_org.pending_ami_id,
                'tofu_module_git_sha': trial_org.pending_tofu_module_git_sha,
            })
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

    def get_audit_trail(self, trial_org):
        """Return ``trial_org``'s lifecycle audit trail (docs/adr/0022): ``DescribeExecution``
        for the overall status/timing of its most recently started execution, plus
        ``GetExecutionHistory`` for step-by-step detail (mutex acquired, tofu/EC2-API task
        started, that task's result - infra/foundation/state_machine.asl.json.tftpl's own
        state names). Read fresh on every call; never cached or persisted in Odoo.

        Degrades to ``{'available': False}`` rather than raising when there's no recorded
        execution to ask about, or ``DescribeExecution`` itself fails (e.g. transient AWS/
        network trouble) - the ticket's own requirement that a failed AWS call show a clear
        "unavailable" state on the view instead of an error page. A ``GetExecutionHistory``
        failure alone (e.g. the execution's history has aged out of Step Functions' retention
        window, while the execution record itself is still describable) instead keeps
        ``available: True`` with ``steps_available: False`` - the overall status/timing is
        still real and worth showing even without the step detail.
        """
        if not trial_org.last_execution_arn:
            return {'available': False}

        try:
            execution = self.client.describe_execution(executionArn=trial_org.last_execution_arn)
        except Exception:
            _logger.exception(
                "Could not describe Step Functions execution %s for Trial Org %s's audit trail",
                trial_org.last_execution_arn, trial_org.id)
            return {'available': False}

        steps_available = True
        events = []
        try:
            history = self.client.get_execution_history(
                executionArn=trial_org.last_execution_arn, reverseOrder=False)
            events = history.get('events', [])
        except Exception:
            _logger.exception(
                "Could not get Step Functions execution history for %s for Trial Org %s's "
                "audit trail", trial_org.last_execution_arn, trial_org.id)
            steps_available = False

        return {
            'available': True,
            'action': trial_org.last_job_action,
            'job_id': trial_org.last_job_id,
            'status': execution.get('status'),
            'start_date': execution.get('startDate'),
            'stop_date': execution.get('stopDate'),
            'steps_available': steps_available,
            'steps': [self._describe_event(event) for event in events],
        }

    @staticmethod
    def _describe_event(event):
        """Reduce one ``GetExecutionHistory`` event to what the audit view shows: when it
        happened, its type (e.g. ``TaskStateEntered``), the state/task name it belongs to
        (``AcquireLock``, ``RunTofu``, ``SuspendInstance``, ``WakeInstance`` -
        infra/foundation/state_machine.asl.json.tftpl's own state names), and - for a failure
        event - why. Every event type AWS defines carries its own single non-empty
        ``*EventDetails`` key; this reads whichever one of the handful relevant to this state
        machine (state entered/exited, task failed, execution failed) the event actually has."""
        detail = (
            event.get('stateEnteredEventDetails')
            or event.get('stateExitedEventDetails')
            or event.get('taskFailedEventDetails')
            or event.get('taskTimedOutEventDetails')
            or event.get('executionFailedEventDetails')
            or event.get('executionTimedOutEventDetails')
            or event.get('executionAbortedEventDetails')
            or {}
        )
        return {
            'timestamp': event.get('timestamp'),
            'type': event.get('type'),
            'name': detail.get('name'),
            'error': detail.get('error'),
            'cause': detail.get('cause'),
        }

    @staticmethod
    def _execution_name(trial_org, job_id):
        # Fixed format both the state machine's own definition and hosting_admin's IAM
        # execution-ARN scoping assume holds (docs/adr/0019,
        # infra/foundation/state_machine.asl.json.tftpl's own top-level Comment) - never
        # auto-generated by StartExecution itself.
        return f"trial-{trial_org.id}-{job_id}"

    def _execution_arn(self, execution_name):
        # arn:aws:states:<region>:<account>:stateMachine:<name>[:qualifier]
        #   -> arn:aws:states:<region>:<account>:execution:<name>:<execution_name>
        # hosting_admin.aws_state_machine_arn (docs/adr/0022) may be a version- or
        # alias-qualified ARN - StartExecution accepts that, but a Step Functions *execution*
        # ARN never carries that trailing qualifier segment, so it's dropped before rebuilding
        # one (docs/adr/0019's IAM scope documents the unqualified execution ARN format).
        unqualified_state_machine_arn = ':'.join(self._state_machine_arn.split(':')[:7])
        return (unqualified_state_machine_arn.replace(':stateMachine:', ':execution:')
                + f":{execution_name}")

    @staticmethod
    def _require_module_config(name, value):
        # RunTofu (infra/foundation/state_machine.asl.json.tftpl) forwards $.ami_id/
        # $.module_git_sha to the ECS task as AMI_ID/MODULE_GIT_SHA - the trial_org OpenTofu
        # module (infra/modules/trial_org/variables.tf) requires both. Starting an execution
        # without them would fail deep inside the ECS task's `tofu apply` instead of here.
        if not value:
            raise UserError(_(
                "Cannot issue a Trial Org: %(name)s is not configured "
                "(ir.config_parameter).", name=name,
            ))
        return value

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
            response = self.client.start_execution(
                stateMachineArn=self._state_machine_arn,
                name=execution_name,
                input=json.dumps(execution_input),
            )
        except self.client.exceptions.ExecutionAlreadyExists:
            # A genuine retry of the same request: the same job id derives the same execution
            # name/input, which Step Functions itself already recognizes as the same execution
            # rather than starting a second one (docs/adr/0019) - nothing else to do. There's no
            # response to read an executionArn from here, so fall back to reconstructing it -
            # safe in this one case because it's built from the same unqualified
            # _state_machine_arn StartExecution itself was just called with, not from whatever
            # arbitrary ARN hosting_admin.aws_state_machine_arn holds in the general case below.
            _logger.info(
                "StartExecution retry for Trial Org %s job %s already exists; reusing it.",
                trial_org.id, job_id)
            trial_org.write({'last_execution_arn': self._execution_arn(execution_name)})
            return
        except Exception as exc:
            raise UserError(_(
                "Could not start the %(action)s action for Trial Org %(name)s: %(error)s",
                action=action, name=trial_org.name, error=exc,
            )) from exc

        # Read the executionArn StartExecution actually returned rather than reconstructing it
        # from hosting_admin.aws_state_machine_arn: that config value can be version- or
        # alias-qualified, which _execution_arn()'s naive string replacement would carry into an
        # invalid execution ARN, breaking check_status()'s later describe_execution call.
        trial_org.write({'last_execution_arn': response['executionArn']})
