import re
import uuid
from datetime import timedelta

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .provisioner import AwsProvisioner, StubProvisioner

# The system-wide seat cap from docs/contexts/hosting/CONTEXT.md's Seat entry: "The count is
# set per-trial at issuance (system-wide max 25)". A single Trial Org's own seat_cap may be
# anywhere from 1 up to this ceiling; it is not a cross-trial total.
SYSTEM_WIDE_SEAT_CAP = 25

# The idle timeout docs/adr/0014 sets for a Trial Org's compute: "stopped after an idle timeout
# (~30 min)". Checked by a scheduled action (_cron_suspend_idle), never inline on request.
IDLE_TIMEOUT_MINUTES = 30

# The snapshot retention window docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry sets: "A
# short-lived (7-day) database snapshot is retained afterward in case of revival."
SNAPSHOT_RETENTION_DAYS = 7

# A pragmatic hostname/domain check (labels of letters/digits/hyphens, no leading/trailing
# hyphen, at least one dot) - good enough to reject an obviously-malformed prospect domain
# without pulling in a DNS-validation dependency.
_DOMAIN_RE = re.compile(
    r'^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$',
)

# Valid lifecycle actions as (source states, target state) pairs, keyed by action name. Mirrors
# the ticket's "issued -> active -> suspended -> active -> destroyed" sequence: Issue is one-way
# from issued, Suspend and Wake move back and forth between active and suspended, and
# Auto-Destroy is reachable from either operating state but never reversible. Issue and Wake
# share a target state (active) but not a source state, so each action is validated by its own
# name rather than by target state alone - a Wake called on a still-issued (never-provisioned)
# Trial Org must be rejected even though issued -> active is a valid move for Issue.
_TRANSITIONS = {
    'issue': ({'issued'}, 'active'),
    'suspend': ({'active'}, 'suspended'),
    'wake': ({'suspended'}, 'active'),
    'destroy': ({'active', 'suspended'}, 'destroyed'),
}

# ir.config_parameter keys AwsProvisioner is configured from (_get_provisioner below). Unset
# (the default for dev/test environments with no AWS wiring) falls back to StubProvisioner -
# see docs/adr/0019 for the state machine/IAM design these values plug into.
CONFIG_PARAM_STATE_MACHINE_ARN = 'hosting_admin.aws_state_machine_arn'
CONFIG_PARAM_AWS_REGION = 'hosting_admin.aws_region'
CONFIG_PARAM_BASE_AMI_ID = 'hosting_admin.base_ami_id'
CONFIG_PARAM_TOFU_MODULE_GIT_SHA = 'hosting_admin.tofu_module_git_sha'

# The AWS-documented TTL on ECS RunTask's own ClientToken reuse (docs/adr/0019's Job identity
# section): a retry of the same lifecycle request within this window reuses the existing
# unfinished job id; past it, hosting_admin treats the request as needing a fresh one.
JOB_ID_RETRY_WINDOW = timedelta(hours=24)

# Context key ``_apply_transition`` sets to authorize its own ``write({'state': ...})`` call.
# ``state`` is declared ``readonly=True`` below, but that only hides the field in form views -
# it does not stop a caller with model access from setting it directly via ORM or RPC
# create()/write(), bypassing _apply_transition()'s source-state validation and Provisioner
# call entirely. The create()/write() overrides on this model reject any caller-supplied
# ``state`` unless this context key is set, so _apply_transition() is the only path that can
# ever change it.
ALLOW_STATE_WRITE_KEY = 'hosting_trial_org_allow_state_write'


class HostingTrialOrg(models.Model):
    # Named 'hosting.trial.org' per the ticket's own literal suggestion, not
    # 'hosting.admin.trial.org'. docs/adr/0018 describes the addon's conceptual namespace as
    # "hosting.admin", but that's the addon's own admin/cross-org identity (already carried by
    # the technical addon name 'hosting_admin' and its ir.module.category/security group below)
    # - it is not a mandate to prefix every model inside it with an 'admin' segment. Repeating
    # it on the model itself would be redundant given the addon boundary already enforces that
    # this is the only place Trial Org data lives, and the org-facing 'hosting' addon (ADR-0018)
    # never defines a model of this name to collide with.
    _name = 'hosting.trial.org'
    _description = "Trial Org"
    _order = 'create_date desc'

    name = fields.Char(string="Org Name", required=True)
    prospect_domain = fields.Char(
        required=True,
        help="The prospect's email domain this Trial Org is provisioned for. Every Seat "
             "invite must match it.",
    )
    seat_cap = fields.Integer(
        string="Seat Cap", required=True, default=5,
        help="Number of Seats available on this Trial Org, set at issuance. "
             f"Capped system-wide at {SYSTEM_WIDE_SEAT_CAP}.",
    )
    state = fields.Selection([
        ('issued', "Issued"),
        ('active', "Active"),
        ('suspended', "Suspended"),
        ('destroyed', "Destroyed"),
    ], default='issued', required=True, readonly=True, copy=False)
    expiry_date = fields.Date(
        help="The date Auto-Destroy fires for this Trial Org, absent an Extension.")

    # Deployment Version (docs/adr/0024, docs/contexts/hosting/CONTEXT.md): audit-only facts
    # recording what a Trial Org actually ran. Populated by AwsProvisioner.issue() - blank on
    # StubProvisioner-backed records, since no real AWS call was ever made.
    ami_id = fields.Char(
        string="AMI ID", copy=False,
        help="The base AMI this Trial Org was provisioned from. Audit-only; populated by the "
             "real Provisioner implementation.")
    tofu_module_git_sha = fields.Char(
        string="OpenTofu Module Git SHA", copy=False,
        help="The git SHA of the per-trial OpenTofu module this Trial Org was provisioned "
             "from. Audit-only; populated by the real Provisioner implementation.")
    pending_ami_id = fields.Char(
        copy=False, readonly=True,
        help="ami_id staged by AwsProvisioner.issue() before its execution has finished. "
             "Promoted to ami_id once check_status() sees that job SUCCEEDED, so a failed or "
             "still-running deploy never claims a version it didn't complete.")
    pending_tofu_module_git_sha = fields.Char(
        copy=False, readonly=True,
        help="tofu_module_git_sha staged by AwsProvisioner.issue() before its execution has "
             "finished - see pending_ami_id.")

    # The most recent lifecycle action's job id (docs/adr/0019): generated once per action and
    # reused verbatim on a retry of that same action within JOB_ID_RETRY_WINDOW - see
    # _get_or_create_job_id(). last_job_action/last_job_started_at are the bookkeeping
    # _get_or_create_job_id() reads back to decide whether to reuse it; last_job_status/
    # last_job_error/last_execution_arn are what AwsProvisioner.check_status() polls onto the
    # record once that job's Step Functions execution finishes.
    last_job_id = fields.Char(copy=False, readonly=True)
    last_job_action = fields.Char(copy=False, readonly=True)
    last_job_started_at = fields.Datetime(copy=False, readonly=True)
    last_job_status = fields.Selection([
        ('running', "Running"),
        ('succeeded', "Succeeded"),
        ('failed', "Failed"),
    ], copy=False, readonly=True)
    last_job_error = fields.Text(copy=False, readonly=True)
    last_execution_arn = fields.Char(
        copy=False, readonly=True,
        help="Step Functions execution ARN for last_job_id, recorded by AwsProvisioner so "
             "check_status() knows what to poll (docs/adr/0019).")

    # EC2 instance id Suspend/Wake need for their execution input
    # (infra/foundation/state_machine.asl.json.tftpl's SuspendInstance/WakeInstance Task
    # states, docs/adr/0021). Not populated by this ticket: it's only known once an Issue
    # execution's `tofu apply` actually runs, and #113's state machine doesn't yet surface its
    # outputs back onto the execution's own result for hosting_admin to read (a gap for a
    # follow-up ticket, not something #114 can close from the hosting_admin side alone).
    # AwsProvisioner.suspend()/wake() raise a clear error rather than start an execution AWS
    # would reject anyway if this is still blank.
    instance_id = fields.Char(copy=False, readonly=True)

    # Last recorded activity on this Trial Org's compute, checked by the idle-timeout Suspend
    # scheduled action (docs/adr/0014) against IDLE_TIMEOUT_MINUTES. Seeded to the moment it goes
    # active (Issue or Wake) so a freshly-issued or just-woken Trial Org gets a full idle window
    # before the next Suspend sweep, rather than being immediately eligible.
    last_activity_at = fields.Datetime(readonly=True, copy=False)

    # Auto-Destroy always records a short-lived snapshot marker (docs/contexts/hosting/
    # CONTEXT.md's Auto-Destroy entry) regardless of what triggered it - expiry-driven or manual
    # teardown alike. This ticket only records the retention date; the real snapshot itself is
    # a later ticket's Provisioner concern.
    snapshot_retention_until = fields.Date(
        readonly=True, copy=False,
        help="The date this Trial Org's post-destroy database snapshot may be discarded "
             f"({SNAPSHOT_RETENTION_DAYS} days after Auto-Destroy).")

    _seat_cap_positive = models.Constraint(
        'CHECK(seat_cap > 0)',
        "Seat cap must be a positive number.",
    )

    @api.constrains('seat_cap')
    def _check_seat_cap_within_system_wide_max(self):
        for trial_org in self:
            if trial_org.seat_cap > SYSTEM_WIDE_SEAT_CAP:
                raise ValidationError(_(
                    "Seat cap (%(seat_cap)s) cannot exceed the system-wide maximum of "
                    "%(max_seats)s seats.",
                    seat_cap=trial_org.seat_cap, max_seats=SYSTEM_WIDE_SEAT_CAP,
                ))

    @api.constrains('prospect_domain')
    def _check_prospect_domain(self):
        for trial_org in self:
            if not _DOMAIN_RE.fullmatch(trial_org.prospect_domain or ''):
                raise ValidationError(_(
                    "%(domain)r is not a valid prospect domain.",
                    domain=trial_org.prospect_domain,
                ))

    @api.model_create_multi
    def create(self, vals_list):
        """Reject a caller-supplied ``state`` on create - ``readonly=True`` only hides the
        field in form views, so this is the only thing stopping a direct ORM/RPC create() from
        setting it to something other than the model's own default."""
        if not self.env.context.get(ALLOW_STATE_WRITE_KEY):
            for vals in vals_list:
                if 'state' in vals:
                    raise AccessError(_(
                        "Trial Org state cannot be set directly; it can only change through "
                        "its lifecycle actions (Issue, Suspend, Wake, Auto-Destroy)."))
        return super().create(vals_list)

    def write(self, vals):
        """Reject a caller-supplied ``state`` on write unless it comes from
        ``_apply_transition()`` itself (signalled via ``ALLOW_STATE_WRITE_KEY``) - see that
        key's docstring above for why ``readonly=True`` alone is not enough."""
        if 'state' in vals and not self.env.context.get(ALLOW_STATE_WRITE_KEY):
            raise AccessError(_(
                "Trial Org state cannot be set directly; it can only change through its "
                "lifecycle actions (Issue, Suspend, Wake, Auto-Destroy)."))
        return super().write(vals)

    def _get_provisioner(self):
        """Return the ``Provisioner`` implementation to call at each lifecycle transition:
        ``AwsProvisioner`` once AWS wiring is configured (CONFIG_PARAM_STATE_MACHINE_ARN and
        friends, above), ``StubProvisioner`` otherwise - dev/test environments with no AWS
        account to talk to. Tests override this method directly to inject a recording fake."""
        ICP = self.env['ir.config_parameter'].sudo()
        state_machine_arn = ICP.get_param(CONFIG_PARAM_STATE_MACHINE_ARN)
        if not state_machine_arn:
            return StubProvisioner()
        return AwsProvisioner(
            state_machine_arn=state_machine_arn,
            base_ami_id=ICP.get_param(CONFIG_PARAM_BASE_AMI_ID),
            tofu_module_git_sha=ICP.get_param(CONFIG_PARAM_TOFU_MODULE_GIT_SHA),
            region_name=ICP.get_param(CONFIG_PARAM_AWS_REGION),
        )

    def action_issue(self):
        """Issue this Trial Org: issued -> active."""
        self._apply_transition('issue')

    def action_suspend(self):
        """Suspend this Trial Org's compute: active -> suspended."""
        self._apply_transition('suspend')

    def action_wake(self):
        """Wake this Trial Org's compute back up: suspended -> active."""
        self._apply_transition('wake')

    def action_destroy(self):
        """Auto-Destroy (or manually tear down) this Trial Org: active/suspended -> destroyed."""
        self._apply_transition('destroy')

    def _get_or_create_job_id(self, action_name):
        """Return (job_id, started_at) for ``action_name`` on this record (docs/adr/0019's Job
        identity design): reuse the existing job id verbatim if the last job recorded on this
        record was for this same action, is still ``running``, and started within
        JOB_ID_RETRY_WINDOW - a retry of the same lifecycle request - otherwise mint a fresh
        UUID. ``started_at`` is returned alongside so a reused job keeps its *original* start
        time rather than resetting the 24h window on every retry.

        Scope note: this bookkeeping lives inside _apply_transition()'s own savepoint, so it
        only dedupes a retry that reaches Odoo again *after* a prior attempt's write actually
        committed (e.g. a second call arriving while the record's last job is still 'running').
        It cannot dedupe the narrower crash window between StartExecution succeeding in AWS and
        that same savepoint later rolling back for an unrelated reason - Odoo has no record of
        the job id to reuse in that case, so the next attempt mints a fresh one and a second,
        differently-named execution reaches AWS. That's still safe, not silently inconsistent:
        the second execution can't proceed until the first stray one's DynamoDB lock is
        released (docs/adr/0020), which is the actual backstop for this specific race."""
        self.ensure_one()
        now = fields.Datetime.now()
        if (self.last_job_action == action_name
                and self.last_job_status == 'running'
                and self.last_job_started_at
                and now - self.last_job_started_at < JOB_ID_RETRY_WINDOW):
            return self.last_job_id, self.last_job_started_at
        return str(uuid.uuid4()), now

    def _apply_transition(self, action_name):
        """Validate every record in ``self`` is in a source state ``action_name`` allows, then
        call the matching ``Provisioner`` method (with a job id from ``_get_or_create_job_id``)
        for each one before recording the new state and job id. The whole batch is applied
        inside one savepoint, so a rejected transition or a Provisioner failure on any single
        record rolls every record in the call back - a multi-record call is genuinely
        all-or-nothing, not just pre-validated-then-hopefully-safe."""
        allowed_source_states, target_state = _TRANSITIONS[action_name]
        with self.env.cr.savepoint():
            for trial_org in self:
                if trial_org.state not in allowed_source_states:
                    raise ValidationError(_(
                        "Trial Org %(name)s cannot move from %(current_state)s to "
                        "%(target_state)s.",
                        name=trial_org.name,
                        current_state=trial_org.state,
                        target_state=target_state,
                    ))

            provisioner = self._get_provisioner()
            now = fields.Datetime.now()
            for trial_org in self:
                job_id, job_started_at = trial_org._get_or_create_job_id(action_name)
                getattr(provisioner, action_name)(trial_org, job_id)
                values = {
                    'state': target_state,
                    'last_job_id': job_id,
                    'last_job_action': action_name,
                    'last_job_started_at': job_started_at,
                    'last_job_status': 'running',
                    'last_job_error': False,
                }
                if target_state == 'active':
                    # Issue and Wake both start (or restart) the idle-timeout clock.
                    values['last_activity_at'] = now
                elif target_state == 'destroyed':
                    # Always record a snapshot marker on Auto-Destroy, whatever triggered it
                    # (expiry sweep or manual teardown) - see the field's own docstring above.
                    values['snapshot_retention_until'] = (
                        fields.Date.context_today(self) + timedelta(days=SNAPSHOT_RETENTION_DAYS))
                trial_org.with_context(**{ALLOW_STATE_WRITE_KEY: True}).write(values)

    def _cron_suspend_idle(self):
        """Scheduled action: Suspend every active Trial Org whose last recorded activity is
        older than IDLE_TIMEOUT_MINUTES (docs/adr/0014). Never triggered by anything else - a
        Trial Org only leaves 'active' via this idle check or an explicit action_suspend()."""
        cutoff = fields.Datetime.now() - timedelta(minutes=IDLE_TIMEOUT_MINUTES)
        idle_trial_orgs = self.search([
            ('state', '=', 'active'),
            ('last_activity_at', '<=', cutoff),
        ])
        if idle_trial_orgs:
            idle_trial_orgs.action_suspend()

    def _cron_auto_destroy_expired(self):
        """Scheduled action: Auto-Destroy every active or suspended Trial Org whose expiry_date
        has passed (docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry). Manual teardown via
        action_destroy() covers the "or on manual teardown" half of Auto-Destroy; both paths
        share _apply_transition() so both always record the snapshot marker."""
        today = fields.Date.context_today(self)
        expired_trial_orgs = self.search([
            ('state', 'in', ('active', 'suspended')),
            ('expiry_date', '!=', False),
            ('expiry_date', '<=', today),
        ])
        if expired_trial_orgs:
            expired_trial_orgs.action_destroy()

    def _cron_poll_pending_jobs(self):
        """Scheduled action: poll every Trial Org with an unfinished lifecycle job
        (last_job_status == 'running') via the Provisioner's check_status() (docs/adr/0019),
        surfacing succeeded/failed onto the record. A StubProvisioner-backed record (no AWS
        wiring configured) is included in the search but check_status() is a no-op for it, so
        it simply stays 'running' forever - harmless, and consistent with the stub never making
        any AWS call."""
        pending_trial_orgs = self.search([('last_job_status', '=', 'running')])
        if not pending_trial_orgs:
            return
        provisioner = self._get_provisioner()
        for trial_org in pending_trial_orgs:
            provisioner.check_status(trial_org)
