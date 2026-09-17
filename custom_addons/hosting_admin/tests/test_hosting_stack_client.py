import json
from datetime import timedelta
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import BaseCase, tagged

from odoo.addons.hosting_admin.models.hosting_stack_client import (
    RealHostingStackClient,
    StubHostingStackClient,
)


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self._json_body = json_body or {}
        self.content = json.dumps(self._json_body).encode('utf-8') if json_body is not None else b''

    def raise_for_status(self):
        if self.status_code >= 400:
            error_message = f"{self.status_code} error"
            raise Exception(error_message)

    def json(self):
        return self._json_body


class _FakeSession:
    """No network call of any kind - `test`/dev's own no-network guarantee (this ticket's Testing
    Decisions) - a plain in-process fake standing in for `requests.Session`."""

    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def request(self, method, url, data=None, headers=None, timeout=None):
        self.calls.append({'method': method, 'url': url, 'data': data, 'headers': headers})
        if self.error:
            raise self.error
        return self.response


def _org_json(**overrides):
    return {
        'orgId': 'org-1',
        'type': 'trial',
        'state': 'issued',
        'region': 'us-east-1',
        'dnsSubdomainLabel': 'acme',
        'name': "Acme Trial",
        'domain': 'acme.example',
        'seatsUsed': 0,
        'seatsTotal': 5,
        'inviteType': 'targeted',
        **overrides,
    }


@tagged('post_install', '-at_install')
class TestStubHostingStackClient(BaseCase):
    """No test here re-tests lifecycle rules (seat caps, domain guards, transition legality) -
    those belong to the stack itself (this ticket's Testing Decisions). This only proves the stub
    shape is internally consistent, since hosting.trial.org's own tests inject it as a no-network
    stand-in."""

    def test_create_then_issue_round_trips_through_the_same_org_id(self):
        client = StubHostingStackClient()
        created = client.create_org(name="Acme", domain="acme.example", seat_cap=5, invite_type='targeted')
        self.assertEqual(created['state'], 'issued')

        issued = client.issue(created['stack_org_id'])

        self.assertEqual(issued['stack_org_id'], created['stack_org_id'])
        self.assertEqual(issued['state'], 'active')
        self.assertEqual(issued['last_job_action'], 'issue')
        # 'running', not 'succeeded': no real job exists behind a stub-backed org for
        # check_status to ever settle - matches controllers/asleep.py's own expectations
        # (WAKING_PHASE_TIMEOUT_MINUTES exists specifically for a job that never resolves).
        self.assertEqual(issued['last_job_status'], 'running')

    def test_full_lifecycle(self):
        client = StubHostingStackClient()
        org_id = client.create_org(name="Acme", domain="acme.example", seat_cap=5, invite_type='targeted')['stack_org_id']

        self.assertEqual(client.issue(org_id)['state'], 'active')
        self.assertEqual(client.suspend(org_id)['state'], 'suspended')
        self.assertEqual(client.wake(org_id)['state'], 'active')
        self.assertEqual(client.destroy(org_id)['state'], 'destroyed')

    def test_extend_pushes_expiry_date_out(self):
        client = StubHostingStackClient()
        org_id = client.create_org(name="Acme", domain="acme.example", seat_cap=5, invite_type='targeted')['stack_org_id']
        before = client.get_org(org_id)['expiry_date']

        extended = client.extend(org_id, 10)

        self.assertEqual(extended['expiry_date'], before + timedelta(days=10))

    def test_get_org_on_an_unknown_id_raises_user_error(self):
        client = StubHostingStackClient()
        with self.assertRaises(UserError):
            client.get_org('does-not-exist')

    def test_explicit_dns_subdomain_label_is_used_as_is(self):
        client = StubHostingStackClient()
        created = client.create_org(
            name="Acme", domain="acme.example", seat_cap=5, invite_type='targeted',
            dns_subdomain_label='acme-explicit',
        )
        self.assertEqual(created['dns_subdomain_label'], 'acme-explicit')


@tagged('post_install', '-at_install')
class TestRealHostingStackClient(BaseCase):

    def test_requires_a_base_url(self):
        with self.assertRaises(ValueError):
            RealHostingStackClient(base_url=None)

    def test_create_org_maps_the_response_to_snake_case(self):
        session = _FakeSession(response=_FakeResponse(201, _org_json()))
        client = RealHostingStackClient(base_url="https://stack.example", session=session)
        with patch.object(RealHostingStackClient, '_sign', side_effect=lambda method, url, body, headers: headers):
            org = client.create_org(name="Acme Trial", domain="acme.example", seat_cap=5, invite_type='targeted')

        self.assertEqual(org['stack_org_id'], 'org-1')
        self.assertEqual(org['state'], 'issued')
        self.assertEqual(org['seat_cap'], 5)
        call = session.calls[0]
        self.assertEqual(call['method'], 'POST')
        self.assertTrue(call['url'].endswith('/v1/admin/orgs'))
        self.assertIn('Idempotency-Key', call['headers'])
        body = json.loads(call['data'])
        self.assertEqual(body['seatsTotal'], 5)

    def test_extend_sends_additional_days(self):
        session = _FakeSession(response=_FakeResponse(200, _org_json(expiryDate='2026-01-01T00:00:00Z')))
        client = RealHostingStackClient(base_url="https://stack.example", session=session)
        with patch.object(RealHostingStackClient, '_sign', side_effect=lambda method, url, body, headers: headers):
            org = client.extend('org-1', 14)

        self.assertEqual(org['expiry_date'].isoformat(), '2026-01-01')
        body = json.loads(session.calls[0]['data'])
        self.assertEqual(body['additionalDays'], 14)

    def test_an_unreachable_stack_raises_a_clear_user_error_not_a_traceback(self):
        session = _FakeSession(error=ConnectionError("connection refused"))
        client = RealHostingStackClient(base_url="https://stack.example", session=session)
        with patch.object(RealHostingStackClient, '_sign', side_effect=lambda method, url, body, headers: headers):
            with self.assertRaises(UserError):
                client.get_org('org-1')

    def test_a_non_2xx_response_raises_a_clear_user_error(self):
        session = _FakeSession(response=_FakeResponse(404, {'title': 'No such org'}))
        client = RealHostingStackClient(base_url="https://stack.example", session=session)
        with patch.object(RealHostingStackClient, '_sign', side_effect=lambda method, url, body, headers: headers):
            with self.assertRaises(UserError):
                client.get_org('org-1')

    def test_a_bodyless_2xx_response_raises_a_clear_user_error_not_a_key_error(self):
        # CodeRabbit, PR #314: `_call` returns `{}` for a bodyless 2xx (e.g. an unexpected 204
        # from a misbehaving proxy in front of the real deployment) - _org_from_json must not let
        # that reach a bare `payload['orgId']` KeyError, which _cron_sync_from_stack's own
        # `except UserError` wouldn't catch.
        session = _FakeSession(response=_FakeResponse(200, json_body=None))
        client = RealHostingStackClient(base_url="https://stack.example", session=session)
        with patch.object(RealHostingStackClient, '_sign', side_effect=lambda method, url, body, headers: headers):
            with self.assertRaises(UserError):
                client.get_org('org-1')
