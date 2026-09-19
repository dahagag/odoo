import inspect
import json

from odoo.exceptions import UserError
from odoo.tests import BaseCase, tagged

from odoo.addons.hosting.models.org_registration_client import (
    RealOrgRegistrationClient,
    StubOrgRegistrationClient,
)


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self._json_body = json_body or {}
        self.content = json.dumps(self._json_body).encode('utf-8') if json_body is not None else b''

    def json(self):
        return self._json_body


class _FakeSession:
    """No network call of any kind - this ticket's own no-network testability requirement
    (issue #201's User Story #11) - a plain in-process fake standing in for `requests.Session`."""

    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def request(self, method, url, headers=None, timeout=None):
        self.calls.append({'method': method, 'url': url, 'headers': headers})
        if self.error:
            raise self.error
        return self.response


def _registration_json(**overrides):
    return {
        'orgId': 'org-1',
        'type': 'trial',
        'state': 'active',
        'name': "Acme Trial",
        'domain': 'acme.example',
        'seatsUsed': 3,
        'seatsTotal': 5,
        'expiryDate': '2026-09-30T00:00:00Z',
        **overrides,
    }


@tagged('post_install', '-at_install')
class TestOrgRegistrationClientContract(BaseCase):

    def test_fetch_takes_no_argument(self):
        # Issue #201's Further Notes: "the token identifies the org; the request does not name
        # one" - there is no parameter here for a caller to tamper with to ask about another
        # org, enforced structurally by fetch()'s own signature rather than by a runtime check.
        parameters = inspect.signature(RealOrgRegistrationClient.fetch).parameters
        self.assertEqual(list(parameters), ['self'])
        parameters = inspect.signature(StubOrgRegistrationClient.fetch).parameters
        self.assertEqual(list(parameters), ['self'])


@tagged('post_install', '-at_install')
class TestStubOrgRegistrationClient(BaseCase):

    def test_fetch_returns_a_plausible_registration_with_no_network_call(self):
        client = StubOrgRegistrationClient()
        registration = client.fetch()
        self.assertTrue(registration['name'])
        self.assertTrue(registration['prospect_domain'])
        self.assertGreater(registration['seat_cap'], 0)
        self.assertTrue(registration['expiry_date'])


@tagged('post_install', '-at_install')
class TestRealOrgRegistrationClient(BaseCase):

    def test_requires_a_base_url_org_id_and_token(self):
        with self.assertRaises(ValueError):
            RealOrgRegistrationClient(base_url=None, org_id='org-1', token='tok')
        with self.assertRaises(ValueError):
            RealOrgRegistrationClient(base_url="https://stack.example", org_id=None, token='tok')
        with self.assertRaises(ValueError):
            RealOrgRegistrationClient(base_url="https://stack.example", org_id='org-1', token=None)

    def test_fetch_maps_the_response_to_snake_case_and_sends_the_bearer_token(self):
        session = _FakeSession(response=_FakeResponse(200, _registration_json()))
        client = RealOrgRegistrationClient(
            base_url="https://stack.example", org_id='org-1', token='sekret', session=session)

        registration = client.fetch()

        self.assertEqual(registration['name'], "Acme Trial")
        self.assertEqual(registration['prospect_domain'], 'acme.example')
        self.assertEqual(registration['seats_used'], 3)
        self.assertEqual(registration['seat_cap'], 5)
        self.assertEqual(registration['expiry_date'].isoformat(), '2026-09-30')
        call = session.calls[0]
        self.assertEqual(call['method'], 'GET')
        self.assertTrue(call['url'].endswith('/v1/org/org-1/registration'))
        self.assertEqual(call['headers']['Authorization'], 'Bearer sekret')

    def test_a_client_org_with_no_expiry_date_maps_to_false(self):
        session = _FakeSession(response=_FakeResponse(200, _registration_json(
            type='client', expiryDate=None)))
        client = RealOrgRegistrationClient(
            base_url="https://stack.example", org_id='org-1', token='sekret', session=session)

        registration = client.fetch()

        self.assertFalse(registration['expiry_date'])

    def test_an_unreachable_stack_raises_a_clear_user_error_not_a_traceback(self):
        session = _FakeSession(error=ConnectionError("connection refused"))
        client = RealOrgRegistrationClient(
            base_url="https://stack.example", org_id='org-1', token='sekret', session=session)
        with self.assertRaises(UserError):
            client.fetch()

    def test_a_non_2xx_response_raises_a_clear_user_error(self):
        # e.g. a rotated-out token, or an org token presented for the wrong org - either way
        # the org user must see a stated reason, not a raw HTTP error (issue #201's User Story #5).
        session = _FakeSession(response=_FakeResponse(403, {'title': 'Forbidden'}))
        client = RealOrgRegistrationClient(
            base_url="https://stack.example", org_id='org-1', token='sekret', session=session)
        with self.assertRaises(UserError):
            client.fetch()

    def test_a_bodyless_2xx_response_raises_a_clear_user_error_not_a_key_error(self):
        session = _FakeSession(response=_FakeResponse(200, json_body=None))
        client = RealOrgRegistrationClient(
            base_url="https://stack.example", org_id='org-1', token='sekret', session=session)
        with self.assertRaises(UserError):
            client.fetch()
