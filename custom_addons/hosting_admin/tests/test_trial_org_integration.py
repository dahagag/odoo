from datetime import timedelta

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.hosting_stack_client import (
    RealHostingStackClient,
    StubHostingStackClient,
)
from odoo.addons.hosting_admin.models.trial_org import (
    CONFIG_PARAM_STACK_AWS_REGION,
    CONFIG_PARAM_STACK_BASE_URL,
)


class RecordingStackClient(StubHostingStackClient):
    """Wraps `StubHostingStackClient` (no network call of any kind) and records every call made
    to it, so a test can assert *that* hosting.trial.org called the client - never re-testing the
    stack's own lifecycle rules (this ticket's Testing Decisions)."""

    def __init__(self):
        super().__init__()
        self.calls = []

    def create_org(self, *args, **kwargs):
        self.calls.append(('create_org', args, kwargs))
        return super().create_org(*args, **kwargs)

    def issue(self, stack_org_id):
        self.calls.append(('issue', stack_org_id))
        return super().issue(stack_org_id)

    def suspend(self, stack_org_id):
        self.calls.append(('suspend', stack_org_id))
        return super().suspend(stack_org_id)

    def wake(self, stack_org_id):
        self.calls.append(('wake', stack_org_id))
        return super().wake(stack_org_id)

    def destroy(self, stack_org_id):
        self.calls.append(('destroy', stack_org_id))
        return super().destroy(stack_org_id)

    def extend(self, stack_org_id, additional_days):
        self.calls.append(('extend', stack_org_id, additional_days))
        return super().extend(stack_org_id, additional_days)

    def check_status(self, stack_org_id):
        self.calls.append(('check_status', stack_org_id))
        return super().check_status(stack_org_id)


@tagged('post_install', '-at_install')
class TestTrialOrgIntegration(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.administrator = cls.env['res.users'].create({
            'name': "Hosting Administrator",
            'login': 'hosting_administrator_test',
            'group_ids': [(6, 0, cls.env.ref('hosting_admin.group_hosting_admin_administrator').ids)],
        })
        cls.ordinary_user = cls.env['res.users'].create({
            'name': "Ordinary User",
            'login': 'hosting_ordinary_user_test',
            'group_ids': [(6, 0, cls.env.ref('base.group_user').ids)],
        })

    def _inject_stack_client(self, client):
        """Override `_get_stack_client` for the duration of this test only (`self.patch` restores
        it automatically on tearDown) - the same "tests override this method directly to inject a
        recording fake" seam `_get_provisioner`'s own tests used before this ticket."""
        TrialOrgModel = type(self.env['hosting.trial.org'])
        self.patch(TrialOrgModel, '_get_stack_client', lambda self_: client)

    def test_stub_is_selected_when_no_stack_base_url_is_configured(self):
        self.env['ir.config_parameter'].sudo().set_param(CONFIG_PARAM_STACK_BASE_URL, False)
        client = self.env['hosting.trial.org']._get_stack_client()
        self.assertIsInstance(client, StubHostingStackClient)

    def test_real_client_is_selected_once_a_stack_base_url_is_configured(self):
        ICP = self.env['ir.config_parameter'].sudo()
        ICP.set_param(CONFIG_PARAM_STACK_BASE_URL, "https://stack.example")
        ICP.set_param(CONFIG_PARAM_STACK_AWS_REGION, "us-east-1")
        client = self.env['hosting.trial.org']._get_stack_client()
        self.assertIsInstance(client, RealHostingStackClient)

    def test_configuring_a_base_url_without_a_region_raises_a_clear_user_error(self):
        ICP = self.env['ir.config_parameter'].sudo()
        ICP.set_param(CONFIG_PARAM_STACK_BASE_URL, "https://stack.example")
        ICP.set_param(CONFIG_PARAM_STACK_AWS_REGION, False)
        with self.assertRaises(UserError):
            self.env['hosting.trial.org']._get_stack_client()

    def test_create_rejects_a_missing_name_before_calling_the_stack(self):
        # CodeRabbit, PR #314: validated before any outbound call, not left for the stack (or,
        # under the stub, a raw NOT NULL constraint violation from super().create()) to reject.
        client = RecordingStackClient()
        self._inject_stack_client(client)
        with self.assertRaises(UserError):
            self.env['hosting.trial.org'].sudo().create(
                {'prospect_domain': "acme.example", 'seat_cap': 5})
        self.assertEqual(client.calls, [])

    def test_create_rejects_a_missing_prospect_domain_before_calling_the_stack(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        with self.assertRaises(UserError):
            self.env['hosting.trial.org'].sudo().create({'name': "Acme", 'seat_cap': 5})
        self.assertEqual(client.calls, [])

    def test_create_rejects_a_non_positive_seat_cap_before_calling_the_stack(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        with self.assertRaises(UserError):
            self.env['hosting.trial.org'].sudo().create(
                {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 0})
        self.assertEqual(client.calls, [])

    def test_create_batch_validates_every_item_before_calling_the_stack_for_any(self):
        # CodeRabbit, PR #314: a multi-record create() must not create a real org on the stack
        # for an earlier valid item and then raise on a later invalid one - that would orphan the
        # earlier org with no local Odoo row ever pointing at it.
        client = RecordingStackClient()
        self._inject_stack_client(client)
        with self.assertRaises(UserError):
            self.env['hosting.trial.org'].sudo().create([
                {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5},
                {'name': "Broken", 'prospect_domain': "broken.example", 'seat_cap': 0},
            ])
        self.assertEqual(client.calls, [])

    def test_create_calls_the_stack_client_and_mirrors_its_response(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create({
            'name': "Acme Trial", 'prospect_domain': "acme.example", 'seat_cap': 7,
        })

        self.assertEqual(trial_org.state, 'issued')
        self.assertTrue(trial_org.stack_org_id)
        self.assertEqual(trial_org.seats_used, 0)
        self.assertEqual([call[0] for call in client.calls], ['create_org'])

    def test_action_issue_calls_client_and_mirrors_active_state(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        trial_org.action_issue()

        self.assertEqual(trial_org.state, 'active')
        self.assertEqual(trial_org.last_job_action, 'issue')
        self.assertTrue(trial_org.last_job_started_at)
        self.assertEqual([call[0] for call in client.calls], ['create_org', 'issue'])

    def test_action_extend_calls_client_and_mirrors_new_expiry(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})
        before = trial_org.expiry_date

        trial_org.action_extend(10)

        self.assertEqual(trial_org.expiry_date, before + timedelta(days=10))
        self.assertEqual([call[0] for call in client.calls], ['create_org', 'extend'])

    def test_action_extend_rejects_a_non_positive_additional_days(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        with self.assertRaises(UserError):
            trial_org.action_extend(0)

    def test_an_unreachable_stack_surfaces_as_a_user_error_not_a_traceback(self):
        class FailingStackClient(StubHostingStackClient):
            def issue(self, stack_org_id):
                error_message = "Could not reach the hosting administration stack: boom."
                raise UserError(error_message)

        client = FailingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        with self.assertRaises(UserError):
            trial_org.action_issue()
        # The record is not left in a misleading state: still 'issued', not silently 'active'.
        self.assertEqual(trial_org.state, 'issued')

    def test_state_cannot_be_written_directly_by_an_ordinary_caller(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        with self.assertRaises(AccessError):
            trial_org.with_user(self.administrator).write({'state': 'active'})

    def test_stack_org_id_cannot_be_set_on_create(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        with self.assertRaises(AccessError):
            self.env['hosting.trial.org'].with_user(self.administrator).create({
                'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5,
                'stack_org_id': 'forged-id',
            })

    def test_ordinary_user_has_no_access_to_trial_org(self):
        with self.assertRaises(AccessError):
            self.env['hosting.trial.org'].with_user(self.ordinary_user).search([])

    def test_ordinary_user_cannot_issue(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        with self.assertRaises(AccessError):
            trial_org.with_user(self.ordinary_user).action_issue()

    def test_ordinary_user_cannot_extend(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})

        with self.assertRaises(AccessError):
            trial_org.with_user(self.ordinary_user).action_extend(10)

    def test_cron_sync_settles_mirrored_state_from_the_stack(self):
        client = RecordingStackClient()
        self._inject_stack_client(client)
        trial_org = self.env['hosting.trial.org'].sudo().create(
            {'name': "Acme", 'prospect_domain': "acme.example", 'seat_cap': 5})
        trial_org.action_issue()

        self.env['hosting.trial.org']._cron_sync_from_stack()

        self.assertIn('check_status', [call[0] for call in client.calls])
        self.assertEqual(trial_org.state, 'active')
