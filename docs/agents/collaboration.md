# Agent Collaboration

How work is split between sessions: what one session owns, what the long-lived **lead** session
owns, and how a question, a commit and a closed issue travel between them.

The model is adapted from the sibling project `michalwy/darkroom`, which wrote it down first. What
follows is this project's version of it, and it differs where this project differs — over seven
hundred issues filed against darkroom's thirty, design tracks spanning eight issues at a time,
several releases in a day, and a browser rule that is the exact opposite of darkroom's (see
*Verification is not a browser*, below).

## One session owns one issue, end to end

One session takes one issue from the first decision to the last test: it decides the shape, writes
the migration, writes the code, writes the tests, updates the topic file and the user guide, and
commits. Nothing is handed to a second agent halfway through.

This has always been what happens here; it had simply never been written down. `.claude/plans/`
holds **261 plans and every one of them is single-session** — AGENTS.md says so in as many words
("A plan is executed fully within a single session"), and not one plan hands a step to another
agent. This file is the first place the rest of the arrangement is stated.

**Splitting one issue between agents needs a reason beyond size**, and there is no standing cast of
roles to draw one from. AGENTS.md used to describe four — Architect, Designer, Developer,
Tester/Reviewer, powered up in sequence — and across 261 plans they were used **zero** times; the
only occurrences of the string in the whole plan corpus are the word *architecture*. They were
removed in #780. Two agents on one surface produce two half-designs, and neither has read the
other's reasoning. The albums track is the argument in the positive direction: the session that
built #767 caught two confidently-worded errors in the issue text by counting things in the
sources, which is only possible when the same head holds the geometry, the schema and the render
(`albums.md`).

## The two kinds of session

**The lead session** is long-lived. It reviews the backlog, decides what is worked next, writes the
prompt for each piece of work, spawns the task session, answers its questions, verifies what came
back, collects the user's go-ahead, merges the pull request and closes the issue. It holds the
state no single task ever sees — the whole backlog, the `Depends on` notes between issues, which
design track an issue belongs to, what is in flight elsewhere — and it writes little or no code.

**A task session** is short-lived and owns exactly one issue. It works in its own worktree on its
own branch, asks the lead when it is blocked, commits its own work, pushes the branch, opens the
pull request, and **reports back** when it is done. It does not merge, does not close issues, and
does not file new ones.

The user talks to the lead. That is much of the point of the split: the user should not have to
track which of four sessions is asking, or repeat one decision to each of them. The design session
below is the deliberate exception.

## The loop

1. A backlog review produces an order (`backlog-review.md`).
2. The lead spawns a task session with a **self-contained prompt**: the issue, the branch, what is
   out of scope, which files a session running in parallel is touching, and **how to reach the
   lead**.
3. The session works, and asks the lead whenever it is blocked.
4. The session commits on its branch, rebases onto `main`, pushes, opens a pull request and
   **reports back**: what landed, on which branch, which pull request, what was verified and how,
   what was left out and why, and anything it noticed outside its scope.
5. The lead **verifies the work in the repository**, and collects the user's go-ahead.
6. The lead merges the pull request and closes the issue.

**The prompt carries the lead's return address**, because a session cannot infer one — not the
session id, not the tool that reaches it. Nothing earlier in a session says who spawned it. #780
itself ran without one: the prompt told the session to report to the lead and gave it no way to ask
anything mid-flight, so every question had to be either answered from the documentation or deferred
to the final report. That is a survivable failure for a documentation issue and an expensive one
for a migration. The requirement belongs in this file; the id and the tool are per-round values and
belong in the prompt.

**Everything travelling around this loop is written in English** — the prompt and the report alike,
like every commit, issue and document in the repository (AGENTS.md). The chat with the user is
whatever language the user is writing in; this channel has no user in it.

## What the lead may answer, and what it escalates

**The lead answers only what is already written down, and names the source.** The sources here are
AGENTS.md, a `docs/agents/` topic file, an ADR under `docs/decisions/`, and the body of a resolved
design issue — #755 for albums, #744 for multi-stamp copies, #71 for stamp attributes. Naming the
source is part of the answer: it lets the task session read the reasoning around it, and it makes a
wrong answer traceable instead of absorbed.

**Everything else goes to the user.** AGENTS.md opens by forbidding an implementer from settling a
product question by picking a reading; a lead settling it one level up is the same failure with
more authority behind it and less visibility.

## Questions are asynchronous

A lead acts only while it is awake, and it may itself be waiting on the user. A task session that
asks a question is not calling a service that answers within the minute.

So **ask, then carry on with everything the question does not block.** If it blocks everything,
stop and say what you are waiting for. An idle session that has stated its question is cheap to
recover; a session that guessed is not, because the guess is found only after the code has been
written around it.

## Verification, not trust

**The lead checks the repository, not the report**: the log, the diff, the migration, the issue's
own *Done when*, and CI. A report is evidence of what a session believes it did, and the reports
worth checking read exactly like the ones that are right. A verification performed only when
something feels wrong is not a verification.

Closing the issue is deliberately done by somebody who did not write the code: the author is the
worst available reader of their own *Done when*.

## Branches, pull requests and the merge

`main` is protected by a ruleset with **no bypass for anyone**, the user included. A direct
`git push origin main` is rejected — this was tried, not assumed:

- a **pull request is required** (0 approvals) and must be **up to date with `main`** before it may
  merge;
- **rebase merge is the only method** the repository offers, and `main` requires **linear history**;
- **force-push and deletion are blocked**;
- four checks are required, and they are exactly **`Static checks`**, **`Unit tests`**,
  **`Integration tests`** and **`Extension checks`**.

What follows from that:

- **Each task session works on `task/<issue>-<slug>`** — `task/780-collaboration-model` — branched
  from `main`.
- **The task session commits its own work as it goes**, small focused Conventional Commits
  referencing the issue, and pushes them (AGENTS.md: a commit you were asked to make is pushed in
  the same breath — for a task session, to its own branch).
- **It opens the pull request itself**, as soon as there is something worth showing, without
  waiting for anybody. Nothing it pushes can reach `main`, and a branch that is dropped is deleted
  and leaves no trace. What the push buys is visibility — to the lead, and to CI, which is the only
  place the four required checks actually run.
- **A branch behind `main` is rebased and then re-verified, in that order**: fetch, rebase onto
  `main`, **run the checks again**, force-push the branch. The re-run is the half that is easy to
  drop and the only half that is interesting — a suite that was green before the rebase was green
  against a *different* `main`, which is not the claim anyone needs. With several sessions
  running, `main` moving under a branch is the normal case, and GitHub now enforces the up-to-date
  half; it cannot enforce the re-run.
- **Nobody merges without the user's yes, and the lead is who asks for it.** The merge is the step
  that changes `main`, and with it what the next branch is cut from and what the next release tags.
- **With the go-ahead in, auto-merge is the normal path**: `gh pr merge --rebase --auto`. GitHub
  merges the moment the checks are green and the branch is up to date, instead of somebody watching
  a run for several minutes. The user's decision still gates it; only the waiting moves off a human.
- **No merge commits, anywhere.** The platform now enforces what was previously a habit. The reason
  is what happens to a rejected change: in a linear sequence it drops out and whatever sat above it
  rebases down over the gap, while a merged branch has to be reverted, leaving both the change and
  its undoing in `main` permanently.
- **A `(#769)` in a commit title is an issue number, not a pull request.** Every such reference in
  this repository's history is one, and rebase-merging does not append a pull request number, so it
  stays that way. Keep writing the issue.

## What may run in parallel

Task sessions run in parallel, each in **its own git worktree** under `.claude/worktrees/`. This is
no longer the exceptional arrangement AGENTS.md once described; it is how a task session runs. Each
worktree gets its own ports, database and compose project — **`platform.md` owns that mechanism**,
and nothing about it is restated here.

**One schema-touching session at a time**, regardless. Migrations are timestamped files whose
ordering can only be checked once both are in one tree, so two written in parallel each pass on
their own branch and can still fail together — and by then the fix is a third migration rather than
an edit, because **a written migration is never edited** (`platform.md`). Anything without a
migration parallelises freely.

**Merges serialise, and that is the trade.** When two branches are ready at once the second rebases
onto the first and re-runs its checks. At two or three parallel branches the cost is one extra CI
run.

## Verification is not a browser

**A session does not start a dev server and does not drive a browser unless the user explicitly
asks.** The user runs the app through Docker Compose and looks at it there.

This is recorded here because it is a **deliberate departure** from the darkroom model, which
requires the opposite — a session there is obliged to exercise its work in a browser before handing
it back. Do not "fix" this one to match. A session's evidence here is `pnpm lint`, `pnpm typecheck`,
`pnpm test:unit`, `pnpm test:integration` and the four checks on the pull request; AGENTS.md's
standing instruction *do not leave dev servers running* is the same rule seen from the other end.

## Findings go to the lead, not into new issues

A task session that notices something outside its scope — a stale document, a rule contradicting
another, a missing index, a bug next door — **reports it to the lead and carries on**. It does not
open an issue, and it does not fix it.

The lead decides whether it becomes an issue. A task session sees one corner of a backlog with
roughly forty issues open across design tracks eight issues wide; five sessions each filing what
they happened to notice produce five overlapping issues nobody reconciles, and the backlog grows
sideways faster than it is worked through. This is the same reasoning that already requires
searching for duplicates before filing, and splitting independent scopes into separate issues.

## New backlog items come through the lead

Writing an issue in this project *is* placing it in the backlog: it means a Conventional Commit
title, the `backlog` label plus type and priority, checking whether an open issue already covers
it, and stating what it depends on. All of that needs the whole backlog in view, which is the one
thing a task session does not have.

**Drafting can be delegated; the triage never is.** A session may be asked to write out the
children of a design track — the lead reconciles them against everything else open, and walks the
`Depends on` notes, before any of them is filed.

## Design sessions

A large new feature is discussed in **its own session**, not in the lead's. A design dialogue runs
long and would consume exactly the context the lead exists to hold, and it is the second place the
user talks to somebody other than the lead — a product conversation cannot go through a proxy,
because the valuable part is the follow-up question neither side knew to ask.

This shape already exists here and had no name. Its output is visible in the repository:

- the **resolved parent issue** — #755 (albums), #756 (bulk-lot builder), #744 (multi-stamp
  copies), #71 (stamp attributes) — carrying `## Resolution`, `## The design`, `## Deliberately not
  decided here` and `## Children`;
- an **ADR** where a pattern or a model is settled (ADR-0044, ADR-0045, ADR-0047);
- a **proposed set of child issues**, each repeating what binds it under
  `## Decisions (from design discussion, <date>)` — the marker that says a body is downstream of a
  design session rather than written from scratch.

That output returns to the lead, who reconciles the proposals against the rest of the backlog
before any of them becomes backlog.

## Release sessions

Cutting a release is its own kind of session and fits neither shape above: it has no issue, writes
no feature code, and what it produces is a version bump, a tag, a GitHub Release and a published
image. **`release-versioning.md` owns the procedure**, end to end; none of it is restated here.

It stays separate rather than becoming the tail of the task session that wrote the last feature,
because a release session is required to change nothing else, so that its transcript reads
afterwards as the record of one release. A session that has been editing files all day cannot offer
that. The same file draws the boundary in the other direction too: a backlog review only *suggests*
a release and never prepares one — and the lead is normally the session that boundary applies to.

What carries over from this model is the traffic around it: the lead spawns the session and
verifies the outcome, and the user's go-ahead is required.

## Long-lived or fresh

**A session is long-lived when its value is context that cannot be written down. It is fresh when
its value is following a procedure that is.**

The lead is the one long-lived session, because what it holds — the backlog, the dependencies, what
is in flight, what the user has already been asked — cannot be re-derived cheaply from any file.
Everything else is spawned fresh: a task session's knowledge is in its issue and its topic file, a
design session's in the issue it resolves, a release session's in `release-versioning.md` plus the
live state of the repository.

Releases are where this is easiest to get wrong, because at several releases a day, keeping one
release session alive and messaging it looks like an obvious saving. `release-versioning.md` opens
by forbidding exactly what such a session would accumulate — run `gh release list` fresh, never
assume the last version from memory or from local tags — and the procedure itself changes between
releases. The corollary is what makes this safe: **what is genuinely learned between releases
belongs in the document, not in a session's memory.**

## Worktree cleanup, in three layers

1. **A merged branch deletes itself** on GitHub (`delete_branch_on_merge` is on), and **the lead
   removes the worktree** — with the local branch, and the remote one too if the work was dropped
   rather than merged.
2. **Slot allocation reclaims the numbers** of worktrees that no longer exist (`platform.md`).
3. **Every backlog review sweeps** — `git worktree list`, then `git worktree prune`, and remove what
   is stale (`backlog-review.md`).

The middle and last layers are what make forgetting the first one harmless. Without them a worktree
nobody removed holds a port and a database permanently, and the cost surfaces weeks later in an
unrelated session as a failure with no visible cause. Two orphaned worktrees from 27 August were
found by hand while this file was being written, which is the manual step the sweep exists to
replace.

## Keeping this file honest

Every backlog review checks whether the model above still describes what actually happens, and
**reports what it finds rather than quietly fixing it** (`backlog-review.md`). The questions:

- Did a task session stall waiting on the lead, and for how long?
- Did the lead answer something that was not written down anywhere?
- Did anything reach `main` without the user's explicit go-ahead?
- Did a task session open an issue, close one, or merge a pull request?
- Are there worktrees or `task/` branches left over from work that has already landed?

Each is one of the rules above failing in a way that looks like nothing at the time. A lead
answering from its own judgement is indistinguishable from a lead answering from the documentation,
right up until somebody asks where the answer came from.
