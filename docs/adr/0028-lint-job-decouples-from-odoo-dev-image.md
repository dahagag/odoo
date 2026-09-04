# The required `lint` job's Docker/Odoo-image dependency is incidental, not required

Part of the same investigation as [ADR-0027](0027-infra-ci-checks-ruff-and-interrogate.md). While
scoping a Docker-free CI check for `infra/**`, the same question was asked of the existing,
already-required `lint` job that gates every PR touching `custom_addons/**`: does `ruff` actually
need the Odoo dev image it currently runs inside
(`docker compose run --rm --no-deps odoo ruff check ...`), or is that just where it happened to be
convenient to put it?

Verified empirically: `ruff check --config ruff.toml custom_addons`, run completely bare with no
Docker, no Odoo installed, and no other setup, passes clean — identical in effect to today's
Docker-wrapped invocation. `ruff` is a self-contained linter; nothing in this repo's `ruff.toml`
(including its `known-first-party = ["odoo"]` isort setting) requires the `odoo` package to be
importable, only that import statements match a naming pattern textually. The image dependency
exists because `lint` reuses the image `test` already needs, not because `ruff` needs anything from
it.

That matters because it means this repo's one universal, fast, Docker-free lint pattern — already
proven out for `infra/**` in ADR-0027 — generalizes to `custom_addons/**` too, and beyond that to
any future per-language linter (e.g. `tsc` for TypeScript) without recoupling everything to one
monolithic image build. Removing that coupling is deliberately **not** done as part of ADR-0027: it
means replacing the mechanism behind an already-passing, already-required check that gates every
PR in the repository — a materially larger blast radius than adding one new, narrowly-scoped job —
and both `scripts/dev.sh lint` and `scripts/dev.ps1 lint` (which currently mirror the same
Docker-based invocation for local development) need the equivalent change for cross-platform
parity. That work is its own ticket, blocked on ADR-0027's `infra-checks` job landing first, so the
two changes to this repo's CI surface don't ship entangled with each other. The exact shape of the
generalized, multi-linter-ready mechanism (one job per linter vs. a single matrix job, for
instance) is left to that ticket's own implementation — this ADR records only the finding (the
Docker dependency is incidental) and the decision to act on it separately, not the final mechanism.
