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

data "aws_iam_policy_document" "staging_deploy" {
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

data "aws_iam_policy_document" "production_deploy" {
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
# gets only the permission it needs, never deploy-adjacent access it doesn't. Its trust policy
# reuses the same OIDC provider and is scoped to whichever of staging_branch/production_branch a
# workflow run is on, since image builds only run on push to those two branches today (a
# single-valued condition key matches if the token's `sub` equals any value in the list — this is
# an OR, not a second independent gate).
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
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/${var.staging_branch}",
        "repo:${var.github_repository}:ref:refs/heads/${var.production_branch}",
      ]
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
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = local.ecr_repository_arns
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "github-actions-ecr-push"
  role   = aws_iam_role.ecr_push.id
  policy = data.aws_iam_policy_document.ecr_push.json
}
