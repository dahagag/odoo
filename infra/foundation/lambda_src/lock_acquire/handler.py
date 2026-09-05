"""Trial Org lifecycle lock acquisition (ADR-0020).

Invoked as the state machine's first Task state (state_machine.asl.json.tftpl). A conditional
PutItem, same as the release path uses a conditional Delete, but acquisition additionally needs
to compute the TTL backstop's expiry as a Unix-epoch-seconds number, which the Amazon States
Language has no intrinsic function for (no ISO8601-to-epoch conversion) — done here in Python
instead of fragile ASL date arithmetic.
"""
import functools
import os
import time

import boto3
from botocore.exceptions import ClientError

LOCK_TABLE_NAME = os.environ["LOCK_TABLE_NAME"]
LOCK_TTL_SECONDS = int(os.environ.get("LOCK_TTL_SECONDS", str(4 * 3600)))


@functools.cache
def _table():
    """Returns the lock table resource, via a lazily-created, cached DynamoDB resource."""
    return boto3.resource("dynamodb").Table(LOCK_TABLE_NAME)


def handler(event, _context):
    """`event` = {"trial_org_id": "...", "execution_arn": "..."}."""
    trial_org_id = str(event["trial_org_id"])
    execution_arn = event["execution_arn"]

    now = int(time.time())
    try:
        _table().put_item(
            Item={
                "trial_org_id": trial_org_id,
                "owner": execution_arn,
                "expires_at": now + LOCK_TTL_SECONDS,
            },
            # DynamoDB TTL deletion is asynchronous/best-effort (can lag well past expires_at), so
            # a lock whose TTL has already passed can still be present as an item here. Accept
            # taking over such a stale lock instead of only ever accepting a wholly-absent item.
            ConditionExpression="attribute_not_exists(trial_org_id) OR expires_at < :now",
            ExpressionAttributeValues={":now": now},
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise RuntimeError(
                f"lock already held for trial_org_id={trial_org_id}",
            ) from exc
        raise

    return {"trial_org_id": trial_org_id, "locked": True}
