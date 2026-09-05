"""Stale-lock cleanup for executions a Catch block can't reach (ADR-0020).

Triggered by the EventBridge rule (eventbridge.tf) on Step Functions executions of the Trial Org
lifecycle state machine transitioning to FAILED/ABORTED/TIMED_OUT. Performs the same
owner-token-conditional delete the state machine's own release step does, so an execution that
was stopped externally or timed out at the top level (neither of which a Catch block sees) still
releases its lock promptly instead of relying solely on the DynamoDB TTL backstop.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

LOCK_TABLE_NAME = os.environ["LOCK_TABLE_NAME"]

_cache = {}


def _table():
    """Returns the lock table resource, via a lazily-created, module-cached DynamoDB resource."""
    if "dynamodb" not in _cache:
        _cache["dynamodb"] = boto3.resource("dynamodb")
    return _cache["dynamodb"].Table(LOCK_TABLE_NAME)


def handler(event, _context):
    """`event` is an EventBridge "Step Functions Execution Status Change" event.

    detail.executionArn identifies the execution whose lock (if any) should be released;
    detail.input carries the trial_org_id the execution was invoked with.
    """
    detail = event.get("detail", {})
    execution_arn = detail.get("executionArn")
    if not execution_arn:
        return {"released": False, "reason": "no executionArn in event"}

    raw_input = detail.get("input", "{}")
    try:
        trial_org_id = json.loads(raw_input).get("trial_org_id")
    except (json.JSONDecodeError, AttributeError):
        trial_org_id = None

    if not trial_org_id:
        return {"released": False, "reason": "no trial_org_id in execution input"}

    try:
        _table().delete_item(
            Key={"trial_org_id": str(trial_org_id)},
            ConditionExpression="#owner = :execution_arn",
            ExpressionAttributeNames={"#owner": "owner"},
            ExpressionAttributeValues={":execution_arn": execution_arn},
        )
        return {"released": True, "trial_org_id": trial_org_id}
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # Lock is either already released or held by a different (later) execution for the
            # same Trial Org — never delete an owner token we don't recognize.
            return {"released": False, "reason": "owner token mismatch or already released"}
        raise
