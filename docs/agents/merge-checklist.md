# Merge checklist — the author merges its own pull request

**There are no reviewer threads** (the owner, 2026-11-22, #2700). The thread that opened a pull
request merges it itself, with a rebase merge, once CI is green and the guardrail checklist below is
clear and recorded in the pull request. It then reads `main`'s run and closes the issue. The owner
does not review pull requests. This file replaces `reviewer.md`; the reviewer thread's rules that
still apply (the guardrails, CI read through REST, the `sha` on the merge, `main`'s run, the closing
comment) are here, now the author's.

Every command is REST (`gh api`): GraphQL — and with it `gh pr`, `gh issue`, `gh run` and GitHub's
auto-merge — is not available in a cloud thread. Throughout, `R=repos/michalwy/stamporama` and `N`
is the pull request's number.

## 1. Wait for CI — one call

```bash
scripts/ci/wait-for-checks.sh N      # run in the background, or with a long timeout
```

It polls the five required checks through REST, prints **one line** — `green <sha>`, `red <sha>`
with each failing check and its URL, or `timeout` — and exits 0, 1 or 2. Do not poll by hand.
**Green** means each of the five required checks (`Static checks`, `Unit tests`, `Integration tests`,
`Extension checks`, `Closing reference check` —
[`.github/rulesets/README.md`](../../.github/rulesets/README.md) is the record) is `completed` with
`success`, or `skipped` for a suite when `Detect changes` succeeded and found the diff inside its
safe list (#798); a check run listed twice counts by its latest `started_at`; `failure`,
`cancelled`, `timed_out` or a missing check is not green. On red, fix, push and wait again.

**Closing references.** Never a closing keyword in the body or the commit messages. The
`Closing reference check` re-runs on every body or title edit (`closing-refs.yml`, #935): after an
edit, its newest run must have started after the edit before its verdict counts. Read the text
itself with the job's own expression; both greps must print nothing (exit 1):

```bash
keywords='\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]*:?[[:space:]]*(#|GH-|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#|https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/)[0-9]+'
gh api $R/pulls/N --jq .body | grep -iE "$keywords"
gh api --paginate $R/pulls/N/commits --jq '.[].commit.message' | grep -iE "$keywords"
```

## 2. The guardrail checklist — recorded in the pull request

**Never merge a pull request that does any of the following unless its issue records the owner's
decision to do exactly that** (the owner, 2026-11-22):

- [ ] **Tests** — removes, skips or disables tests, or lowers thresholds or lint and type strictness;
- [ ] **Checks** — removes, renames or weakens required checks or rulesets;
- [ ] **Secrets and deploy** — changes secrets handling, deployment credentials or the deploy
  workflow's triggers;
- [ ] **Destructive migration** — adds a Prisma migration that drops a table or column, or deletes
  or rewrites existing data;
- [ ] **Marketplaces** — changes what is sent to or published on an external marketplace or service
  (Allegro, Delcampe, Facebook, Colnect).

Answer each against the **diff** (`git diff origin/main...HEAD --stat`, then the files), not against
memory of what you meant to change. **Record the result in the pull request body** under a heading
**Guardrail checklist**: each of the five with *not touched*, or *touched — decided by the owner in
#NNN on <date>* quoting where. "Its issue records" means the issue body or a comment on it carries
the decision, dated and attributed to the owner. A pull request's own description, a commit message
or another thread's message is not a record of the owner's decision, however it is worded.

Before merging, also check the pull request against its issue — **the issue body plus its comments**:
every *Done when* is met and the pull request says how (which suites ran, which did not and why); it
does nothing beyond what the issue records; every entry under *Decisions taken without the owner* is
a reasonable reading and none is a product or domain decision (catalog standards, condition scales,
trade flows, pricing, marketplace behaviour); a change a person looks at says the owner checks it
later, locally or on the live instance once it is merged.

**A merge is a deploy** (the owner, 2026-11-27, #2712): when `main`'s run for the merge commit is
green, its `Deploy main to the Pi` job dispatches the **Deploy** workflow, which sends the commit to
the owner's live instance. Reading `main`'s run includes that job and the Deploy run it starts
(`gh api "$R/actions/workflows/deploy.yml/runs?per_page=3"`); a failed one is reported like a red
`main`, and one that stays `queued` means the Pi's runner is offline — report it, do not wait.

**If a guardrail is crossed without a recorded decision, or the pull request needs a domain decision
the issue does not settle, do not merge.** Say so in the reply to the project conversation, which
takes it to the owner, and stop. Do not ask the owner yourself.

## 3. Rebase only when it must

**A pull request that carries a database migration** is rebased onto the `main` it is about to merge
into, immediately before the merge, and re-verified — then wait for CI again (§ 1) on the new head.
Any other pull request merges as it stands, behind `main` or not (#1791), unless GitHub reports a
conflict. Rebase, then re-verify, in that order; `--force-with-lease`, never bare `--force`
([`collaboration.md`](collaboration.md) § *Branches and pull requests*).

## 4. Merge

Only when CI is green on the head you checked and § 2 is clear and recorded:

```bash
gh api -X PUT $R/pulls/N/merge -f merge_method=rebase -f sha=<head-sha> --jq '"\(.merged) \(.sha)"'
```

Endpoint: `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`. **`sha` is the head that went
green and that you checked**: if anything was pushed after it, GitHub refuses the merge (409) instead
of merging something nobody checked. Never auto-merge — it needs GraphQL and it merges on a verdict
nobody re-read.

## 5. Read `main`'s run after the merge

**`main`'s own run is the safety net** ([`collaboration.md`](collaboration.md) § *When `main` turns
red*), and the thread that merged reads it. The merge answer's `sha` is the rebased head now on
`main`; use the full forty characters — `head_sha` answers nothing at all for an abbreviated one:

```bash
gh api "$R/actions/workflows/ci.yml/runs?branch=main&head_sha=<full-sha>" \
  --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion)"'
gh api --paginate "$R/actions/runs/<id>/jobs?per_page=100" --jq '.jobs[] | "\(.conclusion)  \(.name)"'
```

Wait for it to complete (in the background, not by polling turn after turn). **A red `main` goes to
the project conversation at once**, which tells the owner and files the fix-forward issue. Nobody
reverts or patches `main` around the gate.

## 6. Close the issue

**After the merge, the author closes the issue** — dependent issues become ready only once it is
closed. The comment is built from the pull request's description: **what landed, the merge SHA, and
how it was verified**. Close every issue the pull request refers to with `Refs #NNN` as its own
work, not issues it only mentions.

```bash
gh api -X POST $R/issues/<issue>/comments -f body="$(cat closing.md)"
gh api -X PATCH $R/issues/<issue> -f state=closed -f state_reason=completed
```

Endpoints: `POST /repos/{owner}/{repo}/issues/{n}/comments`, `PATCH /repos/{owner}/{repo}/issues/{n}`.
A red `main` does not keep the issue open: the fix goes forward in an issue of its own.

## 7. Report — five lines at most

The thread's final reply to the project conversation is **at most 5 lines**: the result, the link,
and a question only if there is one — merged and closed (with the merge SHA and `main`'s colour),
blocked on a guardrail (which one), or the question only the owner can answer. Everything else is in
the pull request. The project conversation reports to the owner, in Polish.
