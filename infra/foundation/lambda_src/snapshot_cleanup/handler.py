"""Deletes Trial Org auto-destroy snapshots (snapshot_manager) past their retention window.

Triggered on a daily EventBridge schedule (eventbridge.tf). AWS has no native TTL/lifecycle
mechanism for ad-hoc EBS snapshots - Data Lifecycle Manager only manages snapshots it creates
itself on its own schedule, not one-off snapshots created elsewhere - so this Lambda is the
retention backstop: it scans for snapshots carrying the DeleteAfter tag snapshot_manager sets and
deletes any whose date has passed.
"""
from datetime import date

from ec2_client import get_ec2_client


def handler(_event, _context):
    client = get_ec2_client()
    today = date.today().isoformat()

    deleted_snapshot_ids = []
    paginator = client.get_paginator("describe_snapshots")
    for page in paginator.paginate(OwnerIds=["self"], Filters=[
        {"Name": "tag-key", "Values": ["DeleteAfter"]},
    ]):
        for snapshot in page["Snapshots"]:
            tags = {tag["Key"]: tag["Value"] for tag in snapshot.get("Tags", [])}
            delete_after = tags.get("DeleteAfter")
            if delete_after and delete_after <= today:
                client.delete_snapshot(SnapshotId=snapshot["SnapshotId"])
                deleted_snapshot_ids.append(snapshot["SnapshotId"])

    return {"deleted_snapshot_ids": deleted_snapshot_ids}
