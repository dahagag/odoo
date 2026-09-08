"""Shared boto3 EC2 client helpers - used by both snapshot_manager and snapshot_cleanup (#174),
which each need one but have no other reason to share a Lambda.

`get_ec2_client()` is a lazily-created, cached client under the Lambda's own static credentials,
used for read-only/account-wide calls. `get_trial_org_scoped_ec2_client()` (issue #183, ADR-0033)
is never cached - each call self-assumes a fresh per-invocation session instead.

Not a real Python package: each Lambda's own `data.archive_file` (infra/foundation/lambda.tf)
zips this file in alongside that Lambda's own `handler.py` as a sibling module at the zip root,
rather than each handler defining its own copy of the same helper.
"""
import functools

import boto3


@functools.cache
def get_ec2_client():
    """Returns a lazily-created, cached boto3 EC2 client."""
    return boto3.client("ec2")


def get_trial_org_scoped_ec2_client(role_arn, trial_org_id, session_name):
    """Returns a boto3 EC2 client backed by a fresh per-invocation `trial_org_execution` session.

    Self-assumes `role_arn`, tagging the session with `trial_org_id` (issue #183, ADR-0033), so
    the resulting client's own EC2 calls are authorized only against that one Trial Org's tagged
    resources - never cached across invocations, since the TrialOrgId session tag is per-call.
    """
    credentials = boto3.client("sts").assume_role(
        RoleArn=role_arn,
        RoleSessionName=session_name,
        Tags=[{"Key": "TrialOrgId", "Value": trial_org_id}],
    )["Credentials"]
    return boto3.client(
        "ec2",
        aws_access_key_id=credentials["AccessKeyId"],
        aws_secret_access_key=credentials["SecretAccessKey"],
        aws_session_token=credentials["SessionToken"],
    )
