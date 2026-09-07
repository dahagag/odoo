from datetime import date
from unittest.mock import MagicMock

from odoo.tests import TransactionCase, tagged

from odoo.addons.hosting_admin.models.cost_explorer import AwsCostExplorerClient


def _cost_and_usage_response(groups_by_date, next_page_token=None):
    response = {
        'ResultsByTime': [
            {
                'TimePeriod': {'Start': day.isoformat(), 'End': day.isoformat()},
                'Groups': [
                    {
                        'Keys': [f'TrialOrgId${tag_value}'],
                        'Metrics': {'UnblendedCost': {'Amount': str(amount), 'Unit': 'USD'}},
                    }
                    for tag_value, amount in groups
                ],
            }
            for day, groups in groups_by_date
        ],
    }
    if next_page_token:
        response['NextPageToken'] = next_page_token
    return response


@tagged('post_install', '-at_install')
class TestAwsCostExplorerClient(TransactionCase):

    def _make_client(self, boto_client=None):
        return AwsCostExplorerClient(client=boto_client or MagicMock())

    def test_get_daily_cost_by_trial_org_calls_get_cost_and_usage_grouped_by_tag(self):
        boto_client = MagicMock()
        boto_client.get_cost_and_usage.return_value = _cost_and_usage_response([])
        client = self._make_client(boto_client)

        client.get_daily_cost_by_trial_org(date(2026, 1, 1), date(2026, 1, 8))

        boto_client.get_cost_and_usage.assert_called_once_with(
            TimePeriod={'Start': '2026-01-01', 'End': '2026-01-08'},
            Granularity='DAILY',
            Metrics=['UnblendedCost'],
            GroupBy=[{'Type': 'TAG', 'Key': 'TrialOrgId'}],
        )

    def test_get_daily_cost_by_trial_org_parses_rows_by_date_and_tag_value(self):
        boto_client = MagicMock()
        boto_client.get_cost_and_usage.return_value = _cost_and_usage_response([
            (date(2026, 1, 1), [('1', '10.5'), ('2', '3.25')]),
            (date(2026, 1, 2), [('1', '4.0')]),
        ])
        client = self._make_client(boto_client)

        rows = client.get_daily_cost_by_trial_org(date(2026, 1, 1), date(2026, 1, 3))

        self.assertEqual(rows, [
            {'date': date(2026, 1, 1), 'trial_org_id': 1, 'amount': 10.5},
            {'date': date(2026, 1, 1), 'trial_org_id': 2, 'amount': 3.25},
            {'date': date(2026, 1, 2), 'trial_org_id': 1, 'amount': 4.0},
        ])

    def test_get_daily_cost_by_trial_org_maps_an_untagged_group_to_none(self):
        boto_client = MagicMock()
        boto_client.get_cost_and_usage.return_value = _cost_and_usage_response([
            (date(2026, 1, 1), [('', '1.10')]),
        ])
        client = self._make_client(boto_client)

        rows = client.get_daily_cost_by_trial_org(date(2026, 1, 1), date(2026, 1, 2))

        self.assertEqual(rows, [{'date': date(2026, 1, 1), 'trial_org_id': None, 'amount': 1.10}])

    def test_get_daily_cost_by_trial_org_follows_next_page_token(self):
        boto_client = MagicMock()
        first_page = _cost_and_usage_response(
            [(date(2026, 1, 1), [('1', '1.0')])], next_page_token='page-2')
        second_page = _cost_and_usage_response([(date(2026, 1, 2), [('1', '2.0')])])
        boto_client.get_cost_and_usage.side_effect = [first_page, second_page]
        client = self._make_client(boto_client)

        rows = client.get_daily_cost_by_trial_org(date(2026, 1, 1), date(2026, 1, 3))

        self.assertEqual(boto_client.get_cost_and_usage.call_count, 2)
        second_call_kwargs = boto_client.get_cost_and_usage.call_args_list[1].kwargs
        self.assertEqual(second_call_kwargs['NextPageToken'], 'page-2')
        self.assertEqual(rows, [
            {'date': date(2026, 1, 1), 'trial_org_id': 1, 'amount': 1.0},
            {'date': date(2026, 1, 2), 'trial_org_id': 1, 'amount': 2.0},
        ])
