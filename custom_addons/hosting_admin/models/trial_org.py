from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError

from .hosting_stack_client import RealHostingStackClient, StubHostingStackClient

# ir.config_parameter keys HostingStackClient is configured from (_get_stack_client below).
# Unset base_url (the default for dev/test environments, and any environment before the
# production cutover completes) falls back to StubHostingStackClient - docs/adr/0034, this
# ticket's Implementation Decisions: "the stack's base URL: unset means the stub, so dev and
# test environments make no network call at all rather than failing obscurely."
CONFIG_PARAM_STACK_BASE_URL = 'hosting_admin.stack_base_url'
CONFIG_PARAM_STACK_AWS_REGION = 'hosting_admin.stack_aws_region'

# The domain suffix (e.g. "method.factory1.io") this Platform instance's configured foundation
# deployment issues Trial Orgs under - combined with a Trial Org's own dns_subdomain_label to
# resolve the Host header a suspended org's own visitor's browser sends (issue #125,
# controllers/asleep.py, models/ir_http.py). Unchanged by this ticket.
CONFIG_PARAM_DNS_DOMAIN_SUFFIX = 'hosting_admin.dns_domain_suffix'

# The two invitation paths ADR-0026 describes, shared with crm_methodology's action_issue_trial
# (the only other place this needs to be validated against) so the two never drift independently.
INVITE_TYPES = [
    ('targeted', "Targeted Invite"),
    ('open', "Open Invite Link"),
]

# Fields mirrored from the stack's own OrgSchema (docs/adr/0034: "a read-only projection it never
# authors") - never set directly by a caller, only ever overwritten wholesale by
# _write_from_stack() from what the stack itself just returned. Shared by create()/write()'s own
# guard and by _write_from_stack() so the two can never drift on which fields that covers.
_MIRRORED_FIELDS = (
    'state', 'stack_org_id', 'seats_used', 'dns_subdomain_label', 'expiry_date', 'last_job_id',
    'last_job_action', 'last_job_status', 'last_job_error', 'last_activity_at',
    'snapshot_retention_until',
)


class HostingTrialOrg(models.Model):
    # Named 'hosting.trial.org' per the ticket's own literal suggestion - see the model's own
    # history (docs/adr/0018) for why it isn't 'hosting.admin.trial.org'. This ticket (#197)
    # changes what the model *is* - a read-only mirror of the administration stack's own record
    # (docs/adr/0034), not the authoritative Trial Org - without renaming it, so every existing
    # caller (crm_methodology's crm_lead.py) keeps calling the same model by the same name.
    _name = 'hosting.trial.org'
    _description = "Trial Org (mirrored from the administration stack)"
    _order = 'create_date desc'

    name = fields.Char(string="Org Name", required=True)
    prospect_domain = fields.Char(
        required=True,
        help="The prospect's email domain this Trial Org is provisioned for. Set once, at "
             "issuance - the stack (docs/adr/0034) is what actually enforces it against every "
             "Seat invite from here on.",
    )
    dns_subdomain_label = fields.Char(
        string="DNS Label", readonly=True,
        help="DNS label this Trial Org's instance is reachable under - mirrored from the stack, "
             "which derives or validates it (docs/adr/0034); never set locally.",
    )
    seat_cap = fields.Integer(
        string="Seat Cap", required=True, default=5,
        help="Number of Seats available on this Trial Org, set at issuance. The stack (docs/"
             "adr/0034) enforces the system-wide seat cap and every per-Seat rule from here on.",
    )
    seats_used = fields.Integer(
        string="Seats Used", readonly=True,
        help="Mirrored from the stack (docs/adr/0034) - never authoritative here.",
    )
    invite_type = fields.Selection(
        INVITE_TYPES, default='targeted', required=True)
    state = fields.Selection([
        ('issued', "Issued"),
        ('active', "Active"),
        ('suspended', "Suspended"),
        ('destroyed', "Destroyed"),
    ], default='issued', required=True, readonly=True, copy=False,
        help="Mirrored from the stack (docs/adr/0034), which is the sole authority for this "
             "Trial Org's lifecycle - Odoo never decides a transition from this cached value.",
    )
    expiry_date = fields.Date(
        readonly=True,
        help="The date Auto-Destroy fires for this Trial Org, absent an Extension. Mirrored "
             "from the stack, which sets it at issuance and moves it on Extension (#312).",
    )

    # ADR-0019's job identity, mirrored (docs/adr/0034) rather than tracked locally - the stack
    # is what actually starts/polls the underlying provisioning job.
    last_job_id = fields.Char(copy=False, readonly=True)
    last_job_action = fields.Char(copy=False, readonly=True)
    last_job_status = fields.Selection([
        ('running', "Running"),
        ('succeeded', "Succeeded"),
        ('failed', "Failed"),
    ], copy=False, readonly=True)
    last_job_error = fields.Text(copy=False, readonly=True)
    # Odoo's own clock, not mirrored: the moment *this instance* last called issue/wake on the
    # stack (the stack's own OrgSchema carries no job-start timestamp for Odoo to mirror instead).
    # controllers/asleep.py's Wake-Up progress estimate is the only reader.
    last_job_started_at = fields.Datetime(copy=False, readonly=True)

    last_activity_at = fields.Datetime(
        readonly=True, copy=False,
        help="Mirrored from the stack's own idle-suspend clock (docs/adr/0034).",
    )
    snapshot_retention_until = fields.Date(
        readonly=True, copy=False,
        help="Mirrored from the stack, set on every destroy (docs/adr/0034).",
    )

    # The stack's own identity for this org (docs/adr/0034, docs/adr/0036) - every call this
    # model makes to HostingStackClient after creation targets this id, never a locally-derived
    # one. Blank only for the brief in-memory window between super().create() being about to run
    # and this same create() call finishing (never observable from outside this method).
    stack_org_id = fields.Char(readonly=True, copy=False, index=True)

    _seat_cap_positive = models.Constraint(
        'CHECK(seat_cap > 0)',
        "Seat cap must be a positive number.",
    )
    _stack_org_id_unique = models.Constraint(
        'unique(stack_org_id)',
        "This stack org id is already mirrored by another Trial Org record.",
    )

    def _get_stack_client(self):
        """Return the `HostingStackClient` implementation to call: `RealHostingStackClient`
        once a stack is configured (CONFIG_PARAM_STACK_BASE_URL), `StubHostingStackClient`
        otherwise - dev/test environments, and any environment before the production cutover
        completes (this ticket's Sequencing note). Tests override this method directly to inject
        a recording fake."""
        ICP = self.env['ir.config_parameter'].sudo()
        base_url = ICP.get_param(CONFIG_PARAM_STACK_BASE_URL)
        if not base_url:
            return StubHostingStackClient()
        return RealHostingStackClient(
            base_url=base_url, region_name=ICP.get_param(CONFIG_PARAM_STACK_AWS_REGION))

    @api.model_create_multi
    def create(self, vals_list):
        """Issue a Trial Org: call the stack's own create_org for each vals dict, then persist
        the mirrored fields the stack returned alongside the caller's own input. Rejects a
        caller-supplied mirrored field (`state`, `stack_org_id`, ...) unless the call is already
        elevated via `sudo()` - see write() below for why this checks `self.env.su` rather than
        a context flag."""
        if not self.env.su:
            for vals in vals_list:
                for field_name in _MIRRORED_FIELDS:
                    if field_name in vals:
                        raise AccessError(_(
                            "%(field)s cannot be set directly; it is only ever mirrored from "
                            "the administration stack.", field=field_name))
        client = self._get_stack_client()
        # default_get(), not each field's own bare default value: a caller may omit seat_cap
        # entirely and still expect this model's own default (5) to apply, same as an ordinary
        # ORM create() would - vals.get('seat_cap') alone would instead send None to the stack,
        # which create_org() would forward as a literal null seatsTotal.
        defaults = self.default_get(['seat_cap', 'invite_type'])
        resolved_vals_list = []
        for vals in vals_list:
            org = client.create_org(
                name=vals.get('name'),
                domain=vals.get('prospect_domain'),
                seat_cap=vals.get('seat_cap', defaults.get('seat_cap')),
                invite_type=vals.get('invite_type', defaults.get('invite_type')) or 'targeted',
                dns_subdomain_label=vals.get('dns_subdomain_label'),
            )
            resolved_vals_list.append({**vals, **org})
        return super().create(resolved_vals_list)

    def write(self, vals):
        """Reject a caller-supplied mirrored field unless the call is already elevated via
        `sudo()` (as every `_write_from_stack()` caller in this class is, below).

        This checks `self.env.su` rather than a context flag deliberately: `context` is a plain
        caller-supplied dict on every ORM/RPC call (`with_context()` is public API, and RPC's
        `execute_kw` takes a `context` kwarg directly from the client), so gating on a context
        key can be forged by any caller with ordinary write access to this model and defeats the
        guard entirely (the same reasoning `crm_lead.py`'s own `trial_org_id` guard documents).
        `env.su` can only become true via an internal `.sudo()` call, which no RPC client can
        inject."""
        if not self.env.su:
            for field_name in _MIRRORED_FIELDS:
                if field_name in vals:
                    raise AccessError(_(
                        "%(field)s cannot be set directly; it is only ever mirrored from the "
                        "administration stack.", field=field_name))
        return super().write(vals)

    def _write_from_stack(self, org, extra_vals=None):
        """Persist a `HostingStackClient` response dict onto this record's own mirrored fields -
        the one path every lifecycle action and sync below writes through, so the mapping from
        the stack's response to this model's fields exists in exactly one place."""
        self.ensure_one()
        vals = {field_name: org[field_name] for field_name in _MIRRORED_FIELDS if field_name in org}
        if extra_vals:
            vals.update(extra_vals)
        self.sudo().write(vals)

    def action_issue(self):
        """Issue this Trial Org: issued -> active, via the stack (docs/adr/0034)."""
        self.ensure_one()
        org = self._get_stack_client().issue(self.stack_org_id)
        self._write_from_stack(org, {'last_job_started_at': fields.Datetime.now()})

    def action_suspend(self):
        """Suspend this Trial Org's compute: active -> suspended, via the stack."""
        self.ensure_one()
        org = self._get_stack_client().suspend(self.stack_org_id)
        self._write_from_stack(org, {'last_job_started_at': fields.Datetime.now()})

    def action_wake(self):
        """Wake this Trial Org's compute back up: suspended -> active, via the stack. Called by
        an operator's own backend button, and by controllers/asleep.py's Wake Up button on
        behalf of an anonymous visitor to a suspended org's own hostname."""
        self.ensure_one()
        org = self._get_stack_client().wake(self.stack_org_id)
        self._write_from_stack(org, {'last_job_started_at': fields.Datetime.now()})

    def action_destroy(self):
        """Tear this Trial Org down: -> destroyed, via the stack."""
        self.ensure_one()
        org = self._get_stack_client().destroy(self.stack_org_id)
        self._write_from_stack(org, {'last_job_started_at': fields.Datetime.now()})

    def action_extend(self, additional_days):
        """Push this Trial Org's expiry_date out by additional_days (#312), via the stack.
        Extension's own authorisation - the sales-methodology qualification gate - is entirely
        `crm_lead.action_extend_trial`'s concern (docs/adr/0034: "the stack exposes the
        extension write; Odoo is the only actor permitted to invoke it"); this method performs
        the write once that caller has already decided to allow it."""
        self.ensure_one()
        if not isinstance(additional_days, int) or additional_days <= 0:
            raise UserError(_("Additional days must be a positive whole number."))
        org = self._get_stack_client().extend(self.stack_org_id, additional_days)
        self._write_from_stack(org)

    def action_sync_from_stack(self):
        """Refresh this Trial Org's mirrored fields from the stack's own current record -
        settling a running job to succeeded/failed first (`check_status`, a safe no-op when
        nothing is running) so this doesn't just re-read a stale snapshot. Available as a manual
        button and as the light periodic sync `_cron_sync_from_stack` below runs (this ticket's
        Implementation Decisions: "refreshed on read and by a light periodic sync")."""
        for trial_org in self:
            client = trial_org._get_stack_client()
            client.check_status(trial_org.stack_org_id)
            org = client.get_org(trial_org.stack_org_id)
            trial_org._write_from_stack(org)

    def _cron_sync_from_stack(self):
        """Scheduled action: lightly refresh every Trial Org that isn't already `destroyed` (a
        terminal state the stack itself never moves on from) - this ticket's Implementation
        Decisions: mirrored state is "refreshed on read and by a light periodic sync"."""
        trial_orgs = self.search([('state', '!=', 'destroyed')])
        for trial_org in trial_orgs:
            try:
                trial_org.action_sync_from_stack()
            except UserError:
                # An unreachable stack must not stop this cron from syncing every other Trial
                # Org in the same run - the next scheduled run tries again.
                continue

    @api.model
    def _trial_org_for_host(self, host):
        """Resolve the Trial Org (if any) whose `dns_subdomain_label` matches `host` under the
        configured domain suffix (`hosting_admin.dns_domain_suffix`, issue #125) - unchanged from
        before this ticket: controllers/asleep.py and IrHttp's host-based redirect (ADR-0030)
        both still resolve against this same mirrored field. Returns an empty recordset (never
        raises) for a host that doesn't end in the configured suffix, an unknown label, or when
        the suffix itself isn't configured."""
        if not host:
            return self.browse()
        domain_suffix = self.env['ir.config_parameter'].sudo().get_param(
            CONFIG_PARAM_DNS_DOMAIN_SUFFIX)
        if not domain_suffix or not host.endswith(f'.{domain_suffix}'):
            return self.browse()
        label = host[:-(len(domain_suffix) + 1)]
        if not label:
            return self.browse()
        return self.sudo().search([('dns_subdomain_label', '=', label)], limit=1)
