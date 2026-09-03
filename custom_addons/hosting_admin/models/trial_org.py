import re
import uuid

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from .provisioner import StubProvisioner

# The system-wide seat cap from docs/contexts/hosting/CONTEXT.md's Seat entry: "The count is
# set per-trial at issuance (system-wide max 25)". A single Trial Org's own seat_cap may be
# anywhere from 1 up to this ceiling; it is not a cross-trial total.
SYSTEM_WIDE_SEAT_CAP = 25

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
    # recording what a Trial Org actually ran. Populated by the real Provisioner in a later
    # ticket - left blank here since this ticket makes no real AWS call.
    ami_id = fields.Char(
        string="AMI ID", copy=False,
        help="The base AMI this Trial Org was provisioned from. Audit-only; populated by the "
             "real Provisioner implementation.")
    tofu_module_git_sha = fields.Char(
        string="OpenTofu Module Git SHA", copy=False,
        help="The git SHA of the per-trial OpenTofu module this Trial Org was provisioned "
             "from. Audit-only; populated by the real Provisioner implementation.")

    # The most recent lifecycle action's job id (docs/adr/0019): generated once per action and,
    # in the real implementation, reused verbatim on any retry of that same action within 24h.
    # This ticket's stub Provisioner does not retry, so a fresh id is simply recorded here on
    # every successful transition for the real implementation to build on later.
    last_job_id = fields.Char(copy=False, readonly=True)

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
            if not _DOMAIN_RE.match(trial_org.prospect_domain or ''):
                raise ValidationError(_(
                    "%(domain)r is not a valid prospect domain.",
                    domain=trial_org.prospect_domain,
                ))

    def _get_provisioner(self):
        """Return the ``Provisioner`` implementation to call at each lifecycle transition.
        A later ticket replaces this stub with the real AWS/OpenTofu-backed implementation;
        tests override this method to inject a recording fake."""
        return StubProvisioner()

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

    def _apply_transition(self, action_name):
        """Validate every record in ``self`` is in a source state ``action_name`` allows, then
        call the matching ``Provisioner`` method (with a freshly generated job id) for each one
        before recording the new state and job id. The whole batch is applied inside one
        savepoint, so a rejected transition or a Provisioner failure on any single record rolls
        every record in the call back - a multi-record call is genuinely all-or-nothing, not
        just pre-validated-then-hopefully-safe."""
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
            for trial_org in self:
                job_id = str(uuid.uuid4())
                getattr(provisioner, action_name)(trial_org, job_id)
                trial_org.write({'state': target_state, 'last_job_id': job_id})
