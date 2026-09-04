# Keep the `test` job non-blocking; fix the two confirmed guard-logic gaps instead

`docs/agents/sdlc.md#continuous-integration` documented the `test` job's
`continue-on-error: true` (`ci.yml:191`) as deliberate-but-provisional:
"revisit once the suite has proven itself over time." Issue #140 mapped
that revisit: audit `hosting_admin`'s own test code (#141), the rest of the
CI pipeline (#142), and `crm_methodology`'s concurrency/tour tests (#143)
for any silent-false-success mechanism, before this ticket (#144) decided
the test-gating policy itself. #141 and #143 found nothing wrong with the
test logic these jobs run — the suite's assertions are sound. (#143's one
residual note — the concurrency test's SQL is a hand-copied literal of the
production lock statements in `crm_lead.py`, so it wouldn't catch drift if
that statement's wording ever changed — is inherent to the #134 workaround
it tests, not a live bug, so it doesn't bear on the gating question here.)
#142 found no additional problem in the `test` job itself; it found two
unrelated guard-logic gaps: a skipped-required-check loophole across
`lint`/`docs-build-tests`, and a paths-filter coverage gap across
`build-image`/`lint`/`test`.

None of #141, #142, or #143 produced any evidence bearing on whether the
`test` matrix has "proven itself over time" — this repo has no tracked
signal for consecutive-green-run history on a job or module, so there is
nothing to point to that would justify flipping `continue-on-error` off
today. We considered making the whole `test` job required immediately;
rejected, since no stability evidence was produced by this audit chain and
doing so would gate every merge on a signal nobody has actually verified is
reliable — a related but not identical risk to the one `sdlc.md` already
documents for the old docs-only-PR `paths:` trigger filter (that case had
no check to satisfy at all; this one has an unproven one). We also
considered restructuring to per-module required checks once each module
has run stable for N consecutive PRs — this is likely the right eventual
shape, but it needs an explicit, measurable stability criterion (e.g., N
consecutive green `dev/19.0` runs with no infrastructure-caused failure)
that doesn't exist in this repo today; defining and instrumenting that
criterion is separate work, out of scope here.

**Decision.** `test` stays exactly as documented in `sdlc.md` — visible,
non-blocking, excluded from required status checks. This ADR makes no code
change to `ci.yml`'s `test` job. The two confirmed guard-logic gaps from
#142 do get fixed, via dedicated follow-up tickets: #145 closes the
skipped-required-check loophole, where a `changes` job failure correctly
turns the required `lint` and `docs-build-tests` jobs `skipped` rather than
a fake `success`, but GitHub branch protection treats a skipped required
check as passing — so a broken `changes` job can let a PR merge with
neither required check having actually run. The fix is a trailing
`if: always()` gate job that fails unless both succeeded, made the thing
branch protection actually requires. #146 closes the paths-filter coverage
gap, where `.github/actions/**` (the `ghcr-login` composite action, used by
`build-image`/`lint`/`test`) isn't covered by either `paths-filter` filter
list, so a PR editing only that action skips `build-image` and every real
`lint` step, reporting green having exercised nothing; the fix is adding
`.github/actions/**` to both filter lists.

**Consequences.** `dev/19.0`'s required checks don't change in size or
composition as a result of this ADR — the test-gating question #144 was
opened to answer stays open by design, because no evidence exists yet to
answer it safely, not because the question was avoided. `sdlc.md`'s
"revisit once the suite has proven itself over time" language stays
accurate; a future revisit needs to first define what "proven itself"
means in measurable terms (a per-module or per-job stability signal)
before it can change this decision. The two guard-logic fixes reduce this
repo's false-green surface immediately and are independent of that open
question — landing them doesn't require or imply any change to `test`'s
gating status.
