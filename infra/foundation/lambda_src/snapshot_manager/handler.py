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
"""
import os
from datetime import datetime, timedelta, timezone

from ec2_client import get_ec2_client, get_trial_org_scoped_ec2_client


def handler(event, _context):
    """`event` = {"trial_org_id": "...", "retention_days": 7}."""
    trial_org_id = str(event["trial_org_id"])
    retention_days = int(event["retention_days"])

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
        scoped_client.create_snapshot(
            VolumeId=volume_id,
            Description=f"Trial Org {trial_org_id} - auto-destroy snapshot",
            TagSpecifications=[{
                "ResourceType": "snapshot",
                "Tags": [
                    {"Key": "TrialOrgId", "Value": trial_org_id},
                    {"Key": "DeleteAfter", "Value": delete_after},
                ],
            }],
        )["SnapshotId"]
        for volume_id in volume_ids
    ]

    return {"snapshotted": True, "snapshot_ids": snapshot_ids, "delete_after": delete_after}
