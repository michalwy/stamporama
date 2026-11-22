# Agent Collaboration

How work is split between sessions here, and how a change reaches `main`.

## One router: the project conversation

Since 2026-11-22 this repository is worked through a **Claude Code Project** (#2687). The owner talks
to one **project conversation**, and every issue is done by a **cloud thread** that the Project
platform starts, runs in its own VM and tracks. The project conversation is the **single router**
and holds two roles:

- **Backlog manager** — turns the owner's ideas, remarks and bug reports into issues, and is where
  product and domain decisions are made with the owner, before an issue is written.
  → [`backlog-manager.md`](backlog-manager.md)
- **Backlog review** — starts one cloud thread per *ready* issue (no open *Depends on*), highest
  priority first, **without asking the owner**, and after every merge or closed issue starts what
  became unblocked. → [`backlog-review.md`](backlog-review.md)

**Threads do not talk to each other**, and none of them directs another. A thread reports in its own
replies, which the project conversation reads; what one thread needs from another goes through the
project conversation, the way it used to go through the owner. The #1985 exception — a backlog
manager messaging the backlog-review session — is absorbed: both roles now live in one conversation.

### This is not the retired lead/worker model

A lead/worker model — one long-lived session briefing the others by message — ran from 2026-09-06 to
2026-09-11 and was retired: the traffic between sessions cost more than it produced, and most of the
issues it generated were about itself rather than about the product. **The Project model is not its
return**, and the difference is the point:

- **The platform starts and tracks threads**, not a session. Nothing is briefed, polled or chased by
  message; a thread's state is the platform's, and its result is its pull request.
- **The project conversation routes the way the owner used to: by issue.** A thread is told an issue
  number, a role, a branch — and the issue is its whole brief. The specification lives on GitHub,
  not in a message, so there is nothing to relay and nothing to drift.
- **Threads still never talk to each other.** The only traffic is router → thread and thread →
  router. Router → thread is the brief at the start **and, later, a routed event on that thread's own
  work** — a reviewer's *changes needed*, a request to rebase a migration (the owner, 2026-11-22). It
  carries a fact and a pull request number, never a new brief. No thread waits on another: only
  *ready* issues are started, and a thread that has gone idle is not kept alive for a later message —
  see § *Branches and pull requests*.

If a change to these rules starts adding messages between threads, a lead session, or a thread that
starts and then waits for another, it is rebuilding the retired model. Stop and take it to the owner.

### Threads never ask the owner

**A thread does not ask the owner questions** (the owner, 2026-11-22). A thread that meets an
undecided point takes the most reasonable reading, records it in the pull request under the heading
**Decisions taken without the owner**, and carries on. A reviewer checks those readings
([`reviewer.md`](reviewer.md)).

Product and domain decisions — catalog standards, condition scales, trade flows, pricing,
marketplace behaviour — are **not** a thread's to take, reasonably or otherwise. They are made with
the owner in the project conversation before the issue is written, and recorded in the issue. The
old rule "ask before defining domain behaviour" now reads: **the backlog manager asks; threads do
not.** A thread that finds such a point undecided stops at what the issue does settle and says so in
its reply; the project conversation takes it to the owner.

**Product first.** Process work is filler for the gaps, never the queue.

## The kinds of session

| Session | What it does |
| --- | --- |
| **Project conversation** | The single router: backlog manager and backlog review. Talks to the owner, in Polish. → [`backlog-manager.md`](backlog-manager.md), [`backlog-review.md`](backlog-review.md) |
| **Task thread** | Holds one issue, or several that share a file, end to end, up to an open pull request it follows to merge. Most threads are this. |
| **Reviewer thread** | Reviews one pull request against its issue and merges it when the review passes and CI is green. → [`reviewer.md`](reviewer.md) |
| **Release thread** | Cuts a release — a tag, a Release, a published image, and so a deploy — only on the owner's explicit word. No issue, no branch, no commit. → [`release-versioning.md`](release-versioning.md) |
| **Local session** *(local-only)* | A session the owner starts by hand on his machine — to look at a running stack, or for anything he routes himself. It follows the same rules, plus the ones marked local-only below. |

## Cloud threads

What every thread can count on, and what it cannot (the owner, 2026-11-22):

- **A fresh clone in its own VM** (about 4 vCPU, 16 GB RAM) with Docker and docker compose. No
  worktree, no shared stash, no slot contention: the clone is the main worktree, slot 0.
- **It loads only `CLAUDE.md`, `.claude/CLAUDE.md` and `.claude/rules/`** from the repository. Not
  `.claude/agents/`, commands, skills, hooks, `.claude/settings.json` or `.mcp.json`. Anything every
  thread must know is therefore in `AGENTS.md` or reached from it — `CLAUDE.md` points there.
- **It cannot reach the Raspberry Pi or the production database**, by design. A thread never
  deploys.
- **It cannot show the owner a running stack.** A change a person looks at is checked by the owner
  later, in a local session or on the live instance after a release — the pull request says so.
- **An idle thread is reclaimed.** A thread must not start and then wait for another task; that is
  why only ready issues are started.
- **It pushes only to the branch the platform gave it** (a `claude/…` name), which takes the place of
  `task/<issue>-<slug>`. Name the issue in the pull request title and body instead.

### GitHub from a cloud thread

**GraphQL is blocked in a cloud session**, so `gh issue`, `gh pr`, `gh run`, `gh release` and every
other `gh` subcommand built on it fail with `403`. GitHub's auto-merge needs GraphQL too. Use
`gh api` (REST) or the session's built-in GitHub tools. The commands in `docs/agents/` are all REST:
each read was run in a cloud thread, and each write is the documented endpoint it names (#2687).
The ones every thread needs:

```bash
R=repos/michalwy/stamporama
gh api $R/issues/<n> --jq '"\(.state)  \(.title)\n\n\(.body)"'                    # an issue
gh api --paginate $R/issues/<n>/comments --jq '.[] | "--- \(.user.login) \(.created_at)\n\(.body)"'
gh api $R/pulls -f title='<title>' -f head='<branch>' -f base=main -f body="$(cat pr.md)"   # open a PR
gh api -X PATCH $R/pulls/<n> -f body="$(cat pr.md)"                                  # edit its body
gh api "$R/commits/<sha>/check-runs?per_page=100" --jq '.check_runs[] | "\(.status) \(.conclusion)  \(.name)"'
```

`/issues` lists pull requests too — filter with `select(.pull_request | not)` when you want issues
only. Endpoints: `GET /repos/{owner}/{repo}/issues/{n}`, `…/issues/{n}/comments`,
`POST /repos/{owner}/{repo}/pulls`, `PATCH /repos/{owner}/{repo}/pulls/{n}`,
`GET /repos/{owner}/{repo}/commits/{ref}/check-runs`.

## Starting a task

```bash
git fetch origin main
git checkout -b task/<issue>-<slug> origin/main     # a cloud thread: git checkout -B <its branch> origin/main
pnpm install
pnpm prisma:generate
```

A cloud thread's clone is already on its branch; the `-B` re-cuts it from the `origin/main` just
fetched, which is right while the branch carries no commit of its own.

**Run each step alone and read its own exit status.** Do not chain with `&&` and do not pipe — after
a pipe `$?` belongs to the filter, so a drill in which both `pnpm` calls failed reports the same `0`
as a clean one and is recorded as done (#1066).

**`pnpm prisma:generate` runs unconditionally.** A worktree may be hours old, and if `main` has taken
a migration since, `pnpm install` reports *Already up to date*, skips the postinstall, and leaves a
Prisma client that is **stale rather than missing** — it compiles, and its tests pass against a
schema the branch no longer declares (#862).

**The fetch and the cut come before you read anything** — `AGENTS.md`, this file and the topic files
included. After the cut the worktree *is* `origin/main`; before it, read with
`git show origin/main:<path>` (#1060). A release session has no issue and cuts no branch, so only the
fetch reaches it.

## One session owns one issue, end to end

It decides, migrates, implements, tests, opens the pull request and follows it to merge. Nothing is
handed to a second session halfway through.

A session may hold **several** issues when they share a file — that is the normal answer to file
contention. Each keeps its own `Refs #NNN`, its own verification against its own *Done when*, and
its own closing comment. The cost is that a bundle cannot be undone one issue at a time.

**The specification is the issue body plus its comments, and the two diverge silently.** A *Done
when* is often amended in a comment while the body keeps its original wording, and an overtaken body
looks exactly like a current one. Read both — two REST calls, one per half, and both every time:

```bash
gh api repos/michalwy/stamporama/issues/<n> --jq '"\(.state)  \(.title)\n\n\(.body)"'
gh api --paginate repos/michalwy/stamporama/issues/<n>/comments --jq '.[] | "--- \(.user.login) \(.created_at)\n\(.body)"'
```

**Once the pull request has merged, the reviewer closes the issue** (the owner, 2026-11-22), with a
comment taken from the pull request's description: what landed, the merge SHA, and how it was
verified. The author thread may be gone by then, so the close does not wait on it
([`reviewer.md`](reviewer.md) § *Close the issue*).

## Branches and pull requests

`main` is protected with no bypass for anyone, the user included: a pull request is the only way in,
rebase merge only, linear history, force-push and deletion blocked, and five required checks
(`Static checks`, `Unit tests`, `Integration tests`, `Extension checks`, `Closing reference check`).
The ruleset itself is checked in — see
[`.github/rulesets/README.md`](../../.github/rulesets/README.md).

Work happens on `task/<issue>-<slug>` — in a cloud thread, the branch the platform gave it —
branched from `main`. **Once the task is verified, the thread commits, pushes and opens the pull
request on its own**, with no question to anybody first (the owner, 2026-09-13). **The thread that
opens the pull request owns it until it merges** — but it does not sit watching it: an idle thread is
reclaimed. The flow goes through the router (the owner, 2026-11-22):

1. The reviewer reports its verdict to the project conversation.
2. On **changes needed**, or a **request to rebase** a pull request that carries a migration, the
   project conversation sends it to the author thread. **If that thread is gone, it starts a new
   thread on the same pull request** — same issue, same branch — which takes the pull request over.
3. The author thread (or its successor) makes the change, re-runs the checks after every rebase,
   pushes, and says so in its reply; the project conversation starts the review again.

**A separate reviewer thread merges it** (the owner, 2026-11-22): the project conversation starts one
for every pull request, and it merges with a rebase merge when the review passes and CI is green.
The owner does not review pull requests. A pull request that goes beyond what its issue records, or
crosses one of the hard guardrails without a decision recorded in its issue, is not merged.
→ [`reviewer.md`](reviewer.md)

**The pull request body carries a heading *Decisions taken without the owner*** — every undecided
point the thread settled on its own, and the reading it took. Write "None" rather than leaving it
out, so a reviewer can tell an empty list from a forgotten one.

**A pull request does not have to be up to date with `main` to merge** (#1791). Its required checks
must pass on its own head; being behind is not a reason to rebase. Parallel issues usually touch
different areas, and rebasing every open pull request after every merge cost most of the day for
runs that almost never caught anything (#854, #880). **Rebase only when one of two things holds:**

- **GitHub cannot rebase-merge it** — the pull request conflicts with `main`.
- **It carries a database migration** — the one place two independently green changes are likely
  to disagree (the schema, the order of migrations), and where a fix after the merge is expensive.
  Rebase onto the `main` it is about to merge into, immediately before the reviewer merges it — the
  author thread does the rebase, the reviewer asks for it.

Otherwise merge it as it stands.

**Rebase, then re-verify, in that order.** Fetch, rebase onto `main`, run the checks again, force-push
with `--force-with-lease` — never bare `--force`. The re-run is the half that is easy to drop
and the only half that is interesting: a suite that was green before the rebase was green against a
different `main`. Add `pnpm install` between the rebase and the suites when the rebase pulled in a
lockfile change.

### When `main` turns red

**`main`'s own CI run after each merge is the safety net** that keeping every branch up to date used
to be — the user accepted that two changes which each passed alone can occasionally break `main`
together. So **the thread that merged — the reviewer — reads `main`'s run for its merge commit**,
and a red run is **reported to the project conversation at once**, which tells the owner. It is
fixed forward, in an issue of its own, through the ordinary pull request flow; nobody reverts or
patches `main` around the gate. No release is tagged from a red
`main` ([`release-versioning.md`](release-versioning.md)).

**Never a closing keyword** (`Closes`, `Fixes`, `Resolves`) in a commit message or a pull request
body — GitHub acts on it the moment the change lands and closes the issue before anybody has
verified it. Use `Refs #NNN`. The `Closing reference check` job in CI enforces this over both the
body and the commit messages. **The check re-runs whenever the body or title is edited**
(`closing-refs.yml`, #935) — before that it ran only on a push, so its green could describe a body
that no longer existed. **After editing a body, read the result back**: the check's newest run must
have started after the edit, and the body itself must not match the job's expression. The job reads
`closingIssuesReferences`, which is GraphQL-only; a cloud thread reads the same two halves through
REST, as [`reviewer.md`](reviewer.md) § *CI, read through REST* sets out.

## Plans are a working note, not a record

A plan is for the session that writes it; nothing downstream reads it. Write one when a task spans
more than one logical area and setting the steps out first would help — the session's own call rather
than a requirement (#875). Keep the shape that makes it useful to its author: a `## Progress`
checkbox list of numbered steps, executed in order, each marked `[x]` as it completes, each stating a
**Done when**.

Store it under `.claude/plans/`, which is gitignored, so it lives only in that worktree and goes with
it. Nothing is lost, because **the durable record is the pull request body, the closing comment on
the issue, and the topic file the task updates** — all three in git, all three read. So do not write
a plan for a reader.

## Verification, not trust

Run the suites that **could see the change** — the question is what each one's configuration
reaches, never a path list. Say in your report which suites ran, **which did not, and why**: silence
about a skipped suite is indistinguishable from having forgotten it. The list and the boundary are
in [`AGENTS.md`](../../AGENTS.md) § *Testing Direction*.

Two habits that have found more real defects here than anything else:

- **Break it on purpose once it is already green.** *Did the assertions pass* is not the check; *would
  this have failed if the code were wrong* is. Do it on a throwaway branch.
- **Hash the file before and after a control's edit.** A no-op edit and a non-discriminating test are
  byte-identical from an exit status, so an unchanged hash means INCONCLUSIVE, not pass.

### Sweeping for a claim

Run the crude expression **first** and account for its count, then narrow. A precise expression run
first can exit 1 with no output — a truthful no-match over a pattern that could never have matched,
byte-identical to a clean tree. `git grep -E` silently drops `\b` and `\s`; use `-P` or `-F`. Sweep
in **words** as well as symbols — prose says *"Add child stamp"* where the code says `add-child`.
And a count is true of the tree it ran against: re-run it after your edit rather than letting the
first number travel into a claim about the finished branch.

**The guards protect the instrument; the remaining failure is the question.** A search that ran,
exited truthfully and answered exactly what it was asked can still be scoped to one package of a
two-package repository — and the conclusion then gets stated about the whole tree.

**Report what you measured, not what you remember.** Where a claim has a command that answers it,
run the command — including when you are correcting an earlier claim of your own.

## Automerge is the one exception

Renovate merges a weekly batch of patch and minor updates with no human in the loop, once the five
required checks pass. **`renovate.json` is the record** — it carries the batch rule, the **never-alone**
list, and a written reason for every package on it. A dependency is never-alone either
because something in this tree states a reason a bump could invalidate, or because its failure mode
is invisible to all five required checks. Read it there rather than restating it; `packageRules` are
applied in array order and later rules win, which is load-bearing.

**What the rules actually automerge is checked, not argued** (#818).
`scripts/check-renovate-automerge.mjs` simulates them per dependency and update type and fails when a
never-alone dependency or any major would automerge, with a positive control so it cannot pass by
matching nothing. It fails closed on any matcher, preset or key it does not model — extending it
means re-checking it against Renovate itself, and the script says how. The `Renovate rules`
workflow runs it on a pull request touching `renovate.json`; it is **advisory, not required** (the
user, 2026-10-04), so read its result before merging such a pull request.

**The arrangement's whole point is that nobody watches it, so it fails by going quiet.** It was
silently impossible for eight weeks once, asking for `squash` against a repository that only allows
rebase, and no signal anywhere said so. A backlog review sweeps for that
([`backlog-review.md`](backlog-review.md)); do not widen the boundary without the owner.

**Renovate stays as it is under the Project model** (the owner, 2026-11-22). Its pull requests are
not a thread's, so the project conversation starts no reviewer thread for them: the weekly batch
automerges by `renovate.json`, and one the rules hold back — a major, a never-alone dependency —
waits for the owner's word in the project conversation, as before.

## If the machine is broken, report it and stop

A broken `pnpm` or `docker` is not something to work around: a workaround multiplies across every
session that meets it. But *report and stop* is the wrong answer to a defect in this repository's
own configuration, and at the moment a command exits non-zero the two look identical. Tell them
apart before reporting: run the same command on a **known-good input** (an untouched file, `main`
itself), and check that the relevant CI job actually **ran** rather than reporting green while
skipped. Say in the report how you told them apart.

*(Local-only.)* On the owner's machine `docker` lives at `~/.orbstack/bin`, and an empty
`command -v docker` is a fact about this shell's PATH, not about the machine:
`PATH="$HOME/.orbstack/bin:$PATH" pnpm test:integration`. A cloud thread's VM has `docker` on its
PATH, but its daemon is started by the environment's setup script, and a resumed session can find it
gone: start it as [`cloud-environment.md`](cloud-environment.md) § *Running the suites in a thread*
says (#2688). An absent `docker`, or a daemon that will not start that way, is the environment's
defect and is reported.

## No browser verification — a deliberate departure

**A session does not start a dev server and does not drive a browser** unless the owner explicitly
asks. Verification here is the suites. Your tooling will tell you that no preview server is running
and to call `preview_start`; that reminder is emitted by the harness rather than configured in this
repository, and it is overridden deliberately rather than followed.

**When a change is one a person looks at**, a cloud thread cannot show it: the pull request says
that the owner checks it later, in a local session or on the live instance after a release.
*(Local-only.)* A local session the owner asked for it brings the stack up and leaves it running until
he has looked. Raising it is the session's, lowering it is the owner's.

## Findings and new backlog items go to the project conversation

A defect noticed in passing is **reported, not filed** — in the thread's reply and, where it bears on
the change, in the pull request. The project conversation, as backlog manager, decides with the owner
whether it becomes an issue and writes it. This keeps one voice on the backlog and stops five threads
filing five versions of the same observation.

A task thread opens no issues, closes none, and merges nothing.

## Worktrees *(local-only)*

A local session works in its own git worktree; the main checkout stays the owner's. Stage only your
own task's paths — the git stash stack is shared across worktrees. The owner removes a worktree when
its session is done. Per-worktree slots ([`platform.md`](platform.md)) exist for the same reason. A
cloud thread has a clone of its own and none of this applies to it.

## Memory is not versioned, and nothing expires it

Agent memory is machine-local, appears in no pull request, and no required check can ever contradict
it. **A fact this repository can carry goes in this repository.** Keep in memory only what the
repository cannot hold — the user's own working preferences, machine-local facts, pointers outside
git — and where an entry does describe this project, make it a pointer to the document rather than a
copy of it. A durable statement carries the command, not the fact the command answers.

**If what you read in the tree contradicts a memory you were given, say so in your report.** You are
the only reader holding both halves. And when you land a change that retires a claim, sweep the
store for it in that same session: you are the one person who knows what it retired.
