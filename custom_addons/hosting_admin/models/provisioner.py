from abc import ABC, abstractmethod


class Provisioner(ABC):
    """Injectable seam standing in for the AWS/OpenTofu call surface behind every Trial Org
    lifecycle action (Issue, Suspend, Wake, Auto-Destroy - see docs/adr/0016 and
    docs/adr/0018). The real implementation starts a Step Functions execution per action and
    reads back its status (docs/adr/0019); ``hosting.trial.org`` never runs ``tofu`` or talks
    to AWS itself. That real implementation is wired in a later ticket - this ticket only
    defines the interface and injects a no-op stub, so the model's lifecycle methods and their
    tests do not depend on any network or AWS credentials.

    Each method takes the ``hosting.trial.org`` record the action targets and a ``job_id`` -
    the UUID persisted on the record for that action (docs/adr/0019) so a real implementation
    can derive a deterministic Step Functions execution name / ECS ``ClientToken`` and safely
    dedupe a retry within its 24-hour window. Returns a Provisioner-defined execution handle
    (e.g. a Step Functions execution ARN); this ticket's stub returns ``None``.
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


class StubProvisioner(Provisioner):
    """No-op stand-in injected until a later ticket wires the real AWS/OpenTofu-backed
    implementation. Makes no network or AWS call of any kind; callers must stay indifferent to
    which ``Provisioner`` implementation is injected."""

    def issue(self, trial_org, job_id):
        return None

    def suspend(self, trial_org, job_id):
        return None

    def wake(self, trial_org, job_id):
        return None

    def destroy(self, trial_org, job_id):
        return None
