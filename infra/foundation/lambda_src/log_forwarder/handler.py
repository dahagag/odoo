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

WEBHOOK_URL_PARAM = os.environ["WEBHOOK_URL_SSM_PARAMETER"]
HMAC_SECRET_PARAM = os.environ["HMAC_SECRET_SSM_PARAMETER"]

_ssm = None


def _ssm_client():
    global _ssm
    if _ssm is None:
        import boto3

        _ssm = boto3.client("ssm")
    return _ssm


def _get_parameter(name, decrypt=False):
    resp = _ssm_client().get_parameter(Name=name, WithDecryption=decrypt)
    return resp["Parameter"]["Value"]


def _sign(body_bytes, secret):
    return hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()


def handler(event, _context):
    """Entry point for the CloudWatch Logs subscription filter.

    `event["awslogs"]["data"]` is base64+gzip encoded JSON containing `logGroup`, `logStream`,
    and `logEvents` (per AWS's documented CloudWatch Logs subscription filter payload shape).
    """
    compressed = base64.b64decode(event["awslogs"]["data"])
    payload = json.loads(gzip.decompress(compressed))

    log_group = payload.get("logGroup", "")
    log_events = payload.get("logEvents", [])
    if not log_events:
        return {"forwarded": 0}

    # Trial Org id is the path segment after "/hosting/trial-orgs/" in the log group name set by
    # infra/modules/trial_org (e.g. "/hosting/trial-orgs/482").
    prefix = "/hosting/trial-orgs/"
    trial_org_id = log_group[len(prefix):] if log_group.startswith(prefix) else None

    body = json.dumps(
        {
            "trial_org_id": trial_org_id,
            "log_group": log_group,
            "log_stream": payload.get("logStream"),
            "events": [
                {"timestamp": e["timestamp"], "message": e["message"]} for e in log_events
            ],
        }
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
