import hashlib
import hmac
import json
import logging

from werkzeug.exceptions import BadRequest, Forbidden

from odoo import http
from odoo.http import request
from odoo.tools import consteq

from odoo.addons.hosting_admin.models.trial_org import (
    TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE,
    trial_org_log_bus_channel,
)

_logger = logging.getLogger(__name__)

# ir.config_parameter key holding the shared secret this controller's HMAC verification is keyed
# on - the Odoo-side half of the same secret infra/foundation/lambda_src/log_forwarder/handler.py
# reads from SSM (HMAC_SECRET_SSM_PARAMETER) and signs every forwarded batch with (docs/adr/0023).
CONFIG_PARAM_LOG_WEBHOOK_HMAC_SECRET = 'hosting_admin.log_webhook_hmac_secret'

SIGNATURE_HEADER = 'X-Hosting-Signature'


class HostingLogWebhookController(http.Controller):
    """Receives CloudWatch log batches forwarded by the shared log-forwarder Lambda
    (infra/foundation/lambda_src/log_forwarder/handler.py, docs/adr/0023) and republishes them
    onto Odoo's own bus, scoped to the originating Trial Org's own log channel."""

    @http.route('/hosting_admin/log_webhook', type='http', auth='public', methods=['POST'], csrf=False)
    def log_webhook(self, **kwargs):
        body = request.httprequest.get_data()
        if not self._verify_signature(body, request.httprequest.headers.get(SIGNATURE_HEADER)):
            raise Forbidden()
        try:
            payload = json.loads(body)
        except ValueError as exc:
            message = "Invalid JSON payload."
            raise BadRequest(message) from exc
        self._publish(payload)
        return request.make_json_response({'forwarded': True})

    def _verify_signature(self, body, signature_header):
        """Reject unless ``signature_header`` is the hex HMAC-SHA256 digest of ``body`` under the
        configured shared secret - the same Stripe/GitHub-style webhook pattern docs/adr/0023
        calls for. No secret configured means nothing can ever be verified, so that fails closed
        too rather than accepting every request."""
        secret = request.env['ir.config_parameter'].sudo().get_param(CONFIG_PARAM_LOG_WEBHOOK_HMAC_SECRET)
        if not secret or not signature_header:
            return False
        expected_signature = hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
        return consteq(expected_signature, signature_header)

    def _publish(self, payload):
        """Publish ``payload``'s log lines onto the originating Trial Org's bus channel. A
        payload naming an unknown/already-destroyed Trial Org, an unparsable id, or carrying no
        events at all (e.g. a stray retry) is silently dropped rather than erroring - the Lambda
        has no Trial-Org-level context to act on a rejection with, and a transient gap here is
        harmless since the log viewer has no history to catch up on regardless."""
        events = payload.get('events') or []
        if not events:
            return
        try:
            trial_org_id = int(payload.get('trial_org_id'))
        except (TypeError, ValueError):
            _logger.warning(
                "Log webhook payload names an invalid trial_org_id: %r", payload.get('trial_org_id'))
            return
        trial_org = request.env['hosting.trial.org'].sudo().browse(trial_org_id)
        if not trial_org.exists():
            _logger.warning("Log webhook payload names an unknown Trial Org id %s", trial_org_id)
            return
        try:
            lines = [
                {'timestamp': event.get('timestamp'), 'message': event.get('message')}
                for event in events
            ]
        except AttributeError:
            _logger.warning(
                "Log webhook payload for Trial Org %s carries a malformed event.", trial_org_id)
            return
        # trial_org_id rides along in the message itself, not just the channel it's published
        # on: bus_service.js's subscribe() dispatches by notification type alone, on a single
        # session-wide event bus shared by every open tab (docs/adr/0023's viewer has no
        # per-tab isolation otherwise) - so a browser with two Trial Orgs' log viewers open at
        # once would otherwise have each widget's handler fire for the other's lines too. The
        # widget checks this field before appending anything to its own state.
        request.env['bus.bus']._sendone(
            trial_org_log_bus_channel(trial_org.id), TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE, {
                'trial_org_id': trial_org.id,
                'lines': lines,
            })
