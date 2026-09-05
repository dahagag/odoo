from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.hosting_admin.models.trial_org import trial_org_log_bus_channel


@tagged('post_install', '-at_install')
class TestTrialOrgLogChannelAuthorization(TransactionCase):
    """docs/adr/0023: a Trial Org's log-viewer bus channel embeds its own (guessable) id, so
    the actual gate against reading another Trial Org's live logs is
    IrWebsocket._can_subscribe_trial_org_log_channel (models/ir_websocket.py) - exercised here
    directly rather than through _build_bus_channel_list itself, which (via the base
    implementation) requires a live HTTP/websocket request context this TransactionCase has
    none of."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })
        cls.channel = trial_org_log_bus_channel(cls.trial_org.id)
        cls.administrator = new_test_user(
            cls.env, login='hosting_admin_user',
            groups='hosting_admin.group_hosting_admin_administrator')
        cls.other_user = new_test_user(cls.env, login='unrelated_user', groups='base.group_user')

    def test_administrator_can_subscribe_to_a_trial_orgs_log_channel(self):
        websocket = self.env['ir.websocket'].with_user(self.administrator)
        self.assertTrue(websocket._can_subscribe_trial_org_log_channel(self.channel))

    def test_unrelated_user_cannot_subscribe_to_a_trial_orgs_log_channel(self):
        websocket = self.env['ir.websocket'].with_user(self.other_user)
        self.assertFalse(websocket._can_subscribe_trial_org_log_channel(self.channel))

    def test_malformed_channel_is_rejected_without_raising(self):
        websocket = self.env['ir.websocket'].with_user(self.administrator)
        self.assertFalse(
            websocket._can_subscribe_trial_org_log_channel('hosting_admin.trial_org_log-not-a-number'))

    def test_unknown_trial_org_id_is_rejected(self):
        websocket = self.env['ir.websocket'].with_user(self.administrator)
        unknown_channel = trial_org_log_bus_channel(self.trial_org.id + 1000000)
        self.assertFalse(websocket._can_subscribe_trial_org_log_channel(unknown_channel))
