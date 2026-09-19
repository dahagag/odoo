from lxml import etree

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

# The exact set of fields the Org Registration list view (docs/contexts/hosting/CONTEXT.md:
# "name, domain, seats used/total, expiry date") is allowed to expose - nothing more, nothing
# less.
EXPECTED_LIST_FIELDS = {'name', 'prospect_domain', 'seats_used', 'seat_cap', 'expiry_date'}

# The form view additionally carries fetched_at (the stated as-of time, issue #201's
# Implementation Decisions) and fetch_error (the stated reason on a failed sync, issue #201's
# User Story #5) alongside the list view's own fields.
EXPECTED_FORM_FIELDS = EXPECTED_LIST_FIELDS | {'fetched_at', 'fetch_error'}


@tagged('post_install', '-at_install')
class TestHostingOrgRegistrationView(TransactionCase):

    def _create_fixture(self):
        return self.env['hosting.org.registration'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seats_used': 3,
            'seat_cap': 5,
            'expiry_date': '2026-09-18',
        })

    def _view_field_names(self, view_xml_id):
        view = self.env.ref(view_xml_id)
        arch = etree.fromstring(view.arch)
        return {field.get('name') for field in arch.iter('field')}

    def test_form_view_exposes_exactly_the_expected_fields(self):
        self.assertEqual(
            self._view_field_names('hosting.view_hosting_org_registration_form'),
            EXPECTED_FORM_FIELDS,
        )

    def test_list_view_exposes_exactly_the_expected_fields(self):
        self.assertEqual(
            self._view_field_names('hosting.view_hosting_org_registration_list'),
            EXPECTED_LIST_FIELDS,
        )

    def test_view_renders_values_sourced_from_the_trial_org_fixture(self):
        registration = self._create_fixture()
        self.assertEqual(registration.name, "Acme Trial")
        self.assertEqual(registration.prospect_domain, "acme.example.com")
        self.assertEqual(registration.seats_used, 3)
        self.assertEqual(registration.seat_cap, 5)
        self.assertEqual(registration.expiry_date, fields.Date.from_string('2026-09-18'))

    def test_internal_user_cannot_write(self):
        registration = self._create_fixture()
        user = new_test_user(self.env, login='hosting_org_registration_viewer')
        with self.assertRaises(AccessError):
            registration.with_user(user).write({'seats_used': 4})

    def test_internal_user_cannot_create(self):
        user = new_test_user(self.env, login='hosting_org_registration_creator')
        with self.assertRaises(AccessError):
            self.env['hosting.org.registration'].with_user(user).create({
                'name': "Nope",
                'prospect_domain': "nope.example.com",
            })

    def test_internal_user_cannot_unlink(self):
        registration = self._create_fixture()
        user = new_test_user(self.env, login='hosting_org_registration_deleter')
        with self.assertRaises(AccessError):
            registration.with_user(user).unlink()

    def test_internal_user_can_read(self):
        registration = self._create_fixture()
        user = new_test_user(self.env, login='hosting_org_registration_reader')
        self.assertEqual(
            registration.with_user(user).read(['name'])[0]['name'], "Acme Trial")

    def test_form_view_hides_the_expiry_date_when_absent(self):
        # A Client Org has no expiry to show (issue #201's User Story #6) - the field itself,
        # not just its value, must be conditionally hidden rather than rendered blank.
        view = self.env.ref('hosting.view_hosting_org_registration_form')
        arch = etree.fromstring(view.arch)
        expiry_field = next(field for field in arch.iter('field') if field.get('name') == 'expiry_date')
        self.assertEqual(expiry_field.get('invisible'), 'not expiry_date')

    def test_form_view_shows_a_stated_reason_banner_when_the_last_sync_failed(self):
        # Issue #201's User Story #5: "a clear message when the registration cannot be fetched,
        # so that a blank panel is not mistaken for an empty org."
        view = self.env.ref('hosting.view_hosting_org_registration_form')
        arch = etree.fromstring(view.arch)
        banners = [
            div for div in arch.iter('div')
            if div.get('invisible') == 'not fetch_error'
        ]
        self.assertEqual(len(banners), 1)
        self.assertIsNotNone(banners[0].find('.//field[@name="fetch_error"]'))
