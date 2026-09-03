# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on the fork (`origin`, `dahagag/odoo`) — never on `upstream` (`odoo/odoo`). Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

This repo has two remotes pointing at related-but-different repos (`origin` = the fork, `upstream` = `odoo/odoo`). `gh` operates on the current directory's detected repo, which resolves to `origin`'s host repo by default — always double-check with `gh repo view` before creating or closing anything if there's any doubt, since a bare `git remote -v` glance can conflate the two.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Stacked PRs follow the issue dependency graph

Precedent: [#90](https://github.com/dahagag/odoo/issues/90). When a ticket tree (spec +
sub-issues, or a wayfinder map + children) has blocking edges between its tickets — native issue
dependencies where available, a `Blocked by:` line otherwise — implementation PRs stack in that
same order.

**Base selection.** A ticket with exactly one blocker sets `--base` to that blocker's branch, not
to the default branch. A ticket with **multiple** blockers only gets its PR opened once every one
of those blockers has merged to the default branch — its base is then the default branch like any
unblocked ticket, just gated later. A ticket with no blocker bases its PR on the default branch as
usual.

**Why no integration branch.** This avoids ever needing a shared integration branch: a PR still
has exactly one base, and no dependent PR can be missing a blocker's changes, because none of its
blockers are still unmerged by the time it's created.

**Merge order.** Merge strictly bottom-up: a PR only merges once every PR it's based on has
merged, and each still-open PR above it is rebased/retargeted onto the default branch as its base
layer lands. This makes the dependency graph and the PR stack the same shape — no separate
stacking scheme to keep in sync with the tracker's own blocking edges.

## /to-tickets output: sub-issues of the spec, first one always commits its ADRs/docs

When `/to-tickets` breaks a spec ticket into tracer-bullet tickets, publish each resulting ticket
as a GitHub **sub-issue** of the spec ticket (the sub-issues API — see the Wayfinding child-ticket
mechanics below, which apply the same way here), not merely a sibling linked by blocking edges.
Blocking edges between the sub-issues still use native issue dependencies per the stacking
convention above.

**The first sub-issue in the tree is always**: commit the ADR(s) and `CONTEXT.md`/`CONTEXT-MAP.md`
updates produced by the `/grill-with-docs` session that led to the spec (if that session didn't
already commit them itself).

**Every other sub-issue in the tree is blocked by it.** This guarantees an agent picking up any
later ticket in the tree — which may run in a fresh context with no memory of the grilling
session — can read the settled decisions and vocabulary from the repo itself rather than needing
them re-explained.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
