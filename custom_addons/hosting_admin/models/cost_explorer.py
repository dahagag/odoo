from abc import ABC, abstractmethod
from datetime import date


class CostExplorerClient(ABC):
    """Injectable seam standing in for the AWS Cost Explorer call surface the Cost Dashboard
    reads from (docs/adr/0030, ticket #115's own "mockable boundary" requirement - no real AWS
    call in the test suite). ``AwsCostExplorerClient`` below is the real implementation, calling
    ``GetCostAndUsage`` grouped by the ``TrialOrgId`` cost-allocation tag (docs/research/
    aws-hosting-foundation-tooling.md); ``StubCostExplorerClient`` is a no-op stand-in for
    environments (tests, dev) with no AWS wiring configured. Same shape as ``Provisioner``
    (models/provisioner.py) for the same reason: callers must stay indifferent to which
    implementation is injected.
    """

    @abstractmethod
    def get_daily_cost_by_trial_org(self, start_date, end_date):
        """Return AWS's own daily spend for the half-open range [``start_date``, ``end_date``),
        grouped by the ``TrialOrgId`` cost-allocation tag, as a list of ``{'date': date,
        'trial_org_id': int | None, 'amount': float}`` rows - one per (date, tag value) AWS
        actually billed. ``trial_org_id`` is ``None`` for spend AWS attributes to no
        ``TrialOrgId`` tag value at all (the shared foundation/CI infrastructure docs/adr/0013
        keeps outside any single Trial Org's own tag)."""


class StubCostExplorerClient(CostExplorerClient):
    """No-op stand-in injected when no AWS wiring is configured (dev/test environments). Makes
    no network or AWS call of any kind - the dashboard has nothing to show, plainly, rather than
    silently spending a Cost Explorer API call."""

    def get_daily_cost_by_trial_org(self, start_date, end_date):
        return []


class AwsCostExplorerClient(CostExplorerClient):
    """Real CostExplorerClient: calls ``GetCostAndUsage`` with ``Granularity='DAILY'`` and
    ``GroupBy=[{'Type': 'TAG', 'Key': 'TrialOrgId'}]`` (docs/research/
    aws-hosting-foundation-tooling.md's GroupBy-on-cost-allocation-tags path, docs/adr/0030),
    paginating via ``NextPageToken`` since a wide date range or many distinct Trial Orgs can
    exceed a single page.
    """

    def __init__(self, client=None, region_name=None):
        self._client = client
        self._region_name = region_name

    @property
    def client(self):
        """Lazily creates the boto3 Cost Explorer client, so a test can inject a fake/mock
        client via ``client=`` in ``__init__`` without boto3 needing to be installed to run the
        test suite at all (the ticket's own mocking requirement) - same pattern as
        AwsProvisioner.client (models/provisioner.py). Cost Explorer is a single global (``ce``)
        endpoint in ``us-east-1`` regardless of ``region_name`` - boto3 itself handles that; this
        client is only ever asked to describe/query it, never to target a specific region's
        resources."""
        if self._client is None:
            import boto3  # noqa: PLC0415 - lazy so tests never need boto3 installed at all
            self._client = boto3.client('ce', region_name=self._region_name)
        return self._client

    def get_daily_cost_by_trial_org(self, start_date, end_date):
        rows = []
        next_page_token = None
        while True:
            kwargs = {
                'TimePeriod': {'Start': start_date.isoformat(), 'End': end_date.isoformat()},
                'Granularity': 'DAILY',
                'Metrics': ['UnblendedCost'],
                'GroupBy': [{'Type': 'TAG', 'Key': 'TrialOrgId'}],
            }
            if next_page_token:
                kwargs['NextPageToken'] = next_page_token
            response = self.client.get_cost_and_usage(**kwargs)
            for result in response.get('ResultsByTime', []):
                result_date = date.fromisoformat(result['TimePeriod']['Start'])
                for group in result.get('Groups', []):
                    trial_org_id = self._trial_org_id_from_tag_keys(group.get('Keys', []))
                    amount = float(group['Metrics']['UnblendedCost']['Amount'])
                    rows.append({
                        'date': result_date,
                        'trial_org_id': trial_org_id,
                        'amount': amount,
                    })
            next_page_token = response.get('NextPageToken')
            if not next_page_token:
                break
        return rows

    @staticmethod
    def _trial_org_id_from_tag_keys(keys):
        """A ``GroupBy=TAG`` result's ``Keys`` entry is ``"TrialOrgId$<value>"`` (AWS's own
        tag-group key format, one entry since only one GroupBy key was requested) - untagged
        spend comes back with an empty value after the ``$``, mapped to ``None`` rather than a
        garbage ``int()`` call on an empty string."""
        if not keys:
            return None
        _, _, value = keys[0].partition('$')
        return int(value) if value.isdigit() else None
