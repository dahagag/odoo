from odoo.tests import HttpCase, tagged
from odoo.tests.common import new_test_user


@tagged('post_install', '-at_install')
class TestHostingOnboardingPromptTour(HttpCase):
    # hosting_onboarding_seen is a plain per-user flag with no invite-path awareness anywhere
    # in this addon (models/res_users.py, models/ir_http.py, static/src/js/
    # onboarding_prompt.js never branch on how the user arrived) - the "same treatment
    # regardless of Targeted Invite / confirmed Open Invite Link / self-service invite"
    # acceptance criterion holds architecturally rather than by testing all three paths here.
    # Those invite mechanisms live in hosting_admin (the factory1 Platform instance) and are
    # already resolved into a plain res.users record before this addon's instance is ever
    # reached, so there is nothing invite-path-specific left for this addon to test.

    def test_prompt_shown_on_first_login_and_dismissing_it_marks_it_seen(self):
        user = new_test_user(self.env, login='hosting_onboarding_tour_first_login',
                              password='hosting_onboarding_tour_first_login')
        self.start_tour("/odoo", "hosting_onboarding_prompt_tour", login=user.login)
        self.assertTrue(user.hosting_onboarding_seen)

    def test_prompt_not_shown_on_second_login_for_the_same_user(self):
        user = new_test_user(self.env, login='hosting_onboarding_tour_second_login',
                              password='hosting_onboarding_tour_second_login')
        user.hosting_onboarding_seen = True
        self.start_tour("/odoo", "hosting_onboarding_absent_tour", login=user.login)
