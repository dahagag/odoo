from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user


@tagged("post_install", "-at_install")
class TestExampleAnnouncement(TransactionCase):
    def test_default_author_is_current_user(self):
        announcement = self.env["example.announcement"].create(
            {"name": "Welcome", "body": "Hello team."},
        )
        self.assertEqual(announcement.author_id, self.env.user)

    def test_is_expired_compute(self):
        Announcement = self.env["example.announcement"]
        past = Announcement.create(
            {"name": "Old", "body": "...", "expires_on": "2000-01-01"},
        )
        future = Announcement.create(
            {"name": "New", "body": "...", "expires_on": "2999-01-01"},
        )
        self.assertTrue(past.is_expired)
        self.assertFalse(future.is_expired)

    def test_internal_user_cannot_create(self):
        user = new_test_user(self.env, login="example_addon_basic_user")
        with self.assertRaises(AccessError):
            self.env["example.announcement"].with_user(user).create(
                {"name": "Nope", "body": "Should fail"},
            )
