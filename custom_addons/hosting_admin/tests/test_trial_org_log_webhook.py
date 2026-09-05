import hashlib
import hmac
import json

from odoo.tests import HttpCase, tagged
from odoo.tools import mute_logger

from odoo.addons.hosting_admin.controllers.log_webhook import (
    CONFIG_PARAM_LOG_WEBHOOK_HMAC_SECRET,
)
from odoo.addons.hosting_admin.models.trial_org import (
    TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE,
    trial_org_log_bus_channel,
)

WEBHOOK_URL = '/hosting_admin/log_webhook'
SECRET = "test-shared-secret"


@tagged('post_install', '-at_install')
class TestTrialOrgLogWebhook(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })
        cls.env['ir.config_parameter'].sudo().set_param(
            CONFIG_PARAM_LOG_WEBHOOK_HMAC_SECRET, SECRET)

    def _body(self, **overrides):
        payload = {
            'trial_org_id': str(self.trial_org.id),
            'log_group': f'/hosting/trial-orgs/{self.trial_org.id}',
            'log_stream': 'i-0123456789abcdef0',
            'events': [{'timestamp': 1700000000000, 'message': "hello from the trial org"}],
        }
        payload.update(overrides)
        return json.dumps(payload).encode('utf-8')

    @staticmethod
    def _sign(body, secret=SECRET):
        return hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()

    def _post(self, body, signature):
        headers = {'Content-Type': 'application/json'}
        if signature is not None:
            headers['X-Hosting-Signature'] = signature
        return self.url_open(WEBHOOK_URL, data=body, headers=headers)

    def _last_bus_message(self, channel):
        bus_message = self.env['bus.bus'].sudo().search([
            ('channel', '=', json.dumps([self.env.cr.dbname, channel], separators=(',', ':'))),
        ], order='id desc', limit=1)
        self.assertTrue(bus_message, f"No bus.bus row found for channel {channel!r}")
        return json.loads(bus_message.message)

    def test_valid_signature_publishes_to_the_trial_orgs_channel(self):
        body = self._body()
        response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)

        channel = trial_org_log_bus_channel(self.trial_org.id)
        message = self._last_bus_message(channel)
        self.assertEqual(message['type'], TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE)
        self.assertEqual(message['payload'], {
            'trial_org_id': self.trial_org.id,
            'lines': [{'timestamp': 1700000000000, 'message': "hello from the trial org"}],
        })

    @mute_logger('werkzeug')
    def test_missing_signature_header_is_rejected(self):
        response = self._post(self._body(), None)
        self.assertEqual(response.status_code, 403)

    @mute_logger('werkzeug')
    def test_wrong_signature_is_rejected(self):
        body = self._body()
        response = self._post(body, self._sign(body, secret="wrong-secret"))
        self.assertEqual(response.status_code, 403)

    @mute_logger('werkzeug')
    def test_signature_over_a_tampered_body_is_rejected(self):
        body = self._body()
        signature = self._sign(body)
        tampered_body = self._body(events=[{'timestamp': 0, 'message': "tampered"}])
        response = self._post(tampered_body, signature)
        self.assertEqual(response.status_code, 403)

    @mute_logger('werkzeug')
    def test_no_secret_configured_rejects_every_request(self):
        self.env['ir.config_parameter'].sudo().set_param(CONFIG_PARAM_LOG_WEBHOOK_HMAC_SECRET, False)
        body = self._body()
        response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 403)

    def test_unknown_trial_org_id_is_a_silent_no_op(self):
        unknown_id = self.trial_org.id + 1000000
        body = self._body(trial_org_id=str(unknown_id))
        with mute_logger('odoo.addons.hosting_admin.controllers.log_webhook'):
            response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.env['bus.bus'].sudo().search([
            ('channel', '=', json.dumps(
                [self.env.cr.dbname, trial_org_log_bus_channel(unknown_id)], separators=(',', ':'))),
        ]))

    def test_empty_events_is_a_no_op(self):
        body = self._body(events=[])
        response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.env['bus.bus'].sudo().search([
            ('channel', '=', json.dumps(
                [self.env.cr.dbname, trial_org_log_bus_channel(self.trial_org.id)], separators=(',', ':'))),
        ]))

    def test_malformed_event_is_a_silent_no_op(self):
        # A well-formed batch always carries dicts (infra/foundation/lambda_src/log_forwarder/
        # handler.py's own payload shape) - this guards against a corrupted/adversarial batch
        # still bearing a valid signature (e.g. the shared secret leaked) turning into a 500
        # instead of the same "nothing to show" outcome as any other unusable payload.
        body = self._body(events=["not a dict"])
        with mute_logger('odoo.addons.hosting_admin.controllers.log_webhook'):
            response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.env['bus.bus'].sudo().search([
            ('channel', '=', json.dumps(
                [self.env.cr.dbname, trial_org_log_bus_channel(self.trial_org.id)], separators=(',', ':'))),
        ]))

    def test_top_level_json_array_is_a_silent_no_op(self):
        # json.loads() accepts any JSON value, not just objects - a validly-signed top-level
        # array must be dropped rather than raising AttributeError on payload.get().
        body = json.dumps([1, 2, 3]).encode('utf-8')
        with mute_logger('odoo.addons.hosting_admin.controllers.log_webhook'):
            response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)

    def test_non_list_events_is_a_silent_no_op(self):
        # A truthy non-list `events` value (e.g. a bare integer) must be dropped rather than
        # raising TypeError when iterated.
        body = self._body(events=1)
        with mute_logger('odoo.addons.hosting_admin.controllers.log_webhook'):
            response = self._post(body, self._sign(body))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.env['bus.bus'].sudo().search([
            ('channel', '=', json.dumps(
                [self.env.cr.dbname, trial_org_log_bus_channel(self.trial_org.id)], separators=(',', ':'))),
        ]))
