from datetime import timedelta

from odoo import fields
from odoo.tests import HttpCase, tagged

from odoo.addons.hosting_admin.controllers.asleep import WAKING_PHASE_TIMEOUT_MINUTES
from odoo.addons.hosting_admin.models.trial_org import CONFIG_PARAM_DNS_DOMAIN_SUFFIX

DOMAIN_SUFFIX = "dev.example.test"
HOST = f"acme-widgets.{DOMAIN_SUFFIX}"


@tagged('post_install', '-at_install')
class TestTrialOrgAsleepPage(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['ir.config_parameter'].sudo().set_param(CONFIG_PARAM_DNS_DOMAIN_SUFFIX, DOMAIN_SUFFIX)
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Widgets",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
            'dns_subdomain_label': "acme-widgets",
        })
        cls.trial_org.action_issue()
        cls.trial_org.action_suspend()

    def _get(self, path, host=HOST, **kwargs):
        return self.url_open(path, headers={'Host': host}, allow_redirects=False, **kwargs)

    def _post(self, path, host=HOST, **kwargs):
        return self.url_open(
            path, method='POST', headers={'Host': host}, allow_redirects=False, **kwargs)

    def test_asleep_page_renders_for_a_suspended_org_with_a_wake_up_control(self):
        response = self._get('/hosting_admin/asleep')
        self.assertEqual(response.status_code, 200)
        self.assertIn("Acme Widgets", response.text)
        self.assertIn("o_asleep_wake_btn", response.text)
        self.assertIn("/hosting_admin/asleep/wake", response.text)

    def test_asleep_page_404s_for_an_unrecognized_host(self):
        response = self._get('/hosting_admin/asleep', host=f"nobody-here.{DOMAIN_SUFFIX}")
        self.assertEqual(response.status_code, 404)

    def test_wake_button_posts_to_the_wake_endpoint_and_calls_action_wake(self):
        response = self._post('/hosting_admin/asleep/wake')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'phase': 'waking'})
        self.assertEqual(self.trial_org.state, 'active')
        self.assertEqual(self.trial_org.last_job_action, 'wake')

    def test_status_endpoint_reports_awake_once_the_job_has_succeeded(self):
        self._post('/hosting_admin/asleep/wake')
        self.trial_org.write({'last_job_status': 'succeeded'})

        response = self._get('/hosting_admin/asleep/status')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'phase': 'awake'})

    def test_status_endpoint_reports_awake_once_the_waking_timeout_elapses_with_no_provisioner(self):
        # A StubProvisioner-backed record (no AWS wiring configured - dev/test/demo, see
        # docs/agents/odoo-19-development.md's walkthrough guidance) has no real execution for
        # _cron_poll_pending_jobs to ever observe, so last_job_status alone would never leave
        # 'running' - this page must not show "Waking up" forever in that environment.
        self._post('/hosting_admin/asleep/wake')
        self.trial_org.write({
            'last_job_started_at': fields.Datetime.now() - timedelta(
                minutes=WAKING_PHASE_TIMEOUT_MINUTES + 1),
        })

        response = self._get('/hosting_admin/asleep/status')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'phase': 'awake'})

    def test_wake_on_an_already_active_org_is_a_no_op(self):
        self.trial_org.action_wake()
        self.trial_org.write({'last_job_status': 'succeeded'})

        response = self._post('/hosting_admin/asleep/wake')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'phase': 'awake'})

    def test_any_route_on_a_suspended_orgs_host_redirects_to_the_asleep_page(self):
        response = self._get('/web/login')
        self.assertEqual(response.status_code, 303)
        self.assertTrue(response.headers['Location'].endswith('/hosting_admin/asleep'))

    def test_the_asleep_page_itself_is_never_redirected(self):
        response = self._get('/hosting_admin/asleep')
        self.assertEqual(response.status_code, 200)

    def test_a_host_for_an_active_org_is_not_redirected(self):
        self.trial_org.action_wake()
        response = self._get('/web/login')
        self.assertEqual(response.status_code, 200)
