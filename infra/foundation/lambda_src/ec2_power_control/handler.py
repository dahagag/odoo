"""EC2 power-state control for Suspend/Wake (ADR-0021).

OpenTofu never owns a Trial Org instance's running/stopped state; Suspend and Wake call the EC2
API directly via this Lambda, invoked as its own Task state in the state machine
(state_machine.asl.json.tftpl). Step Functions has no native `.sync` integration for
StartInstances/StopInstances the way it does for ECS/Batch/Glue, so this function calls the
boto3 waiter (`instance_stopped`/`instance_running`) itself and only returns once the instance
has actually reached its target state — never immediately after the API call is accepted.
"""
import boto3

_cache = {}


def _client():
    """Returns a lazily-created, module-cached boto3 EC2 client."""
    if "ec2" not in _cache:
        _cache["ec2"] = boto3.client("ec2")
    return _cache["ec2"]


def handler(event, _context):
    """`event` = {"instance_id": "...", "action": "start" | "stop"}."""
    instance_id = event["instance_id"]
    action = event["action"]

    if action not in ("start", "stop"):
        raise ValueError(f"unsupported action: {action!r}")

    client = _client()
    if action == "start":
        client.start_instances(InstanceIds=[instance_id])
        waiter = client.get_waiter("instance_running")
    else:
        client.stop_instances(InstanceIds=[instance_id])
        waiter = client.get_waiter("instance_stopped")

    # The Lambda's own function timeout and the state machine's Task timeout are both
    # ec2_power_timeout_seconds (default 600s / 10 minutes, see foundation/variables.tf) — the
    # SAME budget the waiter runs inside, not a larger one. The waiter's own default config (40
    # attempts * 15s = 600s) would consume that whole budget by itself, leaving no headroom for
    # the start/stop API call or Lambda/Step Functions overhead, so an explicit smaller budget is
    # used here instead.
    waiter.wait(InstanceIds=[instance_id], WaiterConfig={"Delay": 15, "MaxAttempts": 30})

    return {"instance_id": instance_id, "action": action, "reached_target_state": True}
