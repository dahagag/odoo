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
"""
import os
from datetime import datetime, timedelta, timezone

from ec2_client import get_ec2_client, get_trial_org_scoped_ec2_client


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


def _snapshot_volume(describe_client, scoped_client, volume_id, trial_org_id, job_id, delete_after):
    """Returns this volume's snapshot id, reusing one already tagged for this exact retry attempt.

    Queried via `describe_client` (the Lambda's own static, account-wide client) rather than
    `scoped_client`: `ec2:DescribeSnapshots` doesn't support resource-level permissions/tag
    conditions (same carve-out as `DescribeInstancesToFindVolumes` below), so tag-scoping it to
    `trial_org_execution`'s per-invocation session would gain nothing.
    """
    existing = describe_client.describe_snapshots(Filters=[
        {"Name": "tag:JobId", "Values": [job_id]},
        {"Name": "tag:VolumeId", "Values": [volume_id]},
    ])["Snapshots"]
    if existing:
        return existing[0]["SnapshotId"]

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
