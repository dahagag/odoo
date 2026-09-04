# CI checks for infra/: tofu validate, ruff, and interrogate — Docker-free, no new ruff config

`infra/**` (the OpenTofu foundation added in #113) has had zero CI coverage since it was introduced —
no `tofu validate`, no lint, nothing gated on GitHub's required-checks list. Everything found on it
so far (a docstring-coverage gap on private Lambda-handler helpers, a real IAM ABAC scoping bug, an
IAM role-name-length bug) was caught by hand or by CodeRabbit's third-party review, never by
anything reproducible locally or immune to that integration being paused or rate-limited.

A new required job, **`infra-checks`** (display name **"Infra checks (required)"**, matching this
workflow's existing `"Lint (required)"`/`"Docs-build tooling tests (required)"` naming), closes that
gap: `tofu fmt -check`/`tofu validate` against all three OpenTofu modules (via the official
`opentofu/setup-opentofu` action, pinned to `1.8.5`), `ruff==0.16.1` (matching the pin already used
in `docker/odoo-dev.Dockerfile`) for general Python code quality, and `interrogate==1.7.0
--fail-under 80` for docstring coverage — both scoped to `infra/**` broadly rather than narrowly to
`infra/foundation/lambda_src` (the only place Python exists under `infra/` today), so a future
Python file added anywhere else in that tree is covered without a CI config change. Both tools are
version-pinned so the gate's result doesn't silently shift under a future tool release. Like the
existing `lint`/`docs-build-tests` jobs, `infra-checks` itself always runs — its *steps* are skipped
via a new `infra_relevant` path-filter output on the `changes` job when nothing relevant changed,
not the job itself gated at the workflow-trigger level (`docs/agents/sdlc.md` already documents why
this repo rejected trigger-level path filters: an irrelevant PR would get no required-check result
at all rather than a fast, real pass).

**Why two Python tools, not one.** `ruff` already implements pydocstyle's `D` rule family, which
would have been the obvious single-tool choice. It was rejected for this purpose: pydocstyle's
`D10x` codes only flag *public* (non-underscore-prefixed) names by default, and the actual gap
CodeRabbit found — `_client`, `_table`, `_ssm_client`, `_get_parameter`, `_sign` — is entirely
private helper functions that convention deliberately exempts. `interrogate` counts single-
underscore names by default, which is why it (and CodeRabbit) caught them; `ruff`'s `D` rules would
not. So `ruff` (already in this repo's toolchain) handles general code quality, and `interrogate`
(a new, narrowly-scoped dependency) handles docstring coverage specifically. Run with its default
settings — `--ignore-semiprivate` is deliberately **not** passed, since that would exempt exactly
the single-underscore functions this check exists to cover, undoing the behavior CodeRabbit already
established as the bar for this codebase. The threshold matches CodeRabbit's own default
(`--fail-under 80`) rather than a repo-specific number, so the local/CI gate and CodeRabbit's
pre-merge check can't disagree with each other over the same code. The coverage percentage is
documented in the workflow itself as a regression-prevention tripwire, not a documentation-quality
proxy — a bare percentage doesn't distinguish a substantive docstring from one written mechanically
to clear the bar.

**The job is Docker-free by design**, modeled on the existing `docs-build-tests` job
(`actions/setup-python`, no Odoo dev image) rather than the existing `lint` job's
`docker compose run ... odoo ruff check` pattern — `ruff` needs no Odoo installation to run
(verified: `ruff check --config ruff.toml custom_addons`, run completely bare, passes clean and
identically to the Docker-wrapped invocation), so pulling that heavyweight image just to lint a
handful of infra Python files would be pure waste. This is also the seed of a separate, larger
decision recorded in ADR-0028.

**`ruff.toml` is never modified.** Its own header states it is auto-generated, synced nightly from
upstream Odoo's own runbot CI config. `ruff` auto-discovers the nearest config by walking up the
directory tree from each file it lints (confirmed via `ruff`'s own debug log:
`Using configuration file (via parent) at: <repo-root>/ruff.toml`), so `infra-checks` picks up the
existing, protected root config automatically regardless of what path it's invoked against — no new
`ruff.toml` override needed. Had an infra-specific rule ever been required, the correct mechanism
would be a scoped `infra/ruff.toml` (which `ruff` would discover ahead of the root config for files
under `infra/`), not editing the shared file.

**`custom_addons/**` is out of scope for the `interrogate` check.** Measured baseline: 6.4%
docstring coverage (141 functions analyzed, 132 missing). A whole-tree 80% gate there would fail
permanently without a large, unrelated retrofit; a diff-scoped version (checking only files touched
by a given PR) is possible in principle but is separate, unscoped future work.

**The reusable `trial_org` module needs a real fixture to validate.** It has no root config of its
own, so `tofu validate` needs a wrapper supplying dummy-but-valid variable values.
`infra/modules/trial_org/examples/validate/main.tf` is a committed fixture, reused by both CI and
any human validating locally — not an ephemeral, CI-only inline wrapper, which would be invisible
outside CI and silently drift from the module's actual `variables.tf` the moment a variable changed
without anyone noticing.
