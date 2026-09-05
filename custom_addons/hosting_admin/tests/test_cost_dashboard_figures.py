from datetime import date

from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCostDashboardFigures(TransactionCase):
    """Tests HostingCostDashboardSnapshot._compute_figures directly against fixture cost data -
    no AWS call, no CostExplorerClient at all (the ticket's own "assert on computed figures
    given fixture cost data, not a real API call" requirement)."""

    def _compute(self, daily_rows, credit_amount=200.0, credit_start_date=date(2026, 1, 1),
                 today=date(2026, 1, 7)):
        return self.env['hosting.cost.dashboard.snapshot']._compute_figures(
            daily_rows, credit_amount, credit_start_date, today)

    def test_total_spend_sums_every_row_regardless_of_trial_org(self):
        figures = self._compute([
            {'date': date(2026, 1, 5), 'trial_org_id': 1, 'amount': 10.0},
            {'date': date(2026, 1, 6), 'trial_org_id': 2, 'amount': 5.5},
            {'date': date(2026, 1, 6), 'trial_org_id': None, 'amount': 2.25},
        ])
        self.assertEqual(figures['total_spend'], 17.75)

    def test_per_trial_org_spend_groups_by_tag_value_including_unattributed(self):
        figures = self._compute([
            {'date': date(2026, 1, 5), 'trial_org_id': 1, 'amount': 10.0},
            {'date': date(2026, 1, 6), 'trial_org_id': 1, 'amount': 4.0},
            {'date': date(2026, 1, 6), 'trial_org_id': 2, 'amount': 5.5},
            {'date': date(2026, 1, 6), 'trial_org_id': None, 'amount': 2.25},
        ])
        self.assertEqual(figures['per_trial_org_spend'], {1: 14.0, 2: 5.5, None: 2.25})

    def test_burn_rate_averages_over_the_7_day_window(self):
        daily_rows = [
            {'date': date(2026, 1, day), 'trial_org_id': 1, 'amount': 7.0}
            for day in range(1, 8)
        ]
        figures = self._compute(
            daily_rows, credit_start_date=date(2026, 1, 1), today=date(2026, 1, 7))
        self.assertEqual(figures['burn_rate_per_day'], 7.0)

    def test_burn_rate_ignores_spend_outside_the_trailing_window(self):
        # A spike 10 days ago must not drag the burn rate up once it's fallen out of the
        # trailing-7-day window.
        daily_rows = [
            {'date': date(2025, 12, 27), 'trial_org_id': 1, 'amount': 1000.0},
        ] + [
            {'date': date(2026, 1, day), 'trial_org_id': 1, 'amount': 3.0}
            for day in range(1, 8)
        ]
        figures = self._compute(
            daily_rows, credit_start_date=date(2025, 12, 20), today=date(2026, 1, 7))
        self.assertEqual(figures['burn_rate_per_day'], 3.0)

    def test_burn_rate_window_clamps_to_days_elapsed_since_credit_start(self):
        # Only 3 days into the credit period - averaging over a full 7-day window would dilute
        # the rate with days that don't exist yet.
        daily_rows = [
            {'date': date(2026, 1, 1), 'trial_org_id': 1, 'amount': 10.0},
            {'date': date(2026, 1, 2), 'trial_org_id': 1, 'amount': 10.0},
            {'date': date(2026, 1, 3), 'trial_org_id': 1, 'amount': 10.0},
        ]
        figures = self._compute(
            daily_rows, credit_start_date=date(2026, 1, 1), today=date(2026, 1, 3))
        self.assertEqual(figures['burn_rate_per_day'], 10.0)

    def test_days_remaining_projects_from_burn_rate_and_remaining_credit(self):
        daily_rows = [
            {'date': date(2026, 1, day), 'trial_org_id': 1, 'amount': 10.0}
            for day in range(1, 8)
        ]
        figures = self._compute(
            daily_rows, credit_amount=200.0, credit_start_date=date(2026, 1, 1),
            today=date(2026, 1, 7))
        self.assertEqual(figures['total_spend'], 70.0)
        self.assertEqual(figures['burn_rate_per_day'], 10.0)
        self.assertEqual(figures['days_remaining_on_credit'], 13.0)

    def test_days_remaining_is_zero_once_credit_is_exhausted(self):
        daily_rows = [
            {'date': date(2026, 1, day), 'trial_org_id': 1, 'amount': 50.0}
            for day in range(1, 6)
        ]
        figures = self._compute(
            daily_rows, credit_amount=200.0, credit_start_date=date(2026, 1, 1),
            today=date(2026, 1, 5))
        self.assertEqual(figures['days_remaining_on_credit'], 0.0)

    def test_days_remaining_is_none_when_there_is_no_spend_to_project_from(self):
        figures = self._compute([])
        self.assertEqual(figures['burn_rate_per_day'], 0.0)
        self.assertIsNone(figures['days_remaining_on_credit'])
