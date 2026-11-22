# Agent Collaboration — rationale and history

**Read only when needed**: when you are about to change a rule in
[`collaboration.md`](collaboration.md), or one of them looks wrong. The rules themselves are there;
this file keeps *why* each one exists and what happened before it, moved out of `collaboration.md`
by #2700 so that the file every thread reads stays short.

## The single router

Since 2026-11-22 this repository is worked through a **Claude Code Project** (#2687): every issue is
done by a **cloud thread** that the Project platform starts, runs in its own VM and tracks. What one
thread needs from another goes through the project conversation, the way it used to go through the
owner. The #1985 exception — a backlog manager messaging the backlog-review session — is absorbed:
both roles now live in one conversation.

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
- **Threads still never talk to each other.** Router → thread is the brief at the start and, later,
  a routed event on that thread's own work (the owner, 2026-11-22). It carries a fact and a pull
  request number, never a new brief. No thread waits on another: only *ready* issues are started, and
  a thread that has gone idle is not kept alive for a later message.

### Threads never ask the owner

The old rule "ask before defining domain behaviour" now reads: **the backlog manager asks; threads
do not** (the owner, 2026-11-22). A reasonable reading is fine for a naming or a layout and wrong for
a domain rule, which is why those are settled in the issue before a thread starts.

## Why there are no reviewer threads (#2700)

From #2687 until #2700 (both 2026-11-22) a separate reviewer thread reviewed every pull request and
merged it, and the author thread never merged. **The owner retired it on 2026-11-22 to cut Claude
usage**: a second thread per pull request re-read the same context, issue and diff, and the owner
does not review pull requests either way. The hard guardrails it enforced did not go away: the
author runs them as a checklist, records the result in the pull request, and does not merge when one
is crossed without the owner's recorded decision ([`merge-checklist.md`](merge-checklist.md)).
Before #2700 the reviewer posted a `COMMENT` review starting **Review: passes** or **Review: changes
needed**, because threads act under the owner's GitHub account and GitHub refuses `APPROVE` and
`REQUEST_CHANGES` on one's own pull request.

The same issue set the other usage rules: a thread waits for CI with one call
(`scripts/ci/wait-for-checks.sh`) instead of a model turn per poll; a final reply is at most five
lines; small related issues share a thread; at most three threads run at once.

## Cloud threads

A thread **loads only `CLAUDE.md`, `.claude/CLAUDE.md` and `.claude/rules/`**, so anything every
thread must know is in `AGENTS.md` or reached from it — `CLAUDE.md` points there. **An idle thread
is reclaimed**, which is why only ready issues are started and why an author does not sit watching
its pull request across idle time. The commands in `docs/agents/` are all REST: each read was run in
a cloud thread, and each write is the documented endpoint it names (#2687). Endpoints:
`GET /repos/{owner}/{repo}/issues/{n}`, `…/issues/{n}/comments`, `POST /repos/{owner}/{repo}/pulls`,
`PATCH /repos/{owner}/{repo}/pulls/{n}`, `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`.

## Starting a task

A cloud thread's clone is already on its branch; the `-B` re-cuts it from the `origin/main` just
fetched, which is right while the branch carries no commit of its own.

**Each step alone**: after a pipe `$?` belongs to the filter, so a drill in which both `pnpm` calls
failed reports the same `0` as a clean one and is recorded as done (#1066).

**`pnpm prisma:generate` unconditionally**: a worktree may be hours old, and if `main` has taken a
migration since, `pnpm install` reports *Already up to date*, skips the postinstall, and leaves a
Prisma client that is **stale rather than missing** — it compiles, and its tests pass against a
schema the branch no longer declares (#862).

**Fetch and cut first**: after the cut the worktree *is* `origin/main`; before it, read with
`git show origin/main:<path>` (#1060).

## One session owns its issues

Holding several issues that share a file is the normal answer to file contention. The cost is that a
bundle cannot be undone one issue at a time. A *Done when* is often amended in a comment while the
body keeps its original wording, and an overtaken body looks exactly like a current one — hence
reading both halves every time.

## Branches and pull requests

**Not up to date with `main`** (#1791): its required checks must pass on its own head; being behind
is not a reason to rebase. Parallel issues usually touch different areas, and rebasing every open
pull request after every merge cost most of the day for runs that almost never caught anything
(#854, #880). A **migration** is the one place two independently green changes are likely to
disagree (the schema, the order of migrations), and where a fix after the merge is expensive — so a
pull request carrying one is rebased onto the `main` it is about to merge into, immediately before
the merge.

**Rebase, then re-verify**: the re-run is the half that is easy to drop and the only half that is
interesting — a suite that was green before the rebase was green against a different `main`.

### When `main` turns red

`main`'s run after each merge replaced keeping every branch up to date: the user accepted that two
changes which each passed alone can occasionally break `main` together. No release is tagged from a
red `main` ([`release-versioning.md`](release-versioning.md)).

### Closing keywords

GitHub acts on a closing keyword the moment the change lands and closes the issue before anybody has
verified it. Before #935 `Closing reference check` ran only on a push, so its green could describe a
body that no longer existed. The job reads `closingIssuesReferences`, which is GraphQL-only; a cloud
thread reads the same two halves through REST ([`merge-checklist.md`](merge-checklist.md) § 1).

## Plans

Whether to write a plan is the session's own call rather than a requirement (#875); it is worth it
when a task spans more than one logical area. Under `.claude/plans/` it lives only in that worktree
and goes with it, and nothing is lost, because the durable record is in git.

## Verification, not trust

The two habits in `collaboration.md` have found more real defects here than anything else. A no-op
edit and a non-discriminating test are byte-identical from an exit status, hence the hash.

**Sweeping**: a precise expression run first can exit 1 with no output — a truthful no-match over a
pattern that could never have matched, byte-identical to a clean tree. Prose says *"Add child
stamp"* where the code says `add-child`. **The guards protect the instrument; the remaining failure
is the question**: a search that ran, exited truthfully and answered exactly what it was asked can
still be scoped to one package of a two-package repository — and the conclusion then gets stated
about the whole tree. Where a claim has a command that answers it, run the command — including when
you are correcting an earlier claim of your own.

## Automerge

A dependency is never-alone either because something in this tree states a reason a bump could
invalidate, or because its failure mode is invisible to all five required checks.
`scripts/check-renovate-automerge.mjs` fails when a never-alone dependency or any major would
automerge, with a positive control so it cannot pass by matching nothing; it fails closed on any
matcher, preset or key it does not model — extending it means re-checking it against Renovate
itself, and the script says how.

**The arrangement's whole point is that nobody watches it, so it fails by going quiet.** It was
silently impossible for eight weeks once, asking for `squash` against a repository that only allows
rebase, and no signal anywhere said so. A backlog review sweeps for that
([`backlog-review.md`](backlog-review.md)).

## A broken machine

A workaround multiplies across every session that meets it. But *report and stop* is the wrong answer
to a defect in this repository's own configuration, and at the moment a command exits non-zero the
two look identical. *(Local-only.)* An empty `command -v docker` is a fact about that shell's PATH,
not about the machine. A cloud thread's VM has `docker` on its PATH, but its daemon is started by
the environment's setup script, and a resumed session can find it gone; an absent `docker`, or a
daemon that will not start, is the environment's defect and is reported.

## No browser verification

Verification here is the suites. The harness's reminder to call `preview_start` is emitted by the
harness rather than configured in this repository. Raising a running stack for the owner is the
session's, lowering it is the owner's.

## Findings

Reporting rather than filing keeps one voice on the backlog and stops five threads filing five
versions of the same observation.

## Worktrees and memory

The owner removes a worktree when its session is done; per-worktree slots exist for the same reason
([`platform-slots-and-docker.md`](platform-slots-and-docker.md)). A cloud thread has a clone of its
own and none of this applies to it.

Agent memory is machine-local, appears in no pull request, and no required check can ever contradict
it. Keep in it only the user's own working preferences, machine-local facts and pointers outside git.
A durable statement carries the command, not the fact the command answers. **You are the only reader
holding both halves** of a contradiction between the tree and a memory, and the one person who knows
what your change retired.
