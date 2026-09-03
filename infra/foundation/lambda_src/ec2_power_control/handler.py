"""EC2 power-state control for Suspend/Wake (ADR-0021).

OpenTofu never owns a Trial Org instance's running/stopped state; Suspend and Wake call the EC2
API directly via this Lambda, invoked as its own Task state in the state machine
(state_machine.asl.json.tftpl). Step Functions has no native `.sync` integration for
StartInstances/StopInstances the way it does for ECS/Batch/Glue, so this function calls the
boto3 waiter (`instance_stopped`/`instance_running`) itself and only returns once the instance
has actually reached its target state — never immediately after the API call is accepted.
"""
import boto3

_ec2 = None


def _client():
    global _ec2
    if _ec2 is None:
        _ec2 = boto3.client("ec2")
    return _ec2


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

    # Default waiter config: 40 attempts * 15s delay = up to 10 minutes, well inside the state
    # machine's own 30-minute Task timeout.
    waiter.wait(InstanceIds=[instance_id])

    return {"instance_id": instance_id, "action": action, "reached_target_state": True}
