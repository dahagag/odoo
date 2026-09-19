from odoo import _, api, fields, models
from odoo.exceptions import UserError

from .org_registration_client import (
    RealOrgRegistrationClient,
    StubOrgRegistrationClient,
)

# ir.config_parameter keys OrgRegistrationClient is configured from (_get_org_registration_client
# below). Unset base_url (the default for dev/test environments, and any environment before this
# org's own token is provisioned) falls back to StubOrgRegistrationClient - issue #201's
# Implementation Decisions: "no configuration means the stub, so a dev or test instance makes no
# network call." All three are stamped onto the instance at provision time (issue #201's Out of
# Scope: token/org id issuance itself belongs to the lifecycle port, not this addon).
CONFIG_PARAM_STACK_BASE_URL = 'hosting.stack_base_url'
CONFIG_PARAM_ORG_ID = 'hosting.org_id'
CONFIG_PARAM_ORG_TOKEN = 'hosting.org_token'


class HostingOrgRegistration(models.Model):
    # This org's own view of its Trial Org standing (docs/contexts/hosting/CONTEXT.md's Org
    # Registration entry): name, prospect domain, seats used/total, and expiry date. Lives on
    # the Trial Org's own instance. As of issue #201, this is a read-only mirror of the
    # administration stack's own record (docs/adr/0034), refreshed by _sync_from_stack() below -
    # never written to directly, and never authoritative here. A database this addon is
    # installed on holds exactly one such record (one org per instance, org_registration.py's
    # own convention from #112).
    _name = 'hosting.org.registration'
    _description = "Org Registration"
    _order = 'create_date desc'

    name = fields.Char(string="Org Name")
    prospect_domain = fields.Char(string="Domain")
    seats_used = fields.Integer(string="Seats Used", default=0)
    seat_cap = fields.Integer(string="Seat Cap", default=0)
    expiry_date = fields.Date(
        string="Expiry Date",
        help="Absent for a Client Org, which has no Auto-Destroy expiry to count down to "
             "(docs/contexts/hosting/CONTEXT.md).",
    )
    fetched_at = fields.Datetime(
        string="Last Synced", readonly=True, copy=False,
        help="When this record was last successfully refreshed from the administration stack. "
             "A stated as-of time rather than a stale value passed off as current, for the case "
             "the stack is briefly unreachable (issue #201's Implementation Decisions).",
    )
    fetch_error = fields.Text(
        readonly=True, copy=False,
        help="Set when the most recent sync attempt failed; cleared on the next successful one. "
             "Values already on this record (if any) are left as they were, alongside the "
             "fetched_at time they were last confirmed current.",
    )

    def _get_org_registration_client(self):
        """Return the `OrgRegistrationClient` implementation to call: `RealOrgRegistrationClient`
        once a stack is configured (CONFIG_PARAM_STACK_BASE_URL), `StubOrgRegistrationClient`
        otherwise. Tests override this method directly to inject a recording fake."""
        ICP = self.env['ir.config_parameter'].sudo()
        base_url = ICP.get_param(CONFIG_PARAM_STACK_BASE_URL)
        if not base_url:
            return StubOrgRegistrationClient()
        org_id = ICP.get_param(CONFIG_PARAM_ORG_ID)
        token = ICP.get_param(CONFIG_PARAM_ORG_TOKEN)
        if not org_id or not token:
            # Fail clearly here, at configuration time, same reasoning as
            # hosting_admin.HostingTrialOrg._get_stack_client's own region check: a half-
            # configured instance should say so plainly rather than fail deep inside this
            # client's own constructor with a message that names neither this addon nor its
            # actual cause.
            raise UserError(_(
                "%(base_url_param)s is configured but %(org_id_param)s/%(token_param)s is not - "
                "all three are required to reach the administration stack.",
                base_url_param=CONFIG_PARAM_STACK_BASE_URL, org_id_param=CONFIG_PARAM_ORG_ID,
                token_param=CONFIG_PARAM_ORG_TOKEN,
            ))
        return RealOrgRegistrationClient(base_url=base_url, org_id=org_id, token=token)

    @api.model
    def _sync_from_stack(self):
        """Refresh this instance's own Org Registration singleton from the stack. On success,
        every mirrored field is overwritten wholesale and fetch_error is cleared. On failure,
        the previously-synced values (if any) are left untouched and fetch_error is set instead -
        a stated as-of time rather than a blank panel or a value silently going stale unannounced
        (issue #201's User Story #5 and Implementation Decisions)."""
        registration = self.sudo().search([], limit=1)
        if not registration:
            registration = self.sudo().create({})
        client = self._get_org_registration_client()
        try:
            data = client.fetch()
        except UserError as exc:
            registration.fetch_error = str(exc)
            return registration
        registration.write(dict(data, fetched_at=fields.Datetime.now(), fetch_error=False))
        return registration

    @api.model
    def _cron_sync_from_stack(self):
        self._sync_from_stack()
