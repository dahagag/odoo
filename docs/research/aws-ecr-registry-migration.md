# AWS ECR registry migration

Research date: 2026-09-11. Scope: reference material for issue
[dahagag/odoo#247](https://github.com/dahagag/odoo/issues/247) ("Research AWS ECR capabilities
for the registry migration"), part of wayfinder map issue #242. The repo currently pushes 4
container images via PR-driven CI builds to GHCR (GitHub Container Registry). This note
investigates whether/how a move to Amazon ECR would work, and what it would cost, against
primary sources only (`docs.aws.amazon.com`, `aws.amazon.com` pricing pages, and
`docs.github.com`). It does not recommend a choice — it exists to inform a follow-up decision,
in the same spirit as
[`docs/research/aws-hosting-foundation-tooling.md`](aws-hosting-foundation-tooling.md).

**Account-split context** (from [ADR-0013](../adr/0013-aws-organizations-for-hosting-foundation.md)
and [ADR-0015](../adr/0015-production-migrates-to-aws-platform-account.md)): agentic-erp's
production instance runs in the **Platform Account**; Trial Org workloads run in a separate
**Hosting Account**, in the same AWS Organization. Any ECR registry created for this migration
would live in one of these accounts (most likely the Platform Account, alongside production), and
anything in the Hosting Account (e.g. an ECS task there) that needs to pull images would be a
cross-account pull relative to that registry — which is why topic 3 below matters here
specifically, not just as generic ECR trivia.

## Summary

- **Lifecycle policies** can expire/archive images by age (`sinceImagePushed`), by count
  (`imageCountMoreThan`), by time-since-last-pull (`sinceImagePulled`), or by tag pattern/prefix
  (`tagPatternList`/`tagPrefixList`, mutually exclusive per rule); rules are evaluated by
  `rulePriority` (lower number = higher priority, evaluated first) and an image is expired by at
  most one rule — but a rule with `tagStatus: any` must carry the *highest* priority number
  (evaluated last), and **an image referenced by a manifest list cannot be expired/archived until
  the manifest list itself is deleted/archived**, which matters for multi-arch images.
  ([AWS docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html))
- **Encryption at rest**: default AES-256 (S3-managed keys) costs nothing extra; a customer-managed
  KMS key (SSE-KMS) buys independent rotation control, the ability to revoke/re-grant decrypt
  access separately from IAM, CloudTrail visibility via an ECR-specific encryption context, and
  cross-account key sharing via the key policy — but it adds AWS KMS's own per-request and
  monthly key charges, and the repository's encryption type **cannot be changed after creation**.
  ([AWS docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html))
- **Cross-account pull is fully supported** and needs two independent pieces configured: an ECR
  **repository policy** (resource-based, via `aws ecr set-repository-policy` or console) on the
  Platform-Account repo granting the Hosting-Account principal `ecr:BatchGetImage`,
  `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` — **and** an IAM policy on the
  pulling side's task execution role granting those same actions plus
  `ecr:GetAuthorizationToken`; either side denying blocks the pull.
  ([AWS docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html))
  This is separate from cross-*Region* replication, which is a distinct opt-in feature for
  copying images between regions/accounts and is not needed for a same-region cross-account pull.
  ([AWS docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html))
- **Vulnerability scanning**: basic scanning is Clair-based, OS-only, and re-scans only on push
  (or manually); enhanced scanning is Amazon-Inspector-based, covers OS **and** language-package
  vulnerabilities (Python, Node, etc.), and continuously re-scans as new CVEs are published —
  worth it for images that bundle `requirements.txt`/`node_modules` dependencies. Enhanced
  scanning is billed separately through Amazon Inspector (~$0.09 per initial image scan, ~$0.01
  per rescan), while basic scanning is free/included with ECR.
  ([AWS docs](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html),
  [Inspector ECR scanning docs](https://docs.aws.amazon.com/inspector/latest/user/enable-disable-scanning-ecr.html))
- **Pricing**: ECR private storage is $0.10/GB-month beyond a 500 MB/month free-tier allowance for
  new accounts (first year); same-region data transfer to AWS compute (ECS/EKS/Lambda/EC2) is
  free, cross-region/internet egress is billed per GB. GHCR's Container Registry storage and
  bandwidth is **currently free for both public and private images** (GitHub's own qualifier: this
  policy "may change with advance notice") — meaningfully more generous than ECR's private-storage
  pricing for a small, 4-image use case.
  ([ECR pricing](https://aws.amazon.com/ecr/pricing/), [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages))
- For this repo's current shape (4 images, frequent PR-driven builds, CI-runner and same-region
  ECS pulls), GHCR's free container-registry storage/bandwidth is a real cost advantage over ECR
  today; ECR's advantages are the AWS-native IAM integration (no PAT/OIDC bridge needed for
  same-account ECS pulls), lifecycle-policy automation, and the option of Inspector-based
  continuous scanning.

## 1. ECR lifecycle policy rules

- A lifecycle policy is a set of `rule`s; each rule has a required `rulePriority` (unique integer,
  lower number = higher priority = evaluated/applied first). Rules with `tagStatus: any` are a
  special case: "A rule with a `tagStatus` value of `any` must have the highest value for
  `rulePriority` and be evaluated last."
  ([lifecycle policy parameters](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_parameters.html))
- Selection dimensions:
  - `tagStatus`: `tagged`, `untagged`, or `any`. `tagged` requires either `tagPrefixList` or
    `tagPatternList` (mutually exclusive per rule — "a lifecycle policy rule may specify either
    `tagPatternList` or `tagPrefixList`, but not both"); `untagged` requires omitting both.
  - `tagPatternList` supports wildcards (`*`), capped at 4 wildcards per string (e.g.
    `["*test*1*2*3"]` valid, `["test*1*2*3*4*5*6"]` invalid).
  - `countType`: `imageCountMoreThan` (count-based — "images are sorted from youngest to oldest
    ... and then all images greater than the specified count are expired or archived"),
    `sinceImagePushed` (age-based, in days), `sinceImagePulled` (age-since-last-pull, falls back
    to push time if never pulled), or `sinceImageTransitioned` (age since archival, for the
    `archive` storage class only).
  ([AWS docs — lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html),
  [lifecycle policy parameters](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_parameters.html))
- Evaluation order and gotchas, quoted directly from AWS's evaluation-rules list:
  - "All rules are evaluated at the same time, regardless of rule priority. After all rules are
    evaluated, they are then applied based on rule priority."
  - "An image is expired or archived by exactly one or zero rules."
  - "An image that matches the tagging requirements of a rule cannot be expired or archived by a
    rule with a lower priority" (i.e. a higher-priority rule wins and "claims" the image first).
  - "**If an image is referenced by a manifest list, it cannot be expired or archived without the
    manifest list being deleted or archived first.**" — this is the multi-arch/manifest-list
    gotcha: a lifecycle rule targeting untagged layers/images underneath a multi-arch manifest
    list will not clean those up until the manifest list itself goes away, so orphaned
    single-arch manifests referenced only by a multi-arch tag can accumulate if the policy only
    targets `untagged` and the manifest list stays tagged.
  - "Only one rule selecting a specific storage class is allowed to select untagged images" — you
    cannot have two competing untagged-image rules on the standard storage class.
  - Actions apply "within 24 hours" of an image meeting the expiration criteria, not immediately.
  ([AWS docs — lifecycle policies, "Lifecycle policy evaluation rules"](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html))
- Practical implication for this repo's 4 images: a policy combining an `untagged` +
  `sinceImagePushed` rule (clean up dangling layers after N days) with a `tagged` +
  `tagPrefixList`/`tagPatternList` + `imageCountMoreThan` rule (keep the last N tagged builds per
  branch/PR pattern) is directly expressible — but if any of the 4 images are pushed as
  multi-arch manifest lists, the untagged-cleanup rule alone won't reclaim orphaned per-arch
  manifests while the manifest list tag survives; the manifest list itself needs its own
  count/age rule.

## 2. Encryption at rest options

- Default: "By default, Amazon ECR uses server-side encryption with Amazon S3-managed encryption
  keys which encrypts your data at rest using an AES-256 encryption algorithm. This does not
  require any action on your part and is offered at no additional charge."
  ([AWS docs — encryption at rest](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html))
- Alternative: SSE-KMS, either the AWS-managed key (alias `aws/ecr`, auto-created on first
  KMS-encrypted repo) or a customer-managed key. "There is a cost associated with using AWS KMS
  keys" — linking to [KMS pricing](https://aws.amazon.com/kms/pricing/) (a monthly per-key charge
  plus per-10,000-request API charges), separate from and in addition to ECR's own storage
  pricing, which itself carries no encryption surcharge.
  ([AWS docs — encryption at rest, "Considerations"](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html))
- What a customer-managed key adds over the AWS-managed default, per the same page:
  - **Independent key rotation / lifecycle control** — a customer-managed key's policy, rotation,
    and deletion are controlled by the account, not implicitly by ECR.
  - **Revocable access independent of IAM**: ECR obtains two `CreateGrant` grants on the key at
    repository-creation time; AWS explicitly warns "the grants that Amazon ECR creates on your
    behalf should not be revoked" mid-life (doing so immediately breaks push/pull), but the grant
    mechanism itself demonstrates that decrypt access is a separate control surface from IAM —
    revoking it (by deleting the repository, the documented supported path) independently cuts
    off ECR's access to the key regardless of IAM policy.
  - **CloudTrail visibility**: ECR's KMS calls (`DescribeKey`, `CreateGrant`, `GenerateDataKey`,
    `Decrypt`, `RetireGrant`) carry an ECR-specific *encryption context* (`aws:s3:arn` +
    `aws:ecr:arn` key/value pairs) that "you can use ... to identify these cryptographic
    operation[s] in audit records and logs, such as AWS CloudTrail."
  - **Cross-account sharing via key policy**: the customer-managed key's own key policy (not the
    repository policy) is the mechanism — the example key policy shown grants the account root
    full `kms:*`, and additional principals/accounts can be added there to allow decrypt from
    other accounts, layered independently of the ECR repository policy used for topic 3 below.
  ([AWS docs — encryption at rest, "Required IAM permissions"](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html))
- Constraint to flag: "Repository Encryption Configuration can't be changed after a repository is
  created" — the AES-256-vs-KMS decision has to be made at repo-creation time, not retrofitted.

## 3. Cross-account/cross-service pull (Platform Account → Hosting Account)

- Confirmed: an ECR repository is accessible cross-account purely via a **resource-based
  repository policy** — no replication, no copying the image into the pulling account. AWS's own
  framing: "Amazon ECR uses resource-based permissions to control access to repositories ... By
  default, only the AWS account that created the repository has access to the repository. You can
  apply a repository policy that allows additional access to your repository."
  ([AWS docs — repository policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html))
- **Both sides must grant independently** — this is the crucial mechanic for the Platform
  Account/Hosting Account split: "If a user or role is allowed to perform an action through a
  repository policy but is denied permission through an IAM policy (or vice versa) then the
  action will be denied. A user or role only needs to be allowed permission for an action through
  either a repository policy or an IAM policy but not both for the action to be allowed" — read
  together with AWS's cross-account example (a `Principal` of another account's root/role granted
  push/pull actions on the repository resource), the working model is:
  1. **Platform Account side** (repository owner): a repository policy — set via
     `aws ecr set-repository-policy` (documented explicitly as the escape hatch "for more
     complicated repository policies that are not currently supported in the AWS Management
     Console") or the console's Permissions tab — with a `Principal` naming the Hosting Account
     (its account root, or a specific IAM role ARN) and `Action` including at minimum
     `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` for pull.
  2. **Hosting Account side** (the ECS task's execution role): its own IAM policy must separately
     allow those same actions against the Platform-Account repository's ARN, **plus**
     `ecr:GetAuthorizationToken` — called out as unconditionally required: "Amazon ECR requires
     that users have permission to make calls to the `ecr:GetAuthorizationToken` API through an
     IAM policy before they can authenticate to a registry and push or pull any images from any
     Amazon ECR repository" (this action has no resource-level scoping and must be granted with
     `Resource: "*"` on the IAM side).
  ([AWS docs — repository policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html),
  [repository policy examples](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.md),
  [setting a repository policy](https://docs.aws.amazon.com/AmazonECR/latest/userguide/set-repository-policy.html))
- AWS's own cross-account example policy shape (adapted for a pull grant, using the documented
  pull actions from the "Allow one or more users" / "Allow another account" examples on the same
  page):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AllowHostingAccountPull",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<hosting-account-id>:role/<ecs-task-execution-role>" },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "*"
    }]
  }
  ```
  AWS's note on the cross-account example: "The account you are granting permissions to must have
  the Region you are creating the repository policy in enabled, otherwise an error will occur."
  ([AWS docs — repository policy examples](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.md))
- **Cross-region is a separate, distinct concern from cross-account** and is not required for
  this repo's shape (Platform Account and Hosting Account can simply share the same region):
  ECR's **cross-Region/cross-account replication** feature is documented as a way to *copy*
  repository content into another registry (region and/or account) — "For cross-account
  replication to occur, the destination account must configure a registry permissions policy to
  allow replication from the source registry to occur" (a *registry*-level permissions policy,
  distinct from the per-repository policy used for a live pull above) — and its own considerations
  page notes replication does not affect repository policies at all: "Repository policies,
  including IAM policies, and lifecycle policies aren't replicated and don't have any effect other
  than on the repository they are defined for." If Hosting Account workloads run in the same
  region as the Platform Account's registry, the repository-policy mechanism above is sufficient
  and no replication is needed; replication would only become relevant if a *different region*
  needed its own local copy of the images (e.g. to avoid cross-region data-transfer latency/cost
  on every pull).
  ([AWS docs — private image replication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html))

## 4. Image vulnerability scanning: basic vs enhanced

- Two scanning types, per AWS's own comparison framing:
  - **Basic scanning** — "Amazon ECR uses AWS native technology with the Common Vulnerabilities
    and Exposures (CVEs) database to scan for operating system vulnerabilities," configurable as
    "scan on push" or manual scans only; it does not automatically re-scan an already-scanned
    image later as new CVEs are published.
  - **Enhanced scanning** — "Amazon ECR integrates with Amazon Inspector to provide automated,
    continuous scanning of your repositories. Your container images are scanned for both
    operating systems and programming language package vulnerabilities. As new vulnerabilities
    appear, the scan results are updated and Amazon Inspector emits an event to EventBridge to
    notify you." It supports two scan frequencies: "Scan on push and continuous scan."
  ([AWS docs — image scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html))
- Continuous-scan trigger conditions for enhanced scanning, stated explicitly: "Amazon Inspector
  initiates new vulnerability scans of container images in the following situations: Whenever a
  new container image is pushed. Whenever Amazon Inspector adds a new common vulnerabilities and
  exposures (CVE) item to its database, and that CVE is relevant to that container image
  (continuous scanning only). Whenever a container image is transitioned from archived to active
  in ECR." Continuous monitoring only applies to images "pushed within 14 days (by default), the
  last-in-use date is within 14 days (by default), or the images are scanned within the configured
  re-scan duration" — i.e. it is not indefinite for an image nobody has touched or pulled in a
  long time; the window is configurable.
  ([Amazon Inspector user guide — scanning ECR images](https://docs.aws.amazon.com/inspector/latest/user/enable-disable-scanning-ecr.html))
- Coverage: enhanced scanning explicitly covers OS **and** programming-language package
  vulnerabilities — directly relevant to images bundling `requirements.txt` (Python) or
  `node_modules` (Node) dependencies, which basic scanning's OS-only CVE database does not
  inspect at all.
  ([AWS docs — image scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html))
- Billing: "Basic scanning is provided and billed through Amazon ECR ... Enhanced scanning is
  provided and billed through Amazon Inspector" — two separate billing surfaces.
  ([Amazon Inspector user guide — scanning ECR images](https://docs.aws.amazon.com/inspector/latest/user/enable-disable-scanning-ecr.html))
  Inspector's own pricing page prices ECR image scanning per scanning event: an initial-scan
  charge on push (~$0.09 per newly pushed image) plus a smaller per-rescan charge (~$0.01 per
  rescan) as the continuous monitor re-evaluates images against new CVEs — i.e. cost scales with
  push/rescan volume, not a flat per-image-per-month fee.
  ([Amazon Inspector pricing](https://aws.amazon.com/inspector/pricing/))
- Judgment call for this repo: with PR-driven builds pushing 4 images frequently, basic scanning's
  "scan on push" already covers each new build at zero incremental cost, but it will miss a CVE
  disclosed *after* a still-deployed image was pushed (e.g. a new CVE in a pinned `node_modules`
  transitive dependency) until the next push. Enhanced scanning is worth it specifically because
  it re-flags that image without requiring a new build/push, and because it is the only one of
  the two that inspects language-level dependency manifests at all.

## 5. Pricing model: ECR vs GHCR for a 4-image, PR-driven use case

**ECR pricing**, from AWS's own pricing page:
- Private repository storage: **$0.10 per GB per month** beyond the free-tier allowance.
- Private registry free tier: **500 MB per month of storage ... for one year** for new customers
  (i.e. not a permanent allowance).
- Data transfer: **same-region transfer from ECR to AWS compute services (EC2, ECS, Fargate,
  Lambda) is free** ($0.00/GB); transfer **out to the internet or cross-region is billed** on a
  tiered scale (first tier around $0.09/GB).
- Public ECR repositories get a separate, more generous free allowance: 50 GB/month of always-free
  storage, and free/very large outbound-to-internet bandwidth tiers, plus "unlimited bandwidth at
  no cost when transferring data from a public repository to AWS compute resources in any AWS
  Region" — not directly relevant here since this repo's images would be private.
  ([Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/))

**GHCR (GitHub Container Registry) pricing**, from GitHub's own billing docs:
- General GitHub Packages storage/bandwidth quotas are plan-based (GitHub Free: 500 MB storage /
  1 GB data transfer per month; Pro/Team: 2 GB / 10 GB; Enterprise Cloud: 50 GB / 100 GB), shared
  with GitHub Actions artifact storage — but this general table is superseded for the Container
  registry specifically by an explicit carve-out: **"Container image storage and bandwidth for
  the Container registry is currently free"**, for both public and private images, with GitHub
  stating it will give advance notice ("at least one month") before changing that policy.
  ([GitHub Docs — GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages))
- Separately, GitHub Actions workflow pulls using the built-in `GITHUB_TOKEN` don't count against
  any quota at all: "the data transferred using a `GITHUB_TOKEN` does not count against the usage
  for the hosting repository" — relevant to this repo's PR-driven CI builds, which pull/push using
  that token.
  ([GitHub Docs — GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages))

**Comparison for this repo's actual shape** (4 images, PR-driven frequent builds, pulls mostly
from CI runners and same-region ECS):
- Storage: with 4 images and typical layer reuse, total private storage is very likely to sit in
  the low single-digit GB range — under ECR's $0.10/GB-month rate that's cents to low dollars per
  month once the one-year free tier lapses, but it is **not literally free** the way GHCR's
  Container registry currently is.
- Bandwidth: ECR's same-region-to-ECS transfer being free largely matches GHCR's current
  free-everything policy for this specific pull path, so bandwidth is close to a wash for
  same-region ECS pulls; the difference shows up in CI-runner pulls from outside AWS (GitHub-hosted
  runners), which would be free either way under GHCR's current policy but would count as
  internet egress under ECR's per-GB tiered pricing (small in absolute dollars at this image
  count/frequency, but nonzero, versus GHCR's $0).
- Net: at this repo's current scale (4 images), GHCR's current free-tier policy for the Container
  registry is cheaper in absolute terms than ECR's metered pricing; ECR's value case here rests on
  the non-cost capabilities above (native IAM/cross-account integration matching the
  Platform-Account/Hosting-Account split, lifecycle-policy automation, optional
  Inspector-based continuous scanning) rather than on storage/bandwidth cost savings.

## Sources

- [AWS ECR User Guide — Automate the cleanup of images by using lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)
- [AWS ECR User Guide — Lifecycle policy properties](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_parameters.html)
- [AWS ECR User Guide — Encryption at rest](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html)
- [AWS ECR User Guide — Private repository policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html)
- [AWS ECR User Guide — Private repository policy examples](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.md)
- [AWS ECR User Guide — Setting a private repository policy statement](https://docs.aws.amazon.com/AmazonECR/latest/userguide/set-repository-policy.html)
- [AWS ECR User Guide — Private image replication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html)
- [AWS ECR User Guide — Scan images for software vulnerabilities](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)
- [Amazon Inspector User Guide — Scanning Amazon ECR container images with Amazon Inspector](https://docs.aws.amazon.com/inspector/latest/user/enable-disable-scanning-ecr.html)
- [Amazon Inspector pricing](https://aws.amazon.com/inspector/pricing/)
- [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)
- [GitHub Docs — GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)

## Unverified / could not confirm

- The exact current dollar figures for AWS KMS's monthly per-key charge and per-10,000-API-request
  charge were not independently re-fetched from `aws.amazon.com/kms/pricing/` in this session (the
  ECR encryption-at-rest page links to it but the figures themselves were not pulled) — cite that
  page directly before quoting a specific number in the issue.
- ECR's tiered internet-egress data-transfer pricing (rate breakpoints beyond the first ~$0.09/GB
  tier) was summarized from a fetch of the ECR pricing page rather than quoted line-by-line for
  every tier; confirm the exact tier boundaries against `aws.amazon.com/ecr/pricing/` directly if
  precise cost modeling is needed.
- Whether the general GitHub Packages per-plan storage/bandwidth table (500 MB/1 GB free tier,
  etc.) has any residual bearing on GHCR specifically, given the Container-registry-specific
  free-of-charge carve-out — GitHub's own page states the carve-out but this session did not find
  a page reconciling whether the general table's numbers ever apply to `ghcr.io` images at all.
