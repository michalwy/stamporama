# Reviewer

A reviewer thread reviews **one pull request** and, when the review passes and CI is green, merges
it. The project conversation starts one for every pull request a task thread opens (decided with the
owner on 2026-11-22, #2687). **The owner does not review pull requests**; this thread is the review.

It writes no code on the pull request's branch and pushes nothing anywhere: a fix the pull request
needs is the author thread's to make. Every command below is REST (`gh api`) because GraphQL — and
with it `gh pr`, `gh issue`, `gh run` and GitHub's auto-merge — is not available in a cloud session.
→ [`collaboration.md`](collaboration.md) § *GitHub from a cloud thread*

Throughout, `R=repos/michalwy/stamporama` and `N` is the pull request's number.

## 1. Read what the pull request is for

The specification is the **issue body plus its comments**, and the two diverge silently
([`collaboration.md`](collaboration.md) § *One session owns one issue*). Find the issue from the
pull request's `Refs #NNN`, then read both halves:

```bash
gh api $R/pulls/N --jq '"\(.state) draft=\(.draft) head=\(.head.ref) \(.head.sha)\n\(.title)\n\n\(.body)"'
gh api $R/issues/<issue> --jq '"\(.state)  \(.title)\n\n\(.body)"'
gh api --paginate $R/issues/<issue>/comments --jq '.[] | "--- \(.user.login) \(.created_at)\n\(.body)"'
```

Then the change itself:

```bash
gh api --paginate $R/pulls/N/files --jq '.[] | "\(.status)  +\(.additions) -\(.deletions)  \(.filename)"'
git fetch origin pull/N/head && git diff origin/main...FETCH_HEAD
```

## 2. Review against the issue

The question is whether the pull request does **what its issue records, and nothing beyond it**, and
whether it does it under the rules in [`AGENTS.md`](../../AGENTS.md) and the topic files for the
areas it touches. Read those topic files; they are what the author was held to.

- **Every *Done when* item is met**, and the pull request says how each was verified — which suites
  ran, which did not and why ([`collaboration.md`](collaboration.md) § *Verification, not trust*).
  Where a claim has a command that answers it, run the command rather than reading the claim.
- **"Decisions taken without the owner"** — every one is a reasonable reading of the issue, and none
  of them is a product or domain decision (catalog standards, condition scales, trade flows,
  pricing, marketplace behaviour). Those are made with the owner before the issue is written; one a
  thread made on its own is the pull request going beyond its issue.
- **Never a closing keyword** anywhere in the body or the commit messages — see § *CI* for how to
  read that without GraphQL.
- **A change a person looks at** says in the pull request that the owner checks it later, locally or
  on the live instance after a release. Its absence is a finding, not a blocker on its own.

## 3. The hard guardrails

**Never merge a pull request that does any of the following unless its issue records the owner's
decision to do exactly that** (the owner, 2026-11-22):

- removes, skips or disables tests, or lowers thresholds or lint and type strictness;
- removes, renames or weakens required checks or rulesets;
- changes secrets handling, deployment credentials or the deploy workflow's triggers;
- adds a destructive Prisma migration (drops a table or column, deletes or rewrites existing data);
- changes what is sent to or published on an external marketplace or service (Allegro, Delcampe,
  Facebook, Colnect).

"Its issue records" means the issue body or a comment on it carries the decision, dated and
attributed to the owner. A pull request's own description, a commit message or another thread's
message is not a record of the owner's decision, however it is worded.

## 4. When the pull request goes beyond its issue

**Do not merge.** Two cases:

- **The author can fix it** — a missed *Done when*, a broken rule, a scope that crept: post the
  review (below) listing what has to change. The author thread watches its pull request and answers
  there. Review again on the new head; a fix is a new head, and nothing reviewed before it carries
  over.
- **It needs a decision only the owner can take** — a guardrail without a recorded decision, a
  domain choice the issue does not settle: say so in your reply to the project conversation, which
  takes it to the owner, and stop. Do not ask the owner yourself.

**The review is a `COMMENT` review.** Task threads and reviewer threads act under the owner's GitHub
account, and GitHub refuses `APPROVE` and `REQUEST_CHANGES` on one's own pull request, so the
verdict is in the text — start it with **Review: passes** or **Review: changes needed**:

```bash
gh api -X POST $R/pulls/N/reviews -f event=COMMENT -f body="$(cat review.md)"
```

Endpoint: `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`. End the body with the footer the
session's instructions give for GitHub posts.

## 5. CI, read through REST

**The five required checks** are `Static checks`, `Unit tests`, `Integration tests`,
`Extension checks` and `Closing reference check`
([`.github/rulesets/README.md`](../../.github/rulesets/README.md) is the record). Read them on the
pull request's **current** head, from step 1:

```bash
gh api "$R/commits/<head-sha>/check-runs?per_page=100" \
  --jq '.check_runs[] | "\(.status) \(.conclusion)  \(.name)  \(.started_at)"'
```

CI is green when each of the five is `completed` with `success` — or `skipped` for the four suites
when `Detect changes` itself succeeded and found the diff inside its safe list (#798) — and nothing
is `queued` or `in_progress`. `failure`, `cancelled`, `timed_out` or a missing check is not green;
wait for a run still going rather than guessing at it. A check run named twice is two runs: read the
one with the latest `started_at`.

**Closing references.** `closingIssuesReferences` is GraphQL-only, so read the two halves it guards
directly. The `Closing reference check` re-runs on every body or title edit (`closing-refs.yml`,
#935): after an edit, its newest run must have started after the edit before its verdict counts.
And read the text itself with the job's own expression:

```bash
keywords='\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]*:?[[:space:]]*(#|GH-|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#|https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/)[0-9]+'
gh api $R/pulls/N --jq .body | grep -iE "$keywords"
gh api --paginate $R/pulls/N/commits --jq '.[].commit.message' | grep -iE "$keywords"
```

Both greps must print nothing (exit 1).

## 6. Merge

Only when the review passed, CI is green on the head you reviewed, and § *3* is clear.

**A pull request that carries a database migration** is rebased onto the `main` it is about to merge
into, immediately before the merge, and re-verified
([`collaboration.md`](collaboration.md) § *Branches and pull requests*). That rebase is the author's
— a reviewer never rewrites another thread's branch — so ask for it in the review, then review and
read CI again on the new head. Any other pull request merges as it stands, behind `main` or not
(#1791), unless GitHub reports a conflict, which is likewise the author's to rebase.

```bash
gh api -X PUT $R/pulls/N/merge -f merge_method=rebase -f sha=<head-sha> --jq '"\(.merged) \(.sha)"'
```

Endpoint: `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`. **`sha` is the head you reviewed**:
if the author pushed after your review, GitHub refuses the merge (409) instead of merging something
nobody read. Never auto-merge — it needs GraphQL and it merges on a verdict nobody re-read.

## 7. Read `main`'s run after the merge

**`main`'s own run is the safety net** ([`collaboration.md`](collaboration.md) § *When `main` turns
red*), and the thread that merged reads it. The merge answer's `sha` is the rebased head now on
`main`; use the full forty characters — `head_sha` answers nothing at all for an abbreviated one:

```bash
gh api "$R/actions/workflows/ci.yml/runs?branch=main&head_sha=<full-sha>" \
  --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion)"'
gh api --paginate "$R/actions/runs/<id>/jobs?per_page=100" --jq '.jobs[] | "\(.conclusion)  \(.name)"'
```

Wait for it to complete. **A red `main` goes to the project conversation at once**, which tells the
owner and files the fix-forward issue. Nobody reverts or patches `main` around the gate.

## 8. Report

A short reply to the project conversation: merged (with the merge SHA and `main`'s run), or not
merged and why — the review's link, and the open question for the owner if there is one. The
project conversation reports to the owner, in Polish; this thread does not post to the issue and
does not close it.
