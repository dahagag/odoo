"""Shared CloudWatch Logs -> Odoo webhook forwarder (ADR-0023).

Declared once in the static foundation and subscribed to by every Trial Org's own log group
(infra/modules/trial_org). Reads the log-group name off each event to know which Trial Org it's
forwarding for, so one Lambda serves every trial rather than one-per-trial.

Not exercised by `tofu validate`/`tofu plan` (those only check the OpenTofu that declares this
function and zips this file) — this is the function body AWS actually runs once applied.
"""
import base64
import gzip
import hashlib
import hmac
import json
import os
import urllib.request

import boto3

WEBHOOK_URL_PARAM = os.environ["WEBHOOK_URL_SSM_PARAMETER"]
HMAC_SECRET_PARAM = os.environ["HMAC_SECRET_SSM_PARAMETER"]
LOG_GROUP_PREFIX = os.environ.get("LOG_GROUP_PREFIX", "/hosting/trial-orgs/")

_cache = {}
# Cached across warm invocations of the same execution environment. Both parameters change rarely
# (an ops rotation, not a per-invocation value), so re-fetching them from SSM on every log batch
# would just add latency and API calls for no freshness benefit within one container's lifetime.
_parameter_cache = {}


def _ssm_client():
    """Returns a lazily-created, module-cached boto3 SSM client."""
    if "ssm" not in _cache:
        _cache["ssm"] = boto3.client("ssm")
    return _cache["ssm"]


def _get_parameter(name, decrypt=False):
    """Returns an SSM parameter's value, cached in-process for the container's lifetime."""
    if name not in _parameter_cache:
        resp = _ssm_client().get_parameter(Name=name, WithDecryption=decrypt)
        _parameter_cache[name] = resp["Parameter"]["Value"]
    return _parameter_cache[name]


def _sign(body_bytes, secret):
    """Returns the hex-encoded HMAC-SHA256 signature of `body_bytes` under `secret`."""
    return hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()


def handler(event, _context):
    """Entry point for the CloudWatch Logs subscription filter.

    `event["awslogs"]["data"]` is base64+gzip encoded JSON containing `logGroup`, `logStream`,
    and `logEvents` (per AWS's documented CloudWatch Logs subscription filter payload shape).
    """
    compressed = base64.b64decode(event["awslogs"]["data"])
    payload = json.loads(gzip.decompress(compressed))

    # CloudWatch Logs also delivers periodic CONTROL_MESSAGE payloads (health checks) on the same
    # subscription, carrying one synthetic logEvents entry with no real log content — these have
    # no logGroup/logStream, so forwarding one would post a webhook with log_group="" and
    # trial_org_id=None. Only DATA_MESSAGE payloads carry real Trial Org log events.
    if payload.get("messageType") != "DATA_MESSAGE":
        return {"forwarded": 0}

    log_group = payload.get("logGroup", "")
    log_events = payload.get("logEvents", [])
    if not log_events:
        return {"forwarded": 0}

    # Trial Org id is the path segment after LOG_GROUP_PREFIX in the log group name set by
    # infra/modules/trial_org (e.g. "/hosting/trial-orgs/482" -> "482").
    trial_org_id = (
        log_group[len(LOG_GROUP_PREFIX):] if log_group.startswith(LOG_GROUP_PREFIX) else None
    )

    body = json.dumps(
        {
            "trial_org_id": trial_org_id,
            "log_group": log_group,
            "log_stream": payload.get("logStream"),
            "events": [
                {"timestamp": e["timestamp"], "message": e["message"]} for e in log_events
            ],
        },
    ).encode("utf-8")

    webhook_url = _get_parameter(WEBHOOK_URL_PARAM)
    hmac_secret = _get_parameter(HMAC_SECRET_PARAM, decrypt=True)
    signature = _sign(body, hmac_secret)

    request = urllib.request.Request(
        webhook_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Hosting-Signature": signature,
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()

    return {"forwarded": len(log_events)}
