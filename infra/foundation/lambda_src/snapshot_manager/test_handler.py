"""Unit tests for snapshot_manager's handler (issue #176): idempotent snapshot creation across
the SnapshotBeforeDestroy Task's own Step Functions `States.ALL` Retry.

Not zipped into the Lambda deployment package - lambda.tf's `archive_file.snapshot_manager` lists
its `source` blocks explicitly (handler.py + ec2_client.py only), so this file never ships.
Imports the sibling `handler`/`ec2_client` modules the same way the Lambda runtime does: as flat
modules on `sys.path`, not a real Python package.
"""
import itertools
import math
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

# The tick `_make_advancing_clock` below advances the fake clock by on every call - deliberately
# the (smaller, fixed) initial backoff interval rather than modelling the real exponential growth,
# so this same value also bounds how many poll attempts a full budget can take, for tests that need
# to supply that many canned `describe_snapshots` responses without guessing a margin.
_FAKE_CLOCK_TICK_SECONDS = snapshot_manager_handler._SNAPSHOT_LOOKUP_POLL_INITIAL_INTERVAL_SECONDS
_MAX_POLL_ATTEMPTS = math.ceil(
    snapshot_manager_handler._SNAPSHOT_LOOKUP_POLL_BUDGET_SECONDS / _FAKE_CLOCK_TICK_SECONDS,
) + 2


def _make_advancing_clock():
    """A fake `time.monotonic` that ticks forward by `_FAKE_CLOCK_TICK_SECONDS` per call, so a
    patched `_snapshot_volume` poll loop reaches its deadline after a bounded number of calls
    instead of looping on a real (slow) clock. Shared by every test below that patches `time`
    directly, so there's one fake-clock shape instead of one per test."""
    counter = itertools.count()
    return lambda: next(counter) * _FAKE_CLOCK_TICK_SECONDS


class SnapshotVolumeTests(unittest.TestCase):
    """Exercises `_snapshot_volume`'s dedup check directly."""

    def setUp(self):
        """Gives each test a pair of fresh mock EC2 clients, plus a fake clock/sleep so the poll
        loop (issue #190) never actually waits in tests."""
        self.describe_client = MagicMock()
        self.scoped_client = MagicMock()
        self.sleep = MagicMock()
        self.monotonic = MagicMock(side_effect=_make_advancing_clock())

    def _snapshot_volume(self, **overrides):
        kwargs = {
            "describe_client": self.describe_client,
            "scoped_client": self.scoped_client,
            "volume_id": "vol-1",
            "trial_org_id": "42",
            "job_id": "job-1",
            "delete_after": "2026-09-15",
            "sleep": self.sleep,
            "monotonic": self.monotonic,
        }
        kwargs.update(overrides)
        return snapshot_manager_handler._snapshot_volume(**kwargs)

    def test_reuses_an_existing_snapshot_for_the_same_job_and_volume(self):
        """A prior attempt's snapshot (found via DescribeSnapshots) is returned, not re-created."""
        self.describe_client.describe_snapshots.return_value = {
            "Snapshots": [{"SnapshotId": "snap-existing"}],
        }

        snapshot_id = self._snapshot_volume()

        self.assertEqual(snapshot_id, "snap-existing")
        self.scoped_client.create_snapshot.assert_not_called()
        self.sleep.assert_not_called()

    def test_creates_and_tags_a_snapshot_when_none_exists_yet(self):
        """No prior snapshot for this (job_id, volume_id) pair even after polling for the full
        budget - a new one is created and tagged."""
        self.describe_client.describe_snapshots.return_value = {"Snapshots": []}
        self.scoped_client.create_snapshot.return_value = {"SnapshotId": "snap-new"}

        snapshot_id = self._snapshot_volume()

        self.assertEqual(snapshot_id, "snap-new")
        tags = self.scoped_client.create_snapshot.call_args.kwargs["TagSpecifications"][0]["Tags"]
        self.assertIn({"Key": "JobId", "Value": "job-1"}, tags)
        self.assertIn({"Key": "VolumeId", "Value": "vol-1"}, tags)
        self.assertGreater(self.sleep.call_count, 0)

    def test_polls_with_backoff_until_the_snapshot_becomes_visible(self):
        """The dedup check doesn't give up on the first empty lookup (issue #190): it keeps
        polling - backing off between attempts, per the spec's "with backoff" - until the snapshot
        shows up."""
        self.describe_client.describe_snapshots.side_effect = [
            {"Snapshots": []},
            {"Snapshots": []},
            {"Snapshots": [{"SnapshotId": "snap-existing"}]},
        ]

        snapshot_id = self._snapshot_volume()

        self.assertEqual(snapshot_id, "snap-existing")
        self.scoped_client.create_snapshot.assert_not_called()
        # Each wait is longer than the last, up to the configured max - proving this backs off
        # rather than polling at a fixed rate.
        initial = snapshot_manager_handler._SNAPSHOT_LOOKUP_POLL_INITIAL_INTERVAL_SECONDS
        self.assertEqual(
            [call.args[0] for call in self.sleep.call_args_list],
            [initial, min(initial * 2, snapshot_manager_handler._SNAPSHOT_LOOKUP_POLL_MAX_INTERVAL_SECONDS)],
        )


class HandlerRetryTests(unittest.TestCase):
    """Exercises the full `handler()` entry point across a simulated Step Functions retry."""

    def test_partial_failure_then_retry_creates_each_volume_exactly_once(self):
        """Reproduces the failure mode from #176: `create_snapshot` succeeds for vol-1, then
        raises for vol-2 (the whole Task retries at the Step Functions level, same `job_id`); the
        retry's handler invocation must reuse vol-1's snapshot and only create vol-2's.

        vol-1's retry lookup also reproduces #190's eventual-consistency race: its first
        `describe_snapshots` call comes back empty (the snapshot `create_snapshot` made moments
        ago isn't visible to this filtered lookup yet) before a second call finds it - proving the
        poll loop actually waits for it rather than concluding "no existing snapshot" and creating
        a duplicate.
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
                patch.dict("os.environ", _ROLE_ARN_ENV), \
                patch.object(snapshot_manager_handler.time, "sleep"), \
                patch.object(snapshot_manager_handler.time, "monotonic", side_effect=_make_advancing_clock()):
            with self.assertRaises(RuntimeError):
                snapshot_manager_handler.handler(event, None)

        self.assertEqual(scoped_client_1.create_snapshot.call_count, 2)

        describe_client_2 = MagicMock()
        describe_client_2.describe_instances.return_value = instances_response
        describe_client_2.describe_snapshots.side_effect = [
            # vol-1: empty on the first lookup (eventual consistency), found on the second.
            {"Snapshots": []},
            {"Snapshots": [{"SnapshotId": "snap-1"}]},
            # vol-2: genuinely never created (its create_snapshot raised above) - stays empty for
            # every poll attempt until the budget is spent and the handler creates it.
            *([{"Snapshots": []}] * _MAX_POLL_ATTEMPTS),
        ]
        scoped_client_2 = MagicMock()
        scoped_client_2.create_snapshot.return_value = {"SnapshotId": "snap-2"}

        with patch.object(snapshot_manager_handler, "get_ec2_client", return_value=describe_client_2), \
                patch.object(
                    snapshot_manager_handler, "get_trial_org_scoped_ec2_client", return_value=scoped_client_2,
                ), \
                patch.dict("os.environ", _ROLE_ARN_ENV), \
                patch.object(snapshot_manager_handler.time, "sleep") as sleep_mock, \
                patch.object(snapshot_manager_handler.time, "monotonic", side_effect=_make_advancing_clock()):
            result = snapshot_manager_handler.handler(event, None)

            self.assertEqual(result["snapshot_ids"], ["snap-1", "snap-2"])
            scoped_client_2.create_snapshot.assert_called_once()
            # vol-1's poll loop waited (slept) at least once between its two describe_snapshots calls.
            self.assertGreaterEqual(sleep_mock.call_count, 1)


if __name__ == "__main__":
    unittest.main()
