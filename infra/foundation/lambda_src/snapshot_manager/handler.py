"""EBS snapshot-before-destroy for Auto-Destroy (#174).

Auto-Destroy always leaves a short-lived EBS snapshot of the Trial Org's root volume before
RunTofu's `tofu destroy` runs, so a deal that closes shortly after expiry can still recover its
demo data (docs/contexts/hosting/CONTEXT.md's Auto-Destroy entry,
hosting.trial.org.snapshot_retention_until). Invoked as its own Task state
(state_machine.asl.json.tftpl's SnapshotBeforeDestroy), before RunTofu.

Resolves the instance by its TrialOrgId tag (set on every Trial Org instance by
infra/modules/trial_org/main.tf) rather than an instance id the caller passes in - hosting_admin
doesn't reliably have the EC2 instance id recorded yet (see hosting.trial.org.instance_id's own
docstring), the same reason ec2_power_control's IAM policy is scoped by tag rather than a
specific instance ARN.

This Lambda's own static role holds no direct EC2 mutate permission (issue #183, ADR-0033): it
self-assumes `trial_org_execution` via `TRIAL_ORG_EXECUTION_ROLE_ARN`, tagging the session with
this invocation's own TrialOrgId, before making the create-snapshot/create-tags calls - so its
mutate access is genuinely scoped to the one Trial Org this invocation names, not "any tagged
Trial Org resource".

Idempotent across the Task's own Step Functions retry (issue #176): SnapshotBeforeDestroy's
`States.ALL` Retry re-invokes this handler from scratch, so a partial failure (one volume's
`create_snapshot` succeeds, a later one throttles/times out) must not create a second snapshot for
the volume that already succeeded. Every snapshot is tagged with the invocation's own JobId
(state_machine.asl.json.tftpl's `$.job_id`, stable across retries of the same execution) and the
VolumeId it was taken from; before calling `create_snapshot` for a volume, the handler checks for
an existing snapshot carrying that exact (JobId, VolumeId) pair and reuses it instead.

That dedup check polls, with backoff, rather than looking once (issue #190): EC2's own consistency
guarantees don't unambiguously cover a tag-filtered `DescribeSnapshots` called immediately after
the `CreateSnapshot` that set those same tags, so a retry landing right after a prior attempt's
`create_snapshot` succeeded could still see an empty result and create a duplicate. See the
`_SNAPSHOT_LOOKUP_POLL_*` constants below for the budget this closes that race window with, and
`_snapshot_volume` for the poll loop itself.
"""
import os
import time
from datetime import datetime, timedelta, timezone

from ec2_client import get_ec2_client, get_trial_org_scoped_ec2_client

# Bounded budget for _snapshot_volume's existing-snapshot poll (issue #190): long enough to ride
# out EC2's eventual-consistency window on a tag-filtered DescribeSnapshots right after a
# CreateSnapshot, short enough that even 5 volumes on one instance polling the full budget in
# sequence (5 * 8s = 40s) still leaves headroom under this Lambda's own timeout
# (`var.lambda_invoke_timeout_seconds`, 60s by default - lambda.tf) for the `describe_instances`
# call and the `create_snapshot` calls themselves. Backed off exponentially between attempts
# (initial/max interval below) rather than at a fixed rate, so a longer wait doesn't mean
# hammering DescribeSnapshots once a second for the whole budget.
_SNAPSHOT_LOOKUP_POLL_BUDGET_SECONDS = 8
_SNAPSHOT_LOOKUP_POLL_INITIAL_INTERVAL_SECONDS = 0.5
_SNAPSHOT_LOOKUP_POLL_MAX_INTERVAL_SECONDS = 2


def handler(event, _context):
    """`event` = {"trial_org_id": "...", "retention_days": 7, "job_id": "..."}."""
    trial_org_id = str(event["trial_org_id"])
    retention_days = int(event["retention_days"])
    job_id = str(event["job_id"])

    describe_client = get_ec2_client()
    reservations = describe_client.describe_instances(Filters=[
        {"Name": "tag:TrialOrgId", "Values": [trial_org_id]},
    ])["Reservations"]
    instances = [instance for reservation in reservations for instance in reservation["Instances"]]
    if not instances:
        # No instance ever existed for this Trial Org (e.g. Issue never reached RunTofu) - not a
        # failure, destroy must still proceed to RunTofu in case there is other infra to tear down.
        return {"snapshotted": False, "reason": "no instance found for TrialOrgId"}

    volume_ids = [
        mapping["Ebs"]["VolumeId"]
        for mapping in instances[0].get("BlockDeviceMappings", [])
        if mapping.get("Ebs")
    ]
    if not volume_ids:
        return {"snapshotted": False, "reason": "instance has no EBS volumes"}

    scoped_client = get_trial_org_scoped_ec2_client(
        role_arn=os.environ["TRIAL_ORG_EXECUTION_ROLE_ARN"],
        trial_org_id=trial_org_id,
        session_name=f"snapshot-manager-{trial_org_id}",
    )

    delete_after = (datetime.now(timezone.utc) + timedelta(days=retention_days)).date().isoformat()
    snapshot_ids = [
        _snapshot_volume(
            describe_client=describe_client,
            scoped_client=scoped_client,
            volume_id=volume_id,
            trial_org_id=trial_org_id,
            job_id=job_id,
            delete_after=delete_after,
        )
        for volume_id in volume_ids
    ]

    return {"snapshotted": True, "snapshot_ids": snapshot_ids, "delete_after": delete_after}


def _snapshot_volume(
    describe_client, scoped_client, volume_id, trial_org_id, job_id, delete_after,
    sleep=None, monotonic=None,
):
    """Returns this volume's snapshot id, reusing one already tagged for this exact retry attempt.

    Queried via `describe_client` (the Lambda's own static, account-wide client) rather than
    `scoped_client`: `ec2:DescribeSnapshots` doesn't support resource-level permissions/tag
    conditions (same carve-out as `DescribeInstancesToFindVolumes` below), so tag-scoping it to
    `trial_org_execution`'s per-invocation session would gain nothing.

    Polls this lookup with exponential backoff, for up to `_SNAPSHOT_LOOKUP_POLL_BUDGET_SECONDS`
    (module docstring, issue #190), instead of checking once. `sleep`/`monotonic` are injectable so
    tests can exercise the poll loop without real delays.
    """
    sleep = sleep or time.sleep
    monotonic = monotonic or time.monotonic
    deadline = monotonic() + _SNAPSHOT_LOOKUP_POLL_BUDGET_SECONDS
    interval = _SNAPSHOT_LOOKUP_POLL_INITIAL_INTERVAL_SECONDS
    while True:
        existing = describe_client.describe_snapshots(Filters=[
            {"Name": "tag:JobId", "Values": [job_id]},
            {"Name": "tag:VolumeId", "Values": [volume_id]},
        ])["Snapshots"]
        if existing:
            return existing[0]["SnapshotId"]
        if monotonic() >= deadline:
            break
        sleep(interval)
        interval = min(interval * 2, _SNAPSHOT_LOOKUP_POLL_MAX_INTERVAL_SECONDS)

    return scoped_client.create_snapshot(
        VolumeId=volume_id,
        Description=f"Trial Org {trial_org_id} - auto-destroy snapshot",
        TagSpecifications=[{
            "ResourceType": "snapshot",
            "Tags": [
                {"Key": "TrialOrgId", "Value": trial_org_id},
                {"Key": "DeleteAfter", "Value": delete_after},
                {"Key": "JobId", "Value": job_id},
                {"Key": "VolumeId", "Value": volume_id},
            ],
        }],
    )["SnapshotId"]
