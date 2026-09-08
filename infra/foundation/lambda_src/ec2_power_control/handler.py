"""EC2 power-state control for Suspend/Wake (ADR-0021).

OpenTofu never owns a Trial Org instance's running/stopped state; Suspend and Wake call the EC2
API directly via this Lambda, invoked as its own Task state in the state machine
(state_machine.asl.json.tftpl). Step Functions has no native `.sync` integration for
StartInstances/StopInstances the way it does for ECS/Batch/Glue, so this function calls the
boto3 waiter (`instance_stopped`/`instance_running`) itself and only returns once the instance
has actually reached its target state — never immediately after the API call is accepted.

This Lambda's own static role holds no direct ec2:StartInstances/ec2:StopInstances permission
(issue #184, ADR-0033): it self-assumes `trial_org_execution` via `TRIAL_ORG_EXECUTION_ROLE_ARN`,
tagging the session with the target instance's own TrialOrgId tag, before making the start/stop
call - so its mutate access is genuinely scoped to the one Trial Org this invocation's instance_id
belongs to, not "any tagged Trial Org resource". The invocation payload only carries
instance_id/action (unchanged), not a TrialOrgId, so that tag is resolved via DescribeInstances
first - the describe-only reads stay on this Lambda's own static role (ADR-0033's carve-out for
actions AWS doesn't support tag-conditioning on), the same as the waiter's own reads below.
"""
import os

from ec2_client import get_ec2_client, get_trial_org_scoped_ec2_client


def _trial_org_id_for_instance(describe_client, instance_id):
    reservations = describe_client.describe_instances(InstanceIds=[instance_id])["Reservations"]
    instance = reservations[0]["Instances"][0]
    tags = {tag["Key"]: tag["Value"] for tag in instance.get("Tags", [])}
    if "TrialOrgId" not in tags:
        raise ValueError(f"instance {instance_id} has no TrialOrgId tag")
    return tags["TrialOrgId"]


def handler(event, _context):
    """`event` = {"instance_id": "...", "action": "start" | "stop"}."""
    instance_id = event["instance_id"]
    action = event["action"]

    if action not in ("start", "stop"):
        raise ValueError(f"unsupported action: {action!r}")

    describe_client = get_ec2_client()
    trial_org_id = _trial_org_id_for_instance(describe_client, instance_id)
    scoped_client = get_trial_org_scoped_ec2_client(
        role_arn=os.environ["TRIAL_ORG_EXECUTION_ROLE_ARN"],
        trial_org_id=trial_org_id,
        session_name=f"ec2-power-control-{trial_org_id}",
    )

    if action == "start":
        scoped_client.start_instances(InstanceIds=[instance_id])
        waiter = describe_client.get_waiter("instance_running")
    else:
        scoped_client.stop_instances(InstanceIds=[instance_id])
        waiter = describe_client.get_waiter("instance_stopped")

    # The Lambda's own function timeout and the state machine's Task timeout are both
    # ec2_power_timeout_seconds (default 600s / 10 minutes, see foundation/variables.tf) — the
    # SAME budget the waiter runs inside, not a larger one. The waiter's own default config (40
    # attempts * 15s = 600s) would consume that whole budget by itself, leaving no headroom for
    # the start/stop API call or Lambda/Step Functions overhead, so an explicit smaller budget is
    # used here instead.
    waiter.wait(InstanceIds=[instance_id], WaiterConfig={"Delay": 15, "MaxAttempts": 30})

    return {"instance_id": instance_id, "action": action, "reached_target_state": True}
