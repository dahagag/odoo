# ---------------------------------------------------------------------------
# GitHub Actions OIDC identity provider (issue #212, revisiting ADR-0017: no self-hosted
# runner, no long-lived AWS keys — a workflow run assumes one of the two roles below via
# sts:AssumeRoleWithWebIdentity, presenting its own GitHub-issued OIDC token instead).
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = local.github_oidc_provider_url
  client_id_list  = [local.github_oidc_audience]
  thumbprint_list = [var.github_oidc_thumbprint]
}

# ---------------------------------------------------------------------------
# Two separate, narrow roles (issue #212 / #202: "CI must not hold one role that can deploy
# anywhere"). Each trust policy is scoped to this exact repository AND the one branch that
# deploys through it, via the `sub` claim GitHub's OIDC token carries
# (repo:<owner>/<repo>:ref:refs/heads/<branch>) — a workflow run on an arbitrary branch, or a
# fork's pull_request run (which carries a different repo in its own `sub` claim entirely),
# cannot assume either role. Branch protection on staging_branch/production_branch is a
# separate, independent control; this trust policy is the actual gate (#202's Implementation
# Decisions: "Branch protection alone is not the control; the trust policy is.").
#
# Permissions on both roles are a deliberate placeholder. #202 puts the staging environment (and
# so, the concrete AWS resources a deploy touches — ECR push, ECS service update, etc.) out of
# scope until a later child ticket defines it, so there is nothing narrow-but-real to grant yet.
# sts:GetCallerIdentity is implicitly allowed to any assumed role regardless of its policy
# document, so granting it explicitly here has no security effect — it exists only as a named,
# visible statement for that follow-up ticket to extend, rather than leaving each role with an
# empty policy document and no anchor to edit.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "staging_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_audience]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.staging_branch}"]
    }
  }
}

resource "aws_iam_role" "staging_deploy" {
  name               = "github-actions-staging-deploy"
  assume_role_policy = data.aws_iam_policy_document.staging_deploy_trust.json
}

# ---------------------------------------------------------------------------
# Issue #215: staging_deploy's and production_deploy's policies stay a deploy-permission
# placeholder for the app deploy workflow #202/#216 defers to a later ticket (see the module-level
# comment above), but they now carry a second, real, narrow purpose — applying infra/cicd and
# infra/registry themselves, staging_deploy on a push to staging_branch and production_deploy on a
# push to production_branch — since #215's acceptance criteria call for "a merge... applies the
# plan using the corresponding branch-scoped role," reusing these two roles rather than adding a
# third pair. infra_management_statements below is that grant, shared verbatim between both roles
# via source_policy_documents (not copy-pasted per role): OpenTofu S3-backend state read/write +
# DynamoDB lock, and management of the exact resource shapes infra/cicd (its own OIDC provider +
# these four roles) and infra/registry (the four ECR repositories) create — nothing broader.
#
# Self-management tradeoff, called out deliberately rather than left implicit: this grants each
# role the ability to modify its own (and the other's) trust policy and inline policy via a
# `tofu apply` from its own branch. That is not a new escalation path — anyone who can merge to
# either branch can already edit oidc.tf itself and have this same effect on the next apply — but
# it does mean the blast radius of a compromised branch merge extends to these IAM resources
# directly, not just to whatever the role's policy said at merge time.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "infra_management_statements" {
  statement {
    sid    = "TofuStateBackend"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = local.managed_state_object_arns
  }

  statement {
    sid    = "TofuStateLock"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [var.tofu_state_lock_table_arn]
  }

  statement {
    sid    = "ManageCicdOidcAndRoles"
    effect = "Allow"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:CreateOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
      "iam:TagOpenIDConnectProvider",
      "iam:GetRole",
      "iam:CreateRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [
      local.managed_oidc_provider_arn,
      local.managed_role_name_pattern,
    ]
  }

  statement {
    sid    = "ManageRegistryRepositories"
    effect = "Allow"
    actions = [
      "ecr:CreateRepository",
      "ecr:DescribeRepositories",
      "ecr:DeleteRepository",
      "ecr:PutLifecyclePolicy",
      "ecr:GetLifecyclePolicy",
      "ecr:DeleteLifecyclePolicy",
      "ecr:SetRepositoryPolicy",
      "ecr:GetRepositoryPolicy",
      "ecr:DeleteRepositoryPolicy",
      "ecr:PutImageTagMutability",
      "ecr:PutImageScanningConfiguration",
      "ecr:TagResource",
      "ecr:ListTagsForResource",
    ]
    resources = local.ecr_repository_arns
  }
}

data "aws_iam_policy_document" "staging_deploy" {
  source_policy_documents = [data.aws_iam_policy_document.infra_management_statements.json]

  statement {
    sid       = "PlaceholderCallerIdentity"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "staging_deploy" {
  name   = "github-actions-staging-deploy"
  role   = aws_iam_role.staging_deploy.id
  policy = data.aws_iam_policy_document.staging_deploy.json
}

data "aws_iam_policy_document" "production_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_audience]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.production_branch}"]
    }
  }
}

resource "aws_iam_role" "production_deploy" {
  name               = "github-actions-production-deploy"
  assume_role_policy = data.aws_iam_policy_document.production_deploy_trust.json
}

# See infra_management_statements above (issue #215) for the full rationale — production_deploy
# carries the same infra-management/backend grant, so a push to production_branch can apply
# infra/cicd and infra/registry too.

data "aws_iam_policy_document" "production_deploy" {
  source_policy_documents = [data.aws_iam_policy_document.infra_management_statements.json]

  statement {
    sid       = "PlaceholderCallerIdentity"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "production_deploy" {
  name   = "github-actions-production-deploy"
  role   = aws_iam_role.production_deploy.id
  policy = data.aws_iam_policy_document.production_deploy.json
}

# ---------------------------------------------------------------------------
# ECR push role (ADR-0038 / issue #252): a third, separate role from the two above — not a reuse
# of staging_deploy/production_deploy, mirroring #153's discipline that a PR-time image-build job
# gets only the permission it needs, never deploy-adjacent access it doesn't.
#
# Its trust condition matches `job_workflow_ref`, not `sub` (issue #259). Two things ruled out
# `sub`: (1) ci.yml's build-image/build-prod-image jobs only ever run on a `pull_request` event
# (ci.yml has no `push` trigger), whose `sub` carries no branch component at all — a
# `ref:refs/heads/<branch>` condition, as staging_deploy/production_deploy above use, can never
# match it; (2) `sub` for this event is also not the plain `repo:<owner>/<repo>:pull_request`
# shape GitHub's own docs show as the generic example — this account has ID-qualified claims
# enabled, so `sub` is actually `repo:<owner>@<owner_id>/<repo>@<repo_id>:pull_request`, confirmed
# by decoding an actual token. A same-account-scoped custom claim like `repository` would dodge
# that ID problem, but AWS's own IAM validation rejects it outright: a trust policy for a GitHub
# OIDC principal must condition on `sub` or `job_workflow_ref` specifically (confirmed against
# the real account: `UpdateAssumeRolePolicy` returned `MalformedPolicyDocument: ... must evaluate
# ... token.actions.githubusercontent.com:sub or token.actions.githubusercontent.com:job_workflow_ref
# which is not scoped to all` when this condition used `repository` instead). `job_workflow_ref`
# turns out to use plain `owner/repo` naming (no IDs) even on this account — confirmed from the
# same decoded token (`job_workflow_ref: "dahagag/odoo/.github/workflows/ci.yml@refs/pull/261/merge"`)
# — so it's used here instead, with `StringLike` (not `StringEquals`) since the trailing
# `refs/pull/<PR_NUMBER>/merge` segment varies per PR.
#
# IMPORTANT — this condition alone does NOT exclude a fork's pull_request run: for `pull_request`
# (not `pull_request_target`), GitHub always executes the job using the *base* repository's own
# workflow file and permissions, so `job_workflow_ref`/`sub`/`repository` in the token are the
# base repo (dahagag/odoo) regardless of whether the PR's head branch lives in this repo or a
# fork of it — there is no OIDC claim this trigger type exposes that distinguishes the two. The
# actual fork exclusion is `ci.yml`'s own `github.event.pull_request.head.repo.full_name ==
# github.repository` job-level guard (added alongside this fix), checked before the job ever
# requests an OIDC token — this trust condition only narrows "some pull_request against this
# repo's ci.yml" down from "any GitHub Actions run anywhere with this OIDC provider."
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecr_push_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_audience]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:job_workflow_ref"
      values   = ["${var.github_repository}/.github/workflows/ci.yml@refs/pull/*/merge"]
    }
  }
}

resource "aws_iam_role" "ecr_push" {
  name               = "github-actions-ecr-push"
  assume_role_policy = data.aws_iam_policy_document.ecr_push_trust.json
}

data "aws_iam_policy_document" "ecr_push" {
  # ecr:GetAuthorizationToken (the `docker login` step of every ECR push) is not a
  # resource-level action — ECR only recognizes it against resource "*"; scoping it to the four
  # repository ARNs below would silently never match, leaving the push flow unable to
  # authenticate. It carries no confidentiality of its own (the token is still repo-scoped by the
  # ecr:* grant below, and STS already scopes who can assume this role at all), so granting it
  # here has no security effect beyond letting the role actually authenticate.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      # Not a pull grant despite the name: docker/build-push-action's underlying BuildKit
      # exporter calls BatchGetImage during push itself, to check whether the manifest it's about
      # to write already exists (skip re-pushing an identical one) — confirmed on issue #259's
      # PR #258 run, which failed at exactly this call once OIDC auth itself started working:
      # "denied: ... not authorized to perform: ecr:BatchGetImage ... because no identity-based
      # policy allows the ecr:BatchGetImage action". Omitting it (the original ADR-0038 intent,
      # "no pull actions") breaks every push, not just a hypothetical pull path.
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = local.ecr_repository_arns
  }

  # ci.yml's test job assumes this same role to pull back the odoo-dev image build-image just
  # pushed (issue #259) — BatchGetImage above covers the manifest fetch (already granted on all
  # four repos for the push-time existence check), but actually reading a layer's bytes needs
  # GetDownloadUrlForLayer too, which EcrPush doesn't grant. Scoped to odoo-dev only: it's the
  # only repository anything in this repo's CI pulls back.
  statement {
    sid       = "EcrTestPull"
    effect    = "Allow"
    actions   = ["ecr:GetDownloadUrlForLayer"]
    resources = [local.odoo_dev_repository_arn]
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "github-actions-ecr-push"
  role   = aws_iam_role.ecr_push.id
  policy = data.aws_iam_policy_document.ecr_push.json
}

# ---------------------------------------------------------------------------
# infra_plan (issue #215): a fourth, separate, read-only role — a `tofu plan` on a pull request
# needs real credentials to show a meaningful diff (not just an empty-state "everything would be
# created"), but staging_deploy/production_deploy's trust conditions are deliberately scoped to a
# `push` event's `ref:refs/heads/<branch>` `sub` claim (see above), which a `pull_request` run's
# token never carries — so neither can ever be assumed at PR time, by design.
#
# This can't reuse ecr_push's trust condition pattern to become "the PR-time staging_deploy" or
# "the PR-time production_deploy" either: `job_workflow_ref` (the one condition a `pull_request`
# token exposes that AWS's IAM validation accepts — see ecr_push_trust's comment) carries no branch
# information at all, only the workflow file and PR-merge ref. A trust condition built from it
# can't distinguish "a PR targeting staging_branch" from "a PR targeting production_branch" — so
# splitting a PR-time role in two by branch would be a false isolation guarantee, granting either
# role to any PR regardless of its base. One shared, read-only role for both is the honest scoping:
# read access carries no isolation risk to share, and `apply`'s real branch isolation still lives
# entirely in staging_deploy/production_deploy's push-time trust conditions above, untouched by
# this role's existence.
#
# `-lock=false` on the `tofu plan` step this role runs (ci.yml) is deliberate too, not an oversight:
# it lets this role stay read-only (no DynamoDB write grant, unlike staging_deploy/production_deploy's
# TofuStateLock statement), at the cost of a small race window against a concurrent real apply —
# acceptable for a plan whose only purpose is showing a diff for human review, never mutating state.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "infra_plan_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_audience]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:job_workflow_ref"
      values   = ["${var.github_repository}/.github/workflows/ci.yml@refs/pull/*/merge"]
    }
  }
}

resource "aws_iam_role" "infra_plan" {
  name               = "github-actions-infra-plan"
  assume_role_policy = data.aws_iam_policy_document.infra_plan_trust.json
}

data "aws_iam_policy_document" "infra_plan" {
  statement {
    sid       = "TofuStateBackendRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = local.managed_state_object_arns
  }

  statement {
    sid    = "ReadCicdOidcAndRoles"
    effect = "Allow"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = [
      local.managed_oidc_provider_arn,
      local.managed_role_name_pattern,
    ]
  }

  statement {
    sid    = "ReadRegistryRepositories"
    effect = "Allow"
    actions = [
      "ecr:DescribeRepositories",
      "ecr:GetLifecyclePolicy",
      "ecr:GetRepositoryPolicy",
      "ecr:ListTagsForResource",
    ]
    resources = local.ecr_repository_arns
  }
}

resource "aws_iam_role_policy" "infra_plan" {
  name   = "github-actions-infra-plan"
  role   = aws_iam_role.infra_plan.id
  policy = data.aws_iam_policy_document.infra_plan.json
}
