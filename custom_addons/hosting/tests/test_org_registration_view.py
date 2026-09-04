from lxml import etree

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

# The exact set of fields the Org Registration view (docs/contexts/hosting/CONTEXT.md: "name,
# domain, seats used/total, expiry date") is allowed to expose - nothing more, nothing less.
EXPECTED_FIELDS = {'name', 'prospect_domain', 'seats_used', 'seat_cap', 'expiry_date'}


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
            EXPECTED_FIELDS,
        )

    def test_list_view_exposes_exactly_the_expected_fields(self):
        self.assertEqual(
            self._view_field_names('hosting.view_hosting_org_registration_list'),
            EXPECTED_FIELDS,
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
