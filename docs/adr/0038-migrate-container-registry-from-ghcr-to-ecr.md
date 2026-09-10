---
status: accepted
---

# Container images move from GHCR to AWS ECR

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)), decided on the
[ECR migration wayfinder map](https://github.com/dahagag/odoo/issues/242).

Every image this repo builds or will build — `odoo-dev`, `odoo-prod` (added in
[#213](https://github.com/dahagag/odoo/issues/213)), the future `tofu-runner` image
(`infra/foundation/variables.tf`'s `tofu_runner_image` already assumes ECR), and the
administration-stack app image ([#195](https://github.com/dahagag/odoo/issues/195), deployed by
[#216](https://github.com/dahagag/odoo/issues/216)/[#217](https://github.com/dahagag/odoo/issues/217))
— moves off GHCR to AWS ECR. This is driven by a shift toward a proprietary/commercial posture:
image confidentiality, vendor independence (the supply chain living inside the AWS account rather
than split across GitHub and AWS), and commercial/licensing posture. Repo visibility (GHCR
currently sits under a public repo) is a separate, already-planned migration and is out of scope
here.

## Topology and naming

One ECR repository per image, not a shared repository with tag prefixes:
`agentic-erp/odoo-dev`, `agentic-erp/odoo-prod`, `agentic-erp/tofu-runner`,
`agentic-erp/administration-stack-api` — a direct translation of GHCR's
`ghcr.io/dahagag/odoo/<image-name>` shape, namespaced under the project in case the Platform
Account ever hosts another project's images. `tofu-runner` and `administration-stack-api` keep
their existing names; no renames.

One-repo-per-image keeps each image's repository policy, lifecycle policy, and encryption
setting independent, which matters concretely for `tofu-runner`: it is the only image needing a
cross-account grant (it runs in the Hosting Account per ADR-0013/ADR-0015, while the registry
lives in the Platform Account), and one-repo-per-image scopes that grant to exactly the
repository that needs it instead of leaking it across a shared policy.

Tags are unchanged — the same content-hash tagging scheme CI already computes (`odoo-dev` hashes
its Dockerfile/docker-scripts/requirements/`.env.example`; `odoo-prod` hashes the git tree-object
IDs of the app tree), which also drives the existing "skip build if tag already published" logic
in `ci.yml`. No new tag scheme is introduced by this migration.

## Auth model

Two independent auth paths, kept separate because they run on different sides of the registry
and carry different risk:

- **CI push (build time)**: a new, narrow, push-only OIDC role, not a reuse of
  [#212](https://github.com/dahagag/odoo/issues/212)'s staging/production deploy roles. This
  mirrors [#153](https://github.com/dahagag/odoo/issues/153)'s discipline — a PR-time image-build
  job gets only the permission it needs, never deploy-adjacent access it doesn't. The role's IAM
  policy grants only the push actions a build needs — `ecr:BatchCheckLayerAvailability`,
  `ecr:BatchGetImage`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`,
  `ecr:CompleteLayerUpload` — scoped to the four repos by ARN pattern
  (`arn:aws:ecr:<region>:<platform_account_id>:repository/agentic-erp/<image>`); no cross-module
  remote-state lookup is needed since the repo names are already fixed by the topology decision
  above. `ecr:PutImageTagMutability` is deliberately excluded, and all four repositories are
  created with `IMMUTABLE` tags, so a pushed content-hash tag can never be silently overwritten.
  A separate statement grants `ecr:GetAuthorizationToken` on `Resource: "*"` — this action doesn't
  support resource-level scoping, so it can't be folded into the per-repository ARN statement
  above.
- **Local-dev pull (developer machines)**: AWS SSO plus `aws ecr get-login-password`. No
  long-lived IAM user credentials are distributed to developer machines, matching
  [#202](https://github.com/dahagag/odoo/issues/202)'s standing-credential-elimination stance.
  `odoo-dev` moves to ECR along with the AWS-deployed images, so this applies to every developer
  running `docker compose up` locally, not just CI. This is unrelated to how staff reach
  Tailscale-only environments ([#199](https://github.com/dahagag/odoo/issues/199),
  [#203](https://github.com/dahagag/odoo/issues/203)): Tailscale is network reachability to a
  remote host, while ECR auth is an AWS API credential a developer's own machine needs regardless
  of network path. The two do not substitute for each other, and nothing about the Tailscale
  decisions changes this.

Cross-account pulls (needed only for `tofu-runner`, consumed by the Hosting Account) require both
an ECR repository policy on the Platform Account side (naming the Hosting Account's ECS task
execution role as principal) and a matching identity-based IAM policy on that execution role —
the two are ANDed, not ORed.

## Lifecycle and encryption

- **`odoo-dev`**: count-based retention, keep the 15 most recent images (`imageCountMoreThan`,
  `tagStatus: any`).
- **`odoo-prod`**: count-based retention, keep the 10 most recent images (slower churn — only
  changes on app-tree changes).

  Both images are content-hash tagged and deduped on push, so a deploy pins a specific
  content-hash tag; count-based retention matches "how many recent builds might we roll back to"
  better than age-based, which risks deleting a tag a stale deploy still references purely
  because it is old. Neither image builds multi-arch today (single-arch `amd64` via
  `docker/build-push-action@v6`, confirmed against `ci.yml`), so ECR's manifest-list expiration
  gotcha (an image referenced by a multi-arch manifest list cannot expire until the manifest list
  itself is expired) does not apply yet.
- **`tofu-runner` / `administration-stack-api`**: retention deferred. Neither has a CI build
  workflow in this repo yet, so no build cadence or tagging scheme exists to set a rule against;
  their retention policy is set when the "`ci.yml` changes per image" implementation issue below
  gives them one.
- **Encryption**: default AES-256 (SSE-S3-style) for all four repositories, not customer-managed
  KMS. No named compliance regime (SOC 2, HIPAA, FedRAMP, GDPR, PCI-DSS, ISO 27001) appears
  anywhere in this repo's docs or ADRs — "compliance" is aspirational language pointing at epic
  #193, never a concrete requirement — and encryption type is fixed at repository creation.
  Revisit only if a real compliance requirement materializes; recreating the repositories is
  acceptable given the clean-cutover posture below.

## Terraform ownership

A new root module, `infra/registry` (Platform-Account-scoped), owns the four ECR repositories
(topology, lifecycle, encryption as decided above), plus `tofu-runner`'s cross-account repository
policy granting pull access to the Hosting Account's ECS task execution role.

`infra/cicd` — not `infra/foundation` — owns the new narrow CI-push role. `infra/foundation` is
Hosting-Account-scoped and never actually hosted #212's deploy roles; those live in `infra/cicd`
(added by PR #240 for #212, not yet merged to `dev/19.0`), which already owns the GitHub OIDC
provider and the `staging_branch`/`production_branch` vars the new role's trust policy reuses
(image builds only run on push to those two branches today).

## Cutover strategy

Clean cutover, not a parallel-run transition period: once ECR is proven (a successful build and
deploy from it), GHCR pushes stop and the existing GHCR images are deleted entirely. Exact timing
of the deletion (immediate vs. after a brief verification window) is left to the implementation
issues below. Deletion (#254) is sequenced after both #253 (CI retargeted to ECR) and #255
(local-dev docs updated) land — every remaining GHCR reference in this repo is gone before the
images themselves are.

## Sequencing

ECR is decided and built before [#216](https://github.com/dahagag/odoo/issues/216)/
[#217](https://github.com/dahagag/odoo/issues/217) proceed. Both are still open and unimplemented,
so there is no existing GHCR-based work to undo — building them against GHCR now just to migrate
immediately after would be wasted effort. The existing `build-prod-image`/`build-image` jobs
added by [#213](https://github.com/dahagag/odoo/issues/213) are **modified in place** to target
ECR rather than retired in favor of new jobs — the build steps themselves (Dockerfile, content-hash
tagging, skip-if-published check) are unchanged, only the push target and its auth action change:
both jobs gain `id-token: write` (for OIDC to the new CI-push role) alongside the existing
`contents: read`, and once the cutover is complete, `packages: write` is dropped — it was
GHCR-specific and grants no useful access once these jobs no longer push there.

## Deferred

- Whether GHCR image deletion happens immediately on cutover or after a brief verification
  window — an implementation detail for the migration issues below.
- Cross-account ECR access for Hosting Account trial/client-org workloads, if any of those ever
  need their own images — everything decided here is Platform-Account-scoped.

## Out of scope

Migrating the GitHub repo itself from public to private — a separate, already-planned effort with
its own migration path.

## Implementation issues filed

- [#252](https://github.com/dahagag/odoo/issues/252) — provision the four ECR repositories and
  the CI push role in Terraform (`infra/registry`, `infra/cicd`).
- [#253](https://github.com/dahagag/odoo/issues/253) — `ci.yml` changes: retarget `odoo-dev`/
  `odoo-prod` builds from GHCR to ECR.
- [#254](https://github.com/dahagag/odoo/issues/254) — retire GHCR: stop pushing, delete existing
  images once ECR is proven.
- [#255](https://github.com/dahagag/odoo/issues/255) — update local-dev docs for AWS SSO-based
  ECR pulls.
