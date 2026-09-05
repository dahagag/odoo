from lxml import etree

from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user


@tagged('post_install', '-at_install')
class TestHostingOnboardingPrompt(TransactionCase):

    def test_hosting_onboarding_seen_defaults_false(self):
        user = new_test_user(self.env, login='hosting_onboarding_new_user')
        self.assertFalse(user.hosting_onboarding_seen)

    def test_user_can_self_write_the_seen_flag_alone(self):
        # Mirrors the real client call: hosting_onboarding_seen is the only key in the
        # write vals, so res.users.write() self-sudos it (docs/agents/
        # odoo-19-development.md's "One-time, per-user UI state" note) - no AccessError
        # even though this user has no write access to res.users otherwise.
        user = new_test_user(self.env, login='hosting_onboarding_self_writer')
        user.with_user(user).write({'hosting_onboarding_seen': True})
        self.assertTrue(user.hosting_onboarding_seen)

    def test_getting_started_action_points_at_the_stable_teach_doc_path(self):
        action = self.env.ref('hosting.action_hosting_getting_started')
        self.assertEqual(action.url, '/hosting/static/docs/index.html')
        self.assertEqual(action.target, 'new')

    def test_form_view_carries_the_getting_started_button(self):
        # %(hosting.action_hosting_getting_started)d is resolved to the action's actual
        # database id when the view record is loaded, so the stored arch carries that id,
        # not the xmlid placeholder.
        action = self.env.ref('hosting.action_hosting_getting_started')
        view = self.env.ref('hosting.view_hosting_org_registration_form')
        arch = etree.fromstring(view.arch)
        buttons = [
            button for button in arch.iter('button')
            if button.get('name') == str(action.id)
        ]
        self.assertEqual(len(buttons), 1)
