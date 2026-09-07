from datetime import date

from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.cost_dashboard import (
    CONFIG_PARAM_CREDIT_AMOUNT,
    CONFIG_PARAM_CREDIT_START_DATE,
    DEFAULT_CREDIT_AMOUNT,
)
from odoo.addons.hosting_admin.models.cost_explorer import (
    CostExplorerClient,
    StubCostExplorerClient,
)


class FakeCostExplorerClient(CostExplorerClient):
    """Test double standing in for a real AWS Cost Explorer call - fixture cost data, no AWS
    account or boto3 involved."""

    def __init__(self, rows):
        self._rows = rows

    def get_daily_cost_by_trial_org(self, start_date, end_date):
        return [row for row in self._rows if start_date <= row['date'] < end_date]


@tagged('post_install', '-at_install')
class TestCostDashboardSnapshot(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.trial_org = cls.env['hosting.trial.org'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seat_cap': 5,
        })
        cls.Snapshot = cls.env['hosting.cost.dashboard.snapshot']

    def _set_credit_config(self, amount=None, start_date=None):
        ICP = self.env['ir.config_parameter'].sudo()
        if amount is not None:
            ICP.set_param(CONFIG_PARAM_CREDIT_AMOUNT, str(amount))
        if start_date is not None:
            ICP.set_param(CONFIG_PARAM_CREDIT_START_DATE, start_date.isoformat())

    def _inject_cost_explorer_client(self, client):
        # Same __slots__ constraint as hosting.trial.org._get_provisioner - patch the model
        # class's method rather than the instance.
        self.patch(type(self.Snapshot), '_get_cost_explorer_client', lambda self: client)

    def test_default_cost_explorer_client_is_the_stub(self):
        self.assertIsInstance(self.Snapshot._get_cost_explorer_client(), StubCostExplorerClient)

    def test_cron_refresh_snapshot_creates_todays_snapshot_from_fixture_cost_data(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 12.5},
            {'date': today, 'trial_org_id': None, 'amount': 1.5},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertEqual(snapshot.snapshot_date, today)
        self.assertEqual(snapshot.total_spend, 14.0)
        self.assertEqual(snapshot.credit_amount, 200.0)
        self.assertEqual(len(snapshot.line_ids), 2)

    def test_trial_org_count_excludes_the_unattributed_line(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 12.5},
            {'date': today, 'trial_org_id': None, 'amount': 1.5},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertEqual(snapshot.trial_org_count, 1)

    def test_credit_remaining_is_credit_amount_minus_total_spend(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 12.5},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertEqual(snapshot.credit_remaining, 187.5)

    def test_credit_remaining_never_goes_negative_once_the_credit_is_exhausted(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 250.0},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertEqual(snapshot.credit_remaining, 0.0)

    def test_cron_refresh_snapshot_marks_days_remaining_unknown_with_no_spend_yet(self):
        # A Float field can't distinguish "nothing to project" from a genuine 0 (credit
        # exhausted) - days_remaining_on_credit_known is what the view branches on instead of
        # trusting a bare 0.0 in days_remaining_on_credit.
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertFalse(snapshot.days_remaining_on_credit_known)
        self.assertEqual(snapshot.days_remaining_on_credit, 0.0)

    def test_cron_refresh_snapshot_marks_days_remaining_known_once_there_is_spend(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 10.0},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertTrue(snapshot.days_remaining_on_credit_known)
        self.assertEqual(snapshot.days_remaining_on_credit, 19.0)

    def test_cron_refresh_snapshot_lines_attribute_spend_to_the_matching_trial_org(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 9.99},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        line = snapshot.line_ids
        self.assertEqual(line.trial_org_id, self.trial_org)
        self.assertEqual(line.org_label, self.trial_org.name)
        self.assertEqual(line.spend, 9.99)
        self.assertEqual(line.spend_share_pct, 100.0)

    def test_cron_refresh_snapshot_labels_unattributed_spend(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': None, 'amount': 3.0},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertFalse(snapshot.line_ids.trial_org_id)
        self.assertEqual(snapshot.line_ids.org_label, "Unattributed")

    def test_cron_refresh_snapshot_falls_back_to_default_credit_amount_when_unconfigured(self):
        self._inject_cost_explorer_client(FakeCostExplorerClient([]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertEqual(snapshot.credit_amount, DEFAULT_CREDIT_AMOUNT)

    def test_cron_refresh_snapshot_is_idempotent_for_the_same_day(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 5.0},
        ]))
        self.Snapshot._cron_refresh_snapshot()

        # A stray tag value shows up for a Trial Org no longer among the fixture data - the
        # second run must replace, not append to, today's own lines.
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 8.0},
        ]))
        self.Snapshot._cron_refresh_snapshot()

        snapshots = self.Snapshot.search([('snapshot_date', '=', today)])
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots.total_spend, 8.0)
        self.assertEqual(len(snapshots.line_ids), 1)

    def test_line_for_a_tag_value_matching_no_trial_org_is_left_unattributed(self):
        # A tag value that no longer resolves to any hosting.trial.org record (e.g. a stale/
        # malformed tag) must not raise - it degrades to the same "Unattributed" bucket as a
        # genuinely untagged resource, rather than crashing the daily refresh.
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        bogus_trial_org_id = self.trial_org.id + 100000
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': bogus_trial_org_id, 'amount': 4.0},
        ]))

        snapshot = self.Snapshot._cron_refresh_snapshot()

        self.assertFalse(snapshot.line_ids.trial_org_id)
        self.assertEqual(snapshot.line_ids.spend, 4.0)

    def test_action_open_dashboard_reuses_an_existing_snapshot_without_refreshing(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 1.0},
        ]))
        existing = self.Snapshot._cron_refresh_snapshot()

        # A different client would produce a different total_spend if action_open_dashboard
        # refreshed again - it must not, since a snapshot already exists.
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 999.0},
        ]))

        action = self.Snapshot.action_open_dashboard()

        self.assertEqual(action['res_id'], existing.id)
        self.assertEqual(existing.total_spend, 1.0)

    def test_action_open_dashboard_refreshes_once_when_no_snapshot_exists_yet(self):
        today = date.today()
        self._set_credit_config(amount=200.0, start_date=today)
        self._inject_cost_explorer_client(FakeCostExplorerClient([
            {'date': today, 'trial_org_id': self.trial_org.id, 'amount': 2.0},
        ]))
        self.assertFalse(self.Snapshot.search([]))

        action = self.Snapshot.action_open_dashboard()

        snapshot = self.Snapshot.browse(action['res_id'])
        self.assertEqual(snapshot.total_spend, 2.0)
