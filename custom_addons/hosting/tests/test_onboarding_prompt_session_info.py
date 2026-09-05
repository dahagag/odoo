from odoo.tests import HttpCase, tagged
from odoo.tests.common import new_test_user


@tagged('post_install', '-at_install')
class TestHostingOnboardingPromptSessionInfo(HttpCase):
    # session_info() is the seam the client uses on webclient boot to decide whether to show
    # the first-login prompt (#121) without an extra RPC - see ir_http.py and
    # docs/agents/odoo-19-development.md's "One-time, per-user UI state" note.

    def _session_info_as(self, login):
        self.authenticate(login, login)
        return self.make_jsonrpc_request('/web/session/get_session_info')

    def test_pending_on_first_login(self):
        user = new_test_user(self.env, login='hosting_onboarding_pending_user',
                              password='hosting_onboarding_pending_user')
        session_info = self._session_info_as(user.login)
        self.assertTrue(session_info['hosting_onboarding_pending'])

    def test_not_pending_once_seen(self):
        user = new_test_user(self.env, login='hosting_onboarding_seen_user',
                              password='hosting_onboarding_seen_user')
        user.hosting_onboarding_seen = True
        session_info = self._session_info_as(user.login)
        self.assertFalse(session_info['hosting_onboarding_pending'])
