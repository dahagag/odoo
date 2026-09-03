from psycopg2.errors import CheckViolation

from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from odoo.addons.hosting_admin.models.trial_org import SYSTEM_WIDE_SEAT_CAP


@tagged('post_install', '-at_install')
class TestTrialOrgValidation(TransactionCase):

    def _create(self, **extra):
        values = {
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        }
        values.update(extra)
        return self.env['hosting.trial.org'].create(values)

    def test_create_within_seat_cap_succeeds(self):
        trial_org = self._create(seat_cap=SYSTEM_WIDE_SEAT_CAP)
        self.assertEqual(trial_org.seat_cap, SYSTEM_WIDE_SEAT_CAP)

    def test_create_above_system_wide_seat_cap_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(seat_cap=SYSTEM_WIDE_SEAT_CAP + 1)

    def test_write_above_system_wide_seat_cap_is_rejected(self):
        trial_org = self._create()
        with self.assertRaises(ValidationError):
            trial_org.seat_cap = SYSTEM_WIDE_SEAT_CAP + 1

    def test_create_with_non_positive_seat_cap_is_rejected(self):
        # seat_cap=0 fails the DB-level CHECK(seat_cap > 0) constraint directly (there's no
        # Python-side @api.constrains for the lower bound), so the raised exception is
        # psycopg2's CheckViolation, not an odoo.exceptions.ValidationError.
        with self.assertRaises(CheckViolation), mute_logger('odoo.sql_db'):
            self._create(seat_cap=0)

    def test_create_with_valid_domain_succeeds(self):
        trial_org = self._create(prospect_domain="prospect.co")
        self.assertEqual(trial_org.prospect_domain, "prospect.co")

    def test_create_with_domain_missing_a_dot_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(prospect_domain="acme")

    def test_create_with_domain_containing_invalid_characters_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(prospect_domain="acme_corp!.com")

    def test_create_with_domain_having_leading_hyphen_label_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(prospect_domain="-acme.com")

    def test_create_with_empty_domain_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(prospect_domain="")

    def test_new_trial_org_starts_issued_with_blank_deployment_version(self):
        trial_org = self._create()
        self.assertEqual(trial_org.state, 'issued')
        self.assertFalse(trial_org.ami_id)
        self.assertFalse(trial_org.tofu_module_git_sha)
