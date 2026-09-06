# Split `build-image` into a read-only PR build and a trusted-trigger publish

`ci.yml`'s `build-image` job ran on every `pull_request` touching an `image_relevant` path
(`custom_addons/**`, `docker/**`, `scripts/dev.sh`, `requirements.txt`, `compose.yaml`, `ci.yml`
itself, and — since #146 — `.github/actions/**`), and carried `permissions: packages: write` so it
could `docker login` via `.github/actions/ghcr-login` and push the built image to GHCR. GitHub
already downgrades a fork-opened `pull_request` run's token to read-only regardless of a
workflow's own `permissions:` block, so the job's actual reachable population was narrower than
"any PR": same-repository branches, i.e. contributors who already have push access to this repo.
For that population, code executed during the Docker build — a compromised base image, a tainted
dependency pulled mid-build, a malicious `Dockerfile`/build-script edit in the PR itself — ran with
a token that could publish to this repo's GHCR namespace, before the PR was reviewed or merged.
Flagged by CodeRabbit/zizmor (CWE-732, Incorrect Permission Assignment for Critical Resource) on
PR #152, which only widened the paths-filter list (#146) and didn't introduce the gap — the
exposure already existed for any PR touching `docker/**`, `custom_addons/**`, `requirements.txt`,
`compose.yaml`, or `ci.yml` itself; #146 just made it reachable via one more path
(`.github/actions/**`).

**Decision.** Split building from publishing so no `pull_request`-triggered job ever holds
`packages: write`:

- `build-image` (unchanged name, `pull_request`-only via `if: github.event_name ==
  'pull_request'`) now carries only `permissions: contents: read`. It computes the same
  content-hash tag as before (`docker/odoo-dev.Dockerfile`, `docker/*.sh`, `requirements.txt`,
  `.env.example` — unchanged inputs, so the tag scheme stays identical across PR and merge
  builds), builds with `docker/build-push-action`'s `load: true` instead of `push: true`, and
  saves the result to a tarball (`docker save`) uploaded as a workflow artifact
  (`actions/upload-artifact`). It never logs into GHCR and never checks whether the tag already
  exists there — that optimization only matters for the job that actually pushes.
- `test` downloads that artifact (`actions/download-artifact`) and `docker load`s it instead of
  `docker compose pull`ing from GHCR, so it no longer needs `packages: read` either.
  `compose.yaml`'s `odoo` service has no `pull_policy`, which defaults to `missing` — once the
  exact tag string is loaded into the runner's local Docker daemon, `docker compose` uses it
  directly and never attempts a registry pull.
- `publish-image` is a new job, gated to `if: github.event_name == 'push'` against the workflow's
  new `push: branches: [dev/19.0]` trigger (added alongside the existing `pull_request` trigger,
  not replacing it) — i.e. it runs only on a merge to the trunk, never for a PR however it was
  opened. It carries `permissions: packages: write`, and is the only job in the workflow that
  does. It re-derives the same content-hash tag, logs in via `ghcr-login`, keeps the existing
  "skip the push if this tag is already published" `imagetools inspect` check, and pushes via
  `docker/build-push-action` with `push: true` — the same push logic `build-image` used to run,
  just moved to the trusted trigger and given its own job name.
- `lint`, `docs-build-tests`, `infra-checks`, and `ci-required` all gained `github.event_name ==
  'pull_request' &&` in their existing `if:` conditions: they're PR-time checks (`ci-required` is
  literally a merge gate), so they have nothing to do on a post-merge push and would otherwise run
  a second time for no reason — `ci-required` in particular would fail every merge for no reason,
  since its `needs` (`lint`, `docs-build-tests`, `infra-checks`) turn `skipped` once those three are
  gated off, and a `skipped` result already fails its `!= 'success'` check.
- `changes`, the one job the audit found with no `permissions:` block at all, now gets an explicit
  `permissions: contents: read` — the same "every job states its own minimum" fix already applied
  to `lint`/`docs-build-tests`/`infra-checks`/`test` when they were created, closing zizmor's
  separate "excessive-permissions: default permissions used due to no permissions: block" finding
  for the one job that still had it.
- The "read `.env.example` defaults" and "compute the content-hash tag" steps used to live
  duplicated in both `build-image` and (the old, push-capable) `build-image`'s publish path.
  Splitting into two jobs would have duplicated them a second time, so they're factored into a new
  composite action, `.github/actions/compute-dev-image-tag`, following the precedent
  `.github/actions/ghcr-login` already set for shared workflow steps. Both `build-image` and
  `publish-image` call it and get back the same four outputs (`odoo_image`, `uid`, `gid`, `image`),
  which is also what keeps the tag scheme provably identical between the two jobs — one
  implementation of the hash, not two copies that could drift.
- `concurrency.cancel-in-progress` changed from an unconditional `true` to `${{ github.event_name
  == 'pull_request' }}`. The workflow's `concurrency.group` is keyed on `github.ref`, which for a
  `push` event is the branch itself (`refs/heads/dev/19.0`) — the same group for every merge. With
  `cancel-in-progress` still unconditionally `true`, a second merge landing while the first
  merge's `publish-image` job is still mid-`docker push` would cancel that push outright, silently
  (no required check depends on `publish-image`), potentially leaving a content-hash tag never
  published to GHCR despite nothing having failed. Scoping cancellation to `pull_request` keeps the
  original behavior there (a new push to a PR branch still cancels its own stale run) while letting
  every `push`-triggered run on `dev/19.0` finish `publish-image` uninterrupted.

**Why an artifact hand-off instead of, say, restructuring `lint`/`test` into steps of
`build-image`'s own job.** `lint` is already Docker-free (ADR 0028) and gated on a different
`*_relevant` filter than `image_relevant`, so folding it into `build-image` would recouple two
things ADR 0028 deliberately decoupled. `test` is a matrix job (one run per changed module) that
needs the same built image in every matrix leg; a workflow artifact is the standard GitHub Actions
mechanism for handing a build output from one job to several downstream jobs in the same run,
without a second `docker build` per matrix leg and without any job needing registry credentials at
all for something that's local to this one workflow run.

**Why `publish-image` rebuilds rather than reusing `build-image`'s artifact.** The trigger that
runs `publish-image` (`push` to `dev/19.0`, i.e. the merge commit itself) is a different workflow
run than whichever PR run last built that content — GitHub Actions artifacts don't cross workflow
runs by default, and reaching across runs to fetch one adds real complexity for a rebuild that
`cache-from: type=gha` mostly avoids anyway. The existing "skip push if already published" check
still no-ops the actual registry write when a same-content image was already pushed by an earlier
merge, which is the case this was actually optimizing for; a same-repo PR's own build (never
pushed) doesn't count as "already published" and was never what that check was skipping against.

**Consequences.** No `pull_request`-triggered job in this workflow holds `packages: write` — the
only job that does (`publish-image`) is unreachable from a PR event regardless of who opened it,
including a same-repo contributor with push access. The tag scheme, the "skip push if unchanged"
optimization, and the `lint`/`test` skip-vs-failure handling documented in
`docs/agents/sdlc.md#continuous-integration` are all preserved; that doc's job table is updated
alongside this ADR to add `publish-image` and note the `pull_request`-only scoping now on the
other rows.
