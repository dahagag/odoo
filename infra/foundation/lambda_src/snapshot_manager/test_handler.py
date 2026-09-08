"""Unit tests for snapshot_manager's handler (issue #176): idempotent snapshot creation across
the SnapshotBeforeDestroy Task's own Step Functions `States.ALL` Retry.

Not zipped into the Lambda deployment package - lambda.tf's `archive_file.snapshot_manager` lists
its `source` blocks explicitly (handler.py + ec2_client.py only), so this file never ships.
Imports the sibling `handler`/`ec2_client` modules the same way the Lambda runtime does: as flat
modules on `sys.path`, not a real Python package.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

_HERE = Path(__file__).resolve().parent
for _module_dir in (_HERE, _HERE.parent / "_common"):
    if str(_module_dir) not in sys.path:
        sys.path.insert(0, str(_module_dir))

import handler as snapshot_manager_handler  # noqa: E402

_ROLE_ARN_ENV = {"TRIAL_ORG_EXECUTION_ROLE_ARN": "arn:aws:iam::111111111111:role/test-execution"}


class SnapshotVolumeTests(unittest.TestCase):
    """Exercises `_snapshot_volume`'s dedup check directly."""

    def setUp(self):
        """Gives each test a pair of fresh mock EC2 clients."""
        self.describe_client = MagicMock()
        self.scoped_client = MagicMock()

    def test_reuses_an_existing_snapshot_for_the_same_job_and_volume(self):
        """A prior attempt's snapshot (found via DescribeSnapshots) is returned, not re-created."""
        self.describe_client.describe_snapshots.return_value = {
            "Snapshots": [{"SnapshotId": "snap-existing"}],
        }

        snapshot_id = snapshot_manager_handler._snapshot_volume(
            describe_client=self.describe_client,
            scoped_client=self.scoped_client,
            volume_id="vol-1",
            trial_org_id="42",
            job_id="job-1",
            delete_after="2026-09-15",
        )

        self.assertEqual(snapshot_id, "snap-existing")
        self.scoped_client.create_snapshot.assert_not_called()

    def test_creates_and_tags_a_snapshot_when_none_exists_yet(self):
        """No prior snapshot for this (job_id, volume_id) pair - a new one is created and tagged."""
        self.describe_client.describe_snapshots.return_value = {"Snapshots": []}
        self.scoped_client.create_snapshot.return_value = {"SnapshotId": "snap-new"}

        snapshot_id = snapshot_manager_handler._snapshot_volume(
            describe_client=self.describe_client,
            scoped_client=self.scoped_client,
            volume_id="vol-1",
            trial_org_id="42",
            job_id="job-1",
            delete_after="2026-09-15",
        )

        self.assertEqual(snapshot_id, "snap-new")
        tags = self.scoped_client.create_snapshot.call_args.kwargs["TagSpecifications"][0]["Tags"]
        self.assertIn({"Key": "JobId", "Value": "job-1"}, tags)
        self.assertIn({"Key": "VolumeId", "Value": "vol-1"}, tags)


class HandlerRetryTests(unittest.TestCase):
    """Exercises the full `handler()` entry point across a simulated Step Functions retry."""

    def test_partial_failure_then_retry_creates_each_volume_exactly_once(self):
        """Reproduces the failure mode from #176: `create_snapshot` succeeds for vol-1, then
        raises for vol-2 (the whole Task retries at the Step Functions level, same `job_id`); the
        retry's handler invocation must reuse vol-1's snapshot and only create vol-2's.
        """
        instances_response = {
            "Reservations": [{"Instances": [{
                "BlockDeviceMappings": [
                    {"Ebs": {"VolumeId": "vol-1"}},
                    {"Ebs": {"VolumeId": "vol-2"}},
                ],
            }]}],
        }
        event = {"trial_org_id": "42", "retention_days": 7, "job_id": "job-1"}

        describe_client_1 = MagicMock()
        describe_client_1.describe_instances.return_value = instances_response
        describe_client_1.describe_snapshots.return_value = {"Snapshots": []}
        scoped_client_1 = MagicMock()
        scoped_client_1.create_snapshot.side_effect = [
            {"SnapshotId": "snap-1"},
            RuntimeError("throttled"),
        ]

        with patch.object(snapshot_manager_handler, "get_ec2_client", return_value=describe_client_1), \
                patch.object(
                    snapshot_manager_handler, "get_trial_org_scoped_ec2_client", return_value=scoped_client_1,
                ), \
                patch.dict("os.environ", _ROLE_ARN_ENV):
            with self.assertRaises(RuntimeError):
                snapshot_manager_handler.handler(event, None)

        self.assertEqual(scoped_client_1.create_snapshot.call_count, 2)

        describe_client_2 = MagicMock()
        describe_client_2.describe_instances.return_value = instances_response
        describe_client_2.describe_snapshots.side_effect = [
            {"Snapshots": [{"SnapshotId": "snap-1"}]},
            {"Snapshots": []},
        ]
        scoped_client_2 = MagicMock()
        scoped_client_2.create_snapshot.return_value = {"SnapshotId": "snap-2"}

        with patch.object(snapshot_manager_handler, "get_ec2_client", return_value=describe_client_2), \
                patch.object(
                    snapshot_manager_handler, "get_trial_org_scoped_ec2_client", return_value=scoped_client_2,
                ), \
                patch.dict("os.environ", _ROLE_ARN_ENV):
            result = snapshot_manager_handler.handler(event, None)

        self.assertEqual(result["snapshot_ids"], ["snap-1", "snap-2"])
        scoped_client_2.create_snapshot.assert_called_once()


if __name__ == "__main__":
    unittest.main()
