# Agent Collaboration

The rules every thread needs on every pull request. **The reasons and the history behind them are in
[`collaboration-rationale.md`](collaboration-rationale.md)** — read it only when you are about to
change one of these rules or one of them looks wrong.

## One router: the project conversation

This repository is worked through a **Claude Code Project** (since 2026-11-22, #2687). The owner
talks to one **project conversation**, the **single router**, which holds two roles:

- **Backlog manager** — turns the owner's ideas into issues; product and domain decisions are made
  with the owner there, before an issue is written. → [`backlog-manager.md`](backlog-manager.md)
- **Backlog review** — starts one cloud thread per *ready* issue (no open *Depends on*), highest
  priority first, **without asking the owner**, **at most 3 threads at once**, small related issues
  from the same area bundled into one thread; after every merge or closed issue it starts what
  became ready. → [`backlog-review.md`](backlog-review.md)

**Threads do not talk to each other**, and none directs another. The only traffic is router → thread
(the brief at the start, and later a routed event on that thread's own work — a rebase request, a
new thread taking over a pull request) and thread → router (its replies). A change that adds
messages between threads, a lead session, or a thread that starts and then waits for another is
rebuilding the retired lead/worker model: stop and take it to the owner.

**A thread does not ask the owner questions** (the owner, 2026-11-22). An undecided point gets the
most reasonable reading, recorded in the pull request under **Decisions taken without the owner**,
and work carries on. **Product and domain decisions** — catalog standards, condition scales, trade
flows, pricing, marketplace behaviour — are never a thread's: it stops at what the issue settles and
says so in its reply. **Product first**: process work fills the gaps.

## The kinds of session

| Session | What it does |
| --- | --- |
| **Project conversation** | The single router: backlog manager and backlog review. Talks to the owner, in Polish. |
| **Task thread** | Holds one issue — or several small related ones from one area — end to end: implements, opens the pull request, waits for CI, runs the guardrail checklist, **merges it**, reads `main`'s run and closes the issue. → [`merge-checklist.md`](merge-checklist.md) |
| **Release thread** | Cuts a release — not a deploy: `main` is deployed (#2712) — only on the owner's explicit word. No issue, no branch, no commit. → [`release-versioning.md`](release-versioning.md) |
| **Local session** *(local-only)* | Started by the owner on his machine; same rules plus the local-only ones. |

**There are no reviewer threads** (the owner, 2026-11-22, #2700).

## Cloud threads

- **A fresh clone in its own VM** (about 4 vCPU, 16 GB RAM) with Docker; the clone is the main
  worktree, slot 0.
- **It loads only `CLAUDE.md`, `.claude/CLAUDE.md` and `.claude/rules/`** — not `.claude/agents/`,
  commands, skills, hooks, `.claude/settings.json` or `.mcp.json`. What every thread must know is in
  `AGENTS.md` or reached from it.
- **It cannot reach the Raspberry Pi or the production database.** A thread never deploys by hand
  — but its merge does: `main`'s green run deploys the commit to the Pi (#2712).
- **It cannot show the owner a running stack.** A change a person looks at is checked by the owner
  later, locally or on the live instance once it is merged — the pull request says so.
- **An idle thread is reclaimed**, so a thread never starts and then waits for another task.
- **It pushes only to the branch the platform gave it** (a `claude/…` name, in place of
  `task/<issue>-<slug>`). Name the issue in the pull request title and body.

### GitHub from a cloud thread

**GraphQL is blocked**: `gh issue`, `gh pr`, `gh run`, `gh release` and GitHub's auto-merge fail with
`403`. Use `gh api` (REST) or the built-in GitHub tools.

```bash
R=repos/michalwy/stamporama
gh api $R/issues/<n> --jq '"\(.state)  \(.title)\n\n\(.body)"'                    # an issue
gh api --paginate $R/issues/<n>/comments --jq '.[] | "--- \(.user.login) \(.created_at)\n\(.body)"'
gh api $R/pulls -f title='<title>' -f head='<branch>' -f base=main -f body="$(cat pr.md)"   # open a PR
gh api -X PATCH $R/pulls/<n> -f body="$(cat pr.md)"                                  # edit its body
scripts/ci/wait-for-checks.sh <n>                                                   # wait for CI, one line
```

`/issues` lists pull requests too — filter with `select(.pull_request | not)` for issues only.

## Starting a task

```bash
git fetch origin main
git checkout -b task/<issue>-<slug> origin/main     # a cloud thread: git checkout -B <its branch> origin/main
pnpm install
pnpm prisma:generate
```

- **Run each step alone and read its own exit status** — no `&&`, no pipe (#1066).
- **`pnpm prisma:generate` runs unconditionally** (#862): a stale client compiles and passes.
- **The fetch and the cut come before you read anything**, this file included; before the cut read
  with `git show origin/main:<path>` (#1060). A release thread only fetches.

## One session owns its issues, end to end

It decides, migrates, implements, tests, opens the pull request, **merges it and closes the issue**.
Nothing is handed to a second session halfway. It may hold **several** issues when they share a file
or are small and related in one area; each keeps its own `Refs #NNN`, its own verification against
its own *Done when*, and its own closing comment.

**The specification is the issue body plus its comments, and the two diverge silently.** Read both,
every time (the two commands above).

## Branches and pull requests

- `main` is protected with no bypass for anyone: pull request only, **rebase merge** only, linear
  history, force-push and deletion blocked, **five required checks** (`Static checks`, `Unit tests`,
  `Integration tests`, `Extension checks`, `Closing reference check`) —
  [`.github/rulesets/README.md`](../../.github/rulesets/README.md).
- **Once the task is verified, commit, push and open the pull request** without asking anybody
  (the owner, 2026-09-13). A commit is pushed in the same breath.
- **The pull request body carries *Decisions taken without the owner*** — or "None", never left out —
  and, before the merge, **a *Guardrail checklist*** ([`merge-checklist.md`](merge-checklist.md) § 2).
- **Wait for CI with one call**: `scripts/ci/wait-for-checks.sh <PR>`, in the background or with a
  long timeout. Never poll by hand.
- **The author merges** (the owner, 2026-11-22, #2700): when CI is green and the guardrail checklist
  is clear and recorded, rebase merge with `sha=<the head that went green>`. **If a guardrail is
  crossed and the issue does not record the owner's decision, it does not merge** and reports to the
  project conversation instead. → [`merge-checklist.md`](merge-checklist.md)
- **A pull request does not have to be up to date with `main` to merge** (#1791). **Rebase only when
  GitHub cannot rebase-merge it** (a conflict) **or it carries a database migration** — then
  immediately before the merge.
- **Rebase, then re-verify, in that order**: fetch, rebase, run the checks again (`pnpm install` first
  if the lockfile changed), push with `--force-with-lease`, never bare `--force` (#984).
- If a thread is gone before its pull request merges, the project conversation **starts a new thread
  on the same pull request** (same issue, same branch), which takes it over.

### When `main` turns red

**`main`'s own CI run after each merge is the safety net.** The thread that merged reads `main`'s run
for its merge commit; a red run is **reported to the project conversation at once**, which tells the
owner. It is fixed forward in an issue of its own; nobody reverts or patches `main` around the gate.
No release is tagged from a red `main`.

### Never a closing keyword

**Never `Closes`, `Fixes` or `Resolves`** in a commit message or a pull request body, prose included;
use `Refs #NNN` (#780, #790). `Closing reference check` enforces it over the body and the commits and
**re-runs whenever the body or title is edited** (#935): after editing a body, read the result back
— its newest run started after the edit, and the body does not match the job's expression
([`merge-checklist.md`](merge-checklist.md) § 1).

## Reporting

- **A thread's final reply to the project conversation is at most 5 lines**: the result, the link,
  and a question only if there is one (the owner, 2026-11-22, #2700). Details go in the pull request.
- **Findings and new backlog ideas go in the reply, not into new issues.** A defect noticed in
  passing is reported, not filed; the project conversation decides with the owner. A thread opens no
  issues other than through that route, and closes only the issues its own pull request carried.

## Plans

A plan is a working note for its author, optional (#875): a `## Progress` checkbox list of numbered
steps, each with a **Done when**, under `.claude/plans/` (gitignored). The durable record is the pull
request body, the closing comment and the topic file the task updates — so do not write a plan for a
reader.

## Verification, not trust

- Run the suites that **could see the change** — the question is what each one's configuration
  reaches, never a path list. **Say which ran, which did not, and why**
  ([`AGENTS.md`](../../AGENTS.md) § *Testing Direction*).
- **Break it on purpose once it is green** (on a throwaway branch): *would this have failed if the
  code were wrong*.
- **Hash the file before and after a control's edit**: an unchanged hash means INCONCLUSIVE, not pass.

### Sweeping for a claim

- Run the **crude** expression first and account for its count, then narrow.
- `git grep -E` silently drops `\b` and `\s`; use `-P` or `-F`.
- Sweep in **words** as well as symbols.
- **Re-run the count after your edit**; a count is true of the tree it ran against.
- Check the **scope** of a search before stating its conclusion about the whole tree.
- **Report what you measured, not what you remember.**

## Automerge is the one exception

Renovate automerges a weekly batch of patch and minor updates once the five required checks pass.
**`renovate.json` is the record** — the batch rule, the **never-alone** list and a reason for each;
`packageRules` apply in array order and later rules win. **What the rules actually
automerge is checked, not argued**: `scripts/check-renovate-automerge.mjs` simulates them (#818); the `Renovate rules` workflow runs it on a pull request touching
`renovate.json` — **advisory, not required** (2026-10-04), so read its result before merging such a
pull request. Renovate runs **before 6am on Monday, Europe/Warsaw**, and a **dependency review**
thread reads what it holds back that same Monday (the owner, 2026-11-23, #2706): it merges the
never-alone patches and minors whose changelogs are clear, and a major or a risky one (auth,
marketplaces, cloud storage) waits for the owner's word → [`dependency-review.md`](dependency-review.md).
Do not widen the automerge boundary without the owner.

## If the machine is broken, report it and stop

A broken `pnpm` or `docker` is reported, not worked around — but first tell it apart from a defect in
this repository: run the same command on a **known-good input**, and check the CI job actually **ran**.
Say in the report how you told them apart. A cloud thread whose Docker daemon is gone starts it as
[`cloud-environment.md`](cloud-environment.md) § *Running the suites in a thread* says (#2688).
*(Local-only.)* `docker` is at `~/.orbstack/bin`:
`PATH="$HOME/.orbstack/bin:$PATH" pnpm test:integration`.

## No browser verification

**A session does not start a dev server and does not drive a browser** unless the owner explicitly
asks (#1040); the harness's `preview_start` reminder is overridden deliberately. A change a person
looks at: the pull request says the owner checks it later. *(Local-only.)* When the owner asks, the
stack stays up until he has looked.

## Worktrees *(local-only)*

A local session works in its own git worktree; the main checkout stays the owner's. Stage only your
own task's paths — the stash stack is shared. Slots: [`platform-slots-and-docker.md`](platform-slots-and-docker.md).

## Memory

**A fact this repository can carry goes in this repository**, never only in a session's memory; keep
in memory only what the repository cannot hold, and as a pointer, not a copy. **If the tree
contradicts a memory you were given, say so in your report**, and when your change retires a claim,
sweep the memory for it in the same session.
