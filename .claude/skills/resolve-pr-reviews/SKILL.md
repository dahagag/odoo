---
name: resolve-pr-reviews
description: Fetch a PR's review comments (bots like CodeRabbit, and humans), triage, fix, and resolve them.
disable-model-invocation: true
---

Review comments — bot (CodeRabbit and similar) and human — pile up on a PR faster than a human wants to work them one by one. This skill fetches every unresolved thread, **triages** each into one of five buckets, lands the clear-cut ones, and gates anything non-trivial, or asked for by a human reviewer, behind informed consent before touching the branch.

## Step 0: Preflight — merge conflicts

Run `gh pr view <target> --json mergeable`. If `mergeable` is `CONFLICTING`, call the Skill tool with "resolving-merge-conflicts" and wait for it to finish before continuing — triaging comments on a branch that can't merge is wasted work.

**Target** defaults to the current branch's PR. Accept an optional PR number/URL, or a single review-thread id for one-off use, as this skill's argument.

Done when `mergeable` is not `CONFLICTING`.

## Step 1: Fetch unresolved threads

Review threads, their resolution state, and each comment's author type are only available via GraphQL — the REST comment list has neither. Query:

```graphql
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 20) {
            nodes { id body author { login __typename } path line diffHunk commit { oid } }
          }
        }
      }
    }
  }
}
```

Run it with `gh api graphql -f query=... -F owner=... -F repo=... -F pr=...`, paginating if `pageInfo.hasNextPage`. Keep every thread where `isResolved` is false, and record whether its first comment's author `__typename` is `Bot` or `User` — that origin decides how Step 3 treats an otherwise-trivial fix.

Done when you hold the full set of unresolved threads for the target PR.

## Step 2: Triage

Sort each thread into exactly one bucket by your own judgment of the comment and the fix it implies — never by the bot's own severity label or heading (a "nitpick" collapsible section is a hint about the bot's confidence, not a verdict on the risk of the fix; judge the diff shape yourself). Group threads into one triage unit when they're clearly the same underlying issue (same file, same pattern, restated across a diff) — the rest of this skill treats a group like a single item.

- **fix-now**: a real bug, security issue, or correctness problem — *and* a fix you could land inside this PR without it turning into a separate design effort. Size, not confidence, is the test: you know exactly what the patch looks like and it stays inside the shape of the existing change.
- **fix-if-trivial**: the fix itself is a single line with no logic change — a rename, a formatting or typo fix, adding/removing a line that can't alter control flow or behavior. If applying the fix requires touching more than one line or reasoning about behavior at all, it's fix-now, whatever the bot called it.
- **dismiss**: a false positive, or it conflicts with a deliberate, already-made design choice.
- **escalate**: ambiguous or subjective — the comment reads as fair but you can't tell what "right" looks like without asking.
- **large-fix**: unambiguously a real bug or security issue — you *do* know it's real — but the correct remediation is itself a substantial piece of new work: a new subsystem, a new data model or field, an authentication/authorization mechanism that doesn't exist yet, or any change that would need its own design pass rather than riding along inside a PR-comment cleanup. A bot's own effort tag (e.g. CodeRabbit's "🏗️ Heavy lift") lines up with this bucket often enough to be a useful hint, but never a verdict — judge the diff shape yourself, the same as every other bucket. The distinguishing question against escalate: do you already know what "right" looks like? If yes, but it's too big to build here, it's large-fix, not escalate.

Done when every fetched thread (or group) has exactly one bucket.

## Step 3: Land bot-authored fix-if-trivial automatically

For each fix-if-trivial item whose thread was opened by a bot, apply the fix, then **land** it — the same landing sequence Step 4 also uses:

<landing-sequence>

Run the repo's existing test/lint commands (read them from the project's own config — `package.json` scripts, CI workflow, or its dev docs; don't guess a command that isn't already defined somewhere).

- Tests/lint pass → one commit for this item referencing the thread's comment (link or id), `git push`, then reply on the thread describing the fix and mark it resolved (`resolveReviewThread` mutation, same GraphQL endpoint as Step 1).
- Tests/lint fail → do not commit or push. Re-bucket the item as escalate and carry it into Step 5.

</landing-sequence>

No user gate here — this bucket exists precisely so it doesn't need one, and it's a one-liner or a bot-graded nitpick, so it also skips the code-review check Step 4 runs for real fixes.

A fix-if-trivial item whose thread was opened by a **human** reviewer skips this step entirely and falls through to Step 4 instead — however small the fix, a human asked for it directly and gets the same gate as a real change.

## Step 4: Gate everything else

Non-trivial code changes, dismissals, and any human-authored comment (trivial or not) all need a human to actually agree before they land. For each fix-now item, each dismiss item, and each human-authored fix-if-trivial item — **not** large-fix items, which skip straight to Step 5's routing instead of an inline "apply the fix" option:

1. **Build the bite-sized guide, and post it as a normal chat message** — never packed into an `AskUserQuestion` field. Write it as prose a person can actually read: short sentences, paragraph breaks between beats, no telegraphic fragments or over-compressed clauses chasing brevity. Skimmable means well-paced, not crushed. Cover:
   - **Where**: a link to the exact line (`https://github.com/<owner>/<repo>/blob/<commit.oid>/<path>#L<line>`, from the comment's own `path`/`line`/`commit.oid`) plus its `diffHunk` as a fenced code block, so the user sees the real code the comment is about, not a paraphrase of it. If the fix touches real code or config elsewhere in the repo (not just the flagged line), quote that too — actual snippets and call chains you verified by reading the files, never reconstructed from memory.
   - **What**: the issue, in plain language.
   - **Why**: the concrete reason it matters.
   - **Fix**: the proposed change (fix-now) or the reasoning for dismissing it (dismiss) — as a diff when the change is textual, so the user sees exactly what will land.
   - **Effect if not addressed**: the consequence, stated in both technical and business terms using this project's own domain vocabulary (its glossary, ADRs, `AGENTS.md`) — not generic severity language.

2. **Settle on one fix approach before presenting it.** If more than one approach is genuinely viable and the choice isn't obvious, call the Skill tool with "grilling" on this one item first, and use its outcome as the proposed fix/approach in the guide. Drive that grilling round through the AskUserQuestion tool (recommended choice first and labeled, options carrying the trade-off, no manual "other" option) rather than a plain-text question list — this skill's own gate is already interactive, and the round should read the same way.

3. **Then call AskUserQuestion with just the decision** — a short question ("Approve this fix?") and short option descriptions (approve / reject / modify), pointing back at the guide already posted in chat. The dialog is for the decision, not the context; cramming the guide into its `question` field renders as a dense, hard-to-read block inside the narrow widget, which defeats the point of writing a bite-sized guide in the first place.
   - **Approve** (fix-now) → apply the fix, call the Skill tool with "code-review" on the resulting diff, then land it (the Step 3 landing sequence). A Standards or Spec finding blocks the land: revise the fix and re-review, or give up and re-bucket the item as escalate — never land over an unresolved finding.
   - **Approve** (human-authored fix-if-trivial) → apply the fix and land it (the Step 3 landing sequence) directly — it already cleared the trivial bar, so no code-review needed.
   - **Approve** (dismiss) → skip the code change entirely: just reply with the guide's reasoning and resolve. No code-review, nothing to land.
   - **Reject** → leave the thread unresolved and carry it into Step 5 as an escalation.
   - **Modify** → fold the user's requested change into the fix, then follow the same approve path as its bucket above.

Done when every item from this step has been presented and landed, rejected, or escalated.

## Step 5: Route escalations and large-fix items

For every remaining escalate or large-fix item (including anything rejected or test/lint-failed out of earlier steps), build the same bite-sized guide as Step 4, then present it via AskUserQuestion recommending exactly one of the following, chosen by the comment's actual scope, with the others still selectable:

- **`/to-tickets`** — the follow-up is small and already well understood.
- **`/to-spec`** — it's a real problem or feature, but nobody's specified it yet.
- **`/wayfinder`** — the implications are foggy and too big for one session; it needs its own decision map.

For a large-fix item specifically, the guide's framing is "this is real, and here's why fixing it properly is out of scope for a quick PR-comment pass" rather than an open question about whether it's a problem at all — the ambiguity being resolved is scope and routing, not whether the finding is valid. A large-fix item can also come back as "dismiss" here if, once written up, the user judges the risk acceptable to carry for now; treat that the same as a Step 4 dismiss (reply with the reasoning, resolve the thread) rather than forcing a routing choice that doesn't fit.

**`/to-tickets`, `/to-spec`, and `/wayfinder` are all `disable-model-invocation` — never attempt to invoke any of them via the Skill tool; the call errors, and even a well-formed prompt changes nothing about that restriction.** Whichever one the user picks, publish a GitHub issue instead (per `docs/agents/issue-tracker.md`) as a ready-to-run handoff — this is the routing's actual output, not a workaround:

- **Title**: a short, descriptive title for the underlying problem — not "Route via /to-spec" or similar meta-phrasing.
- **Body**: everything the target skill would need as its own opening prompt, since a human will paste this straight after the command: the concrete finding (quote the flagged lines/diff), why it matters, and whatever repo-specific context made it non-trivial in the first place (the same material the bite-sized guide already gathered). Lead with one line naming the next step verbatim, e.g. "**Next step:** run `/to-spec` against this issue."
- **Label**: `ready-for-human` (`docs/agents/triage-labels.md`) — the routing decision is already made; what's missing is a human session actually running a skill the agent is barred from invoking.

Reply on the review thread with a link to the created issue, but leave the thread unresolved regardless — it resolves only once the routed work actually lands (e.g. a merged follow-up PR), or via the explicit "dismiss" path above, never merely because a ticket now exists for it.

Done when every triaged item is either resolved (Steps 3–4) or has a routing decision made and its handoff issue published (Step 5).
