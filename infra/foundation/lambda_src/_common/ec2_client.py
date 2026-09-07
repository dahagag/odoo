"""Shared, lazily-created, cached boto3 EC2 client - used by both snapshot_manager and
snapshot_cleanup (#174), which each need one but have no other reason to share a Lambda.

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
