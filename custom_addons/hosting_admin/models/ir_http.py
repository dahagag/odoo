from odoo import models
from odoo.http import request

# Routes the asleep-page controller itself owns (controllers/asleep.py) - never redirected, or
# clicking "Wake Up" on the asleep page would just loop back to itself.
ASLEEP_PAGE_ROUTES = frozenset({
    '/hosting_admin/asleep',
    '/hosting_admin/asleep/wake',
    '/hosting_admin/asleep/status',
})


class IrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _dispatch(cls, endpoint):
        """Redirect any request whose Host header names a currently-suspended Trial Org to the
        asleep page (ADR-0030), before the endpoint it actually matched ever runs. This is what
        makes the redirect apply uniformly to every route on that Host - not just one path a
        visitor happens to bookmark - without needing this addon to own or override every route
        another installed addon (e.g. the web client's own `/`, `/web/login`) might otherwise
        serve on the Platform instance's own domain.

        In production this only ever fires on the Platform instance itself, once Route53
        failover has already sent the request here because the Trial Org's own health check is
        failing (i.e. whenever it's suspended) - see ADR-0030 for the DNS side of this."""
        routes = endpoint.routing.get('routes') or ()
        if not ASLEEP_PAGE_ROUTES.intersection(routes):
            host = (request.httprequest.host or '').split(':')[0]
            trial_org = request.env['hosting.trial.org']._trial_org_for_host(host)
            if trial_org and (
                trial_org.state == 'suspended'
                or (
                    trial_org.last_job_action == 'wake'
                    and trial_org.last_job_status == 'running'
                )
            ):
                return request.redirect('/hosting_admin/asleep', code=303)
        return super()._dispatch(endpoint)
