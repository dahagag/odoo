from datetime import date

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting.models.org_registration import (
    CONFIG_PARAM_ORG_ID,
    CONFIG_PARAM_ORG_TOKEN,
    CONFIG_PARAM_STACK_BASE_URL,
)
from odoo.addons.hosting.models.org_registration_client import (
    OrgRegistrationClient,
    RealOrgRegistrationClient,
    StubOrgRegistrationClient,
)


class _FakeOrgRegistrationClient(OrgRegistrationClient):
    """No network call of any kind - injected in place of `_get_org_registration_client()`'s
    own choice, mirroring `RecordingStackClient`'s role in hosting_admin's own integration
    tests."""

    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = 0

    def fetch(self):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


@tagged('post_install', '-at_install')
class TestOrgRegistrationClientSelection(TransactionCase):

    def test_stub_is_selected_when_no_stack_base_url_is_configured(self):
        self.env['ir.config_parameter'].sudo().set_param(CONFIG_PARAM_STACK_BASE_URL, False)
        client = self.env['hosting.org.registration']._get_org_registration_client()
        self.assertIsInstance(client, StubOrgRegistrationClient)

    def test_real_client_is_selected_once_fully_configured(self):
        ICP = self.env['ir.config_parameter'].sudo()
        ICP.set_param(CONFIG_PARAM_STACK_BASE_URL, "https://stack.example")
        ICP.set_param(CONFIG_PARAM_ORG_ID, "org-1")
        ICP.set_param(CONFIG_PARAM_ORG_TOKEN, "sekret")
        client = self.env['hosting.org.registration']._get_org_registration_client()
        self.assertIsInstance(client, RealOrgRegistrationClient)

    def test_configuring_a_base_url_without_an_org_id_or_token_raises_a_clear_user_error(self):
        ICP = self.env['ir.config_parameter'].sudo()
        ICP.set_param(CONFIG_PARAM_STACK_BASE_URL, "https://stack.example")
        ICP.set_param(CONFIG_PARAM_ORG_ID, False)
        ICP.set_param(CONFIG_PARAM_ORG_TOKEN, False)
        with self.assertRaises(UserError):
            self.env['hosting.org.registration']._get_org_registration_client()


@tagged('post_install', '-at_install')
class TestOrgRegistrationSync(TransactionCase):

    def _inject_client(self, client):
        """Override `_get_org_registration_client` for the duration of this test only
        (`self.patch` restores it automatically on tearDown) - the same seam
        `_get_stack_client`'s own tests use in hosting_admin."""
        RegistrationModel = type(self.env['hosting.org.registration'])
        self.patch(RegistrationModel, '_get_org_registration_client', lambda self_: client)

    def test_sync_creates_the_singleton_from_a_successful_fetch(self):
        client = _FakeOrgRegistrationClient(result={
            'name': "Acme Trial",
            'prospect_domain': "acme.example",
            'seats_used': 2,
            'seat_cap': 5,
            'expiry_date': date(2026, 9, 30),
        })
        self._inject_client(client)

        registration = self.env['hosting.org.registration']._sync_from_stack()

        self.assertEqual(registration.name, "Acme Trial")
        self.assertEqual(registration.seats_used, 2)
        self.assertTrue(registration.fetched_at)
        self.assertFalse(registration.fetch_error)

    def test_sync_reuses_the_existing_singleton_rather_than_creating_a_second_record(self):
        client = _FakeOrgRegistrationClient(result={
            'name': "Acme Trial", 'prospect_domain': "acme.example",
            'seats_used': 2, 'seat_cap': 5, 'expiry_date': False,
        })
        self._inject_client(client)

        first = self.env['hosting.org.registration']._sync_from_stack()
        second = self.env['hosting.org.registration']._sync_from_stack()

        self.assertEqual(first.id, second.id)
        self.assertEqual(self.env['hosting.org.registration'].search_count([]), 1)

    def test_a_failed_sync_leaves_previously_synced_values_in_place_and_records_the_error(self):
        good_client = _FakeOrgRegistrationClient(result={
            'name': "Acme Trial", 'prospect_domain': "acme.example",
            'seats_used': 2, 'seat_cap': 5, 'expiry_date': False,
        })
        self._inject_client(good_client)
        registration = self.env['hosting.org.registration']._sync_from_stack()
        fetched_at_before = registration.fetched_at

        failing_client = _FakeOrgRegistrationClient(error=UserError("stack unreachable"))
        self._inject_client(failing_client)
        self.env['hosting.org.registration']._sync_from_stack()
        registration.invalidate_recordset()

        # A stated as-of time, not a blank panel or a silently-stale value (issue #201's User
        # Story #5 and Implementation Decisions): the last-known-good values and their fetch
        # time are untouched, and the failure is recorded separately.
        self.assertEqual(registration.name, "Acme Trial")
        self.assertEqual(registration.fetched_at, fetched_at_before)
        self.assertIn("stack unreachable", registration.fetch_error)

    def test_a_failed_first_ever_sync_still_creates_a_record_stating_the_reason(self):
        # Before this org's own token is provisioned, or during a transient outage on first
        # boot, there must be a stated reason rather than an empty list (issue #201's User
        # Story #5) - not a fetch that silently does nothing. Starts from no record at all,
        # unlike a real freshly-installed instance where _post_init_sync_org_registration
        # already ran once (successfully, against the stub) before this test's own setup.
        self.env['hosting.org.registration'].search([]).unlink()
        self._inject_client(_FakeOrgRegistrationClient(error=UserError("no token yet")))

        registration = self.env['hosting.org.registration']._sync_from_stack()

        self.assertFalse(registration.fetched_at)
        self.assertIn("no token yet", registration.fetch_error)

    def test_a_half_configured_instance_records_a_stated_error_instead_of_raising(self):
        # A base_url set without an org_id/token yet (e.g. before this org's own token is
        # provisioned) must degrade the same way an unreachable stack does - not raise straight
        # through _cron_sync_from_stack and kill that cron run (issue #201's User Story #5).
        ICP = self.env['ir.config_parameter'].sudo()
        ICP.set_param(CONFIG_PARAM_STACK_BASE_URL, "https://stack.example")
        ICP.set_param(CONFIG_PARAM_ORG_ID, False)
        ICP.set_param(CONFIG_PARAM_ORG_TOKEN, False)

        registration = self.env['hosting.org.registration']._sync_from_stack()

        self.assertTrue(registration.fetch_error)

    def test_cron_sync_calls_through_to_sync_from_stack(self):
        client = _FakeOrgRegistrationClient(result={
            'name': "Acme Trial", 'prospect_domain': "acme.example",
            'seats_used': 0, 'seat_cap': 5, 'expiry_date': False,
        })
        self._inject_client(client)

        self.env['hosting.org.registration']._cron_sync_from_stack()

        self.assertEqual(client.calls, 1)
