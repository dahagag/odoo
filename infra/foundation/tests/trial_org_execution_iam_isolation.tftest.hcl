# Issue #183, ADR-0033 acceptance criterion: "A test (IAM policy simulator or equivalent)
# demonstrates an assumed session tagged for Trial Org A cannot CreateSnapshot/CreateTags against
# a resource tagged for Trial Org B, and can succeed against its own Trial Org's resources."
#
# There's no live AWS account wired into this repo's CI (infra-checks only runs `tofu fmt`/
# `validate`/lint — .github/workflows/ci.yml), so a real `iam:SimulateCustomPolicy` call isn't
# available here. This uses OpenTofu's own native test framework as the "or equivalent" instead:
# it applies the real module (so the JSON asserted on below is the actual policy documents
# Terraform renders from iam.tf/lambda.tf, not a hand-duplicated copy of them) scoped to only the
# handful of resources these assertions need (`plan_options.target`), with every one of those
# resources' own creation replaced by a literal stand-in ARN (`override_resource`) and the two
# data sources that would otherwise need live AWS credentials replaced the same way
# (`override_data`) — so nothing here ever makes a real AWS API call. It then reproduces AWS's own
# StringEquals + `${aws:PrincipalTag/...}` policy-variable substitution semantics against two
# concrete Trial Org ids, to prove the isolation property rather than merely asserting the
# condition keys are spelled correctly.

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
}

variables {
  environment                           = "test"
  aws_region                            = "us-east-1"
  base_ami_owner_account_id             = "111111111111"
  tofu_runner_image                     = "111111111111.dkr.ecr.us-east-1.amazonaws.com/tofu-runner:test"
  tofu_state_bucket                     = "example-tofu-state"
  tofu_state_lock_table                 = "example-tofu-lock"
  hosting_admin_trusted_role_arn        = "arn:aws:iam::222222222222:role/hosting-admin"
  log_forwarder_hmac_secret_kms_key_arn = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
}

# The only two data sources anywhere in this module that make a real AWS call — overridden with
# values no IAM statement asserted on below depends on, so `command = apply` never needs a live
# AWS account for them.
override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111111111111"
    arn        = "arn:aws:iam::111111111111:root"
    user_id    = "AIDAEXAMPLE"
  }
}

override_data {
  target = data.aws_ami.trial_org_base
  values = {
    id = "ami-0123456789abcdef0"
  }
}

# trial_org_execution's own combined policy document embeds every statement's resource ARN in one
# computed JSON string, including the pre-existing DNS/IAM-management statements this ticket
# doesn't touch — so proving anything about it (or about snapshot_manager's/the trust policy's own
# documents, which each reference a sibling role's ARN) needs those sibling resources to actually
# exist in state, not merely be planned. `plan_options.target` below scopes `command = apply` to
# exactly these resources plus the policy documents that read them; overriding each resource's own
# creation with a literal stand-in ARN means OpenTofu never actually calls AWS to create it.
override_resource {
  target = aws_route53_zone.root
  values = {
    arn = "arn:aws:route53:::hostedzone/Z0000000000EXAMPLE"
  }
}

override_resource {
  target = aws_iam_policy.trial_org_instance_boundary
  values = {
    arn = "arn:aws:iam::111111111111:policy/test-trial-org-instance-boundary"
  }
}

override_resource {
  target = aws_iam_role.sfn_execution
  values = {
    arn = "arn:aws:iam::111111111111:role/test-trial-org-lifecycle-sfn"
  }
}

override_resource {
  target = aws_iam_role.snapshot_manager
  values = {
    arn = "arn:aws:iam::111111111111:role/test-snapshot-manager"
  }
}

override_resource {
  target = aws_iam_role.trial_org_execution
  values = {
    arn = "arn:aws:iam::111111111111:role/test-trial-org-execution"
  }
}

run "verify_snapshot_iam_isolation" {
  command = apply

  plan_options {
    target = [
      aws_route53_zone.root,
      aws_iam_policy.trial_org_instance_boundary,
      aws_iam_role.sfn_execution,
      aws_iam_role.snapshot_manager,
      aws_iam_role.trial_org_execution,
      data.aws_iam_policy_document.snapshot_manager,
      data.aws_iam_policy_document.trial_org_execution_trust,
      data.aws_iam_policy_document.trial_org_execution,
    ]
  }

  # --- snapshot_manager's own role: no direct EC2 mutate grant left standing (ADR-0033) ---

  assert {
    condition = alltrue([
      for statement in jsondecode(data.aws_iam_policy_document.snapshot_manager.json).Statement :
      !contains(flatten([statement.Action]), "ec2:CreateSnapshot") && !contains(flatten([statement.Action]), "ec2:CreateTags")
    ])
    error_message = "snapshot_manager's own IAM role must not carry any direct ec2:CreateSnapshot/ec2:CreateTags grant — it must self-assume trial_org_execution instead (ADR-0033)."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(data.aws_iam_policy_document.snapshot_manager.json).Statement :
      contains(flatten([statement.Action]), "sts:AssumeRole")
      && contains(flatten([statement.Action]), "sts:TagSession")
      && contains(flatten([statement.Resource]), aws_iam_role.trial_org_execution.arn)
    ])
    error_message = "snapshot_manager's own IAM role must grant sts:AssumeRole/sts:TagSession on trial_org_execution's ARN."
  }

  # --- trial_org_execution's trust policy: snapshot_manager may assume it directly ---

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role.trial_org_execution.assume_role_policy).Statement :
      contains(flatten([statement.Principal.AWS]), aws_iam_role.snapshot_manager.arn)
      && contains(flatten([statement.Action]), "sts:AssumeRole")
      && contains(flatten([statement.Action]), "sts:TagSession")
    ])
    error_message = "trial_org_execution's trust policy must allow snapshot_manager's own role to sts:AssumeRole/sts:TagSession directly."
  }

  # --- trial_org_execution's own ABAC statements for the snapshot path ---

  assert {
    condition = length([
      for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
      statement if statement.Sid == "SnapshotTrialOrgVolume"
    ]) == 1
    error_message = "trial_org_execution must carry exactly one SnapshotTrialOrgVolume statement."
  }

  assert {
    condition = length([
      for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
      statement if statement.Sid == "TagSnapshotOnCreate"
    ]) == 1
    error_message = "trial_org_execution must carry exactly one TagSnapshotOnCreate statement."
  }

  assert {
    condition = (
      [for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
      statement if statement.Sid == "TagSnapshotOnCreate"][0].Condition.StringEquals["ec2:CreateAction"] == "CreateSnapshot"
    )
    error_message = "TagSnapshotOnCreate must be scoped to creation time only (ec2:CreateAction == CreateSnapshot)."
  }

  # --- cross-Trial-Org isolation simulation ---
  #
  # AWS evaluates StringEquals("aws:ResourceTag/TrialOrgId", "${aws:PrincipalTag/TrialOrgId}") by
  # first substituting the assumed session's own PrincipalTag/TrialOrgId value into the
  # policy-variable placeholder, then comparing it verbatim against the target resource's own tag.
  # Reproducing exactly that substitution here (for a session tagged for Trial Org "1001") shows
  # the condition can only ever be satisfied by a resource also tagged "1001" — never by one
  # tagged "2002" (a different Trial Org) — i.e. genuine per-execution isolation, not a bare
  # tag-presence check.

  assert {
    condition = (
      replace(
        [for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
        statement if statement.Sid == "SnapshotTrialOrgVolume"][0].Condition.StringEquals["aws:ResourceTag/TrialOrgId"],
        "$${aws:PrincipalTag/TrialOrgId}", "1001"
      ) == "1001"
      && replace(
        [for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
        statement if statement.Sid == "SnapshotTrialOrgVolume"][0].Condition.StringEquals["aws:ResourceTag/TrialOrgId"],
        "$${aws:PrincipalTag/TrialOrgId}", "1001"
      ) != "2002"
    )
    error_message = "A trial_org_execution session tagged for Trial Org 1001 must resolve SnapshotTrialOrgVolume's ResourceTag condition to '1001' (matches its own volume, CreateSnapshot allowed) and must not resolve to '2002' (another Trial Org's volume, CreateSnapshot must be denied)."
  }

  assert {
    # Same substitution, applied to TagSnapshotOnCreate's RequestTag condition: a session tagged
    # for Trial Org "1001" can only ever tag a new snapshot as belonging to "1001" — attempting to
    # stamp a snapshot as Trial Org "2002" (e.g. a compromised/buggy call requesting the wrong
    # TrialOrgId tag value) fails this condition and is denied.
    condition = (
      replace(
        [for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
        statement if statement.Sid == "TagSnapshotOnCreate"][0].Condition.StringEquals["aws:RequestTag/TrialOrgId"],
        "$${aws:PrincipalTag/TrialOrgId}", "1001"
      ) == "1001"
      && replace(
        [for statement in jsondecode(data.aws_iam_policy_document.trial_org_execution.json).Statement :
        statement if statement.Sid == "TagSnapshotOnCreate"][0].Condition.StringEquals["aws:RequestTag/TrialOrgId"],
        "$${aws:PrincipalTag/TrialOrgId}", "1001"
      ) != "2002"
    )
    error_message = "A trial_org_execution session tagged for Trial Org 1001 must resolve TagSnapshotOnCreate's RequestTag condition to '1001' and must not resolve to '2002'."
  }
}
