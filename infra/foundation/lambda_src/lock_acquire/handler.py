"""Trial Org lifecycle lock acquisition (ADR-0020).

Invoked as the state machine's first Task state (state_machine.asl.json.tftpl). A conditional
PutItem, same as the release path uses a conditional Delete, but acquisition additionally needs
to compute the TTL backstop's expiry as a Unix-epoch-seconds number, which the Amazon States
Language has no intrinsic function for (no ISO8601-to-epoch conversion) — done here in Python
instead of fragile ASL date arithmetic.
"""
import os
import time

import boto3
from botocore.exceptions import ClientError

LOCK_TABLE_NAME = os.environ["LOCK_TABLE_NAME"]
LOCK_TTL_SECONDS = int(os.environ.get("LOCK_TTL_SECONDS", str(4 * 3600)))

_dynamodb = None


def _table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb.Table(LOCK_TABLE_NAME)


def handler(event, _context):
    """`event` = {"trial_org_id": "...", "execution_arn": "..."}."""
    trial_org_id = str(event["trial_org_id"])
    execution_arn = event["execution_arn"]

    try:
        _table().put_item(
            Item={
                "trial_org_id": trial_org_id,
                "owner": execution_arn,
                "expires_at": int(time.time()) + LOCK_TTL_SECONDS,
            },
            ConditionExpression="attribute_not_exists(trial_org_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise RuntimeError(
                f"lock already held for trial_org_id={trial_org_id}"
            ) from exc
        raise

    return {"trial_org_id": trial_org_id, "locked": True}
