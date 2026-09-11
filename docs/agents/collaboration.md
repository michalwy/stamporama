# Agent Collaboration

How work is split between sessions here, and how a change reaches `main`.

## The user routes everything

The user decides what each session works on and hands it the issue or issues himself. **Sessions do
not talk to each other**, and none of them directs another. A session that needs something from
another session says so in its report and the user carries it.

This is deliberate. A lead/worker model — one long-lived session briefing the others by message —
ran from 2026-09-06 to 2026-09-11 and was retired: the traffic between sessions cost more than it
produced, and most of the issues it generated were about itself rather than about the product.

**Product first.** Process work is filler for the gaps, never the queue.

## The kinds of session

| Session | What it does |
| --- | --- |
| **Task** | Holds one issue, or several that share a file, end to end. Most sessions are this. |
| **Backlog review** | Reads the backlog and proposes what to take next and how to group it. Proposes only — it changes nothing. → [`backlog-review.md`](backlog-review.md) |
| **Backlog manager** | Turns the user's ideas, remarks and bug reports into issues. Writes no code. → [`backlog-manager.md`](backlog-manager.md) |
| **Release manager** | Cuts a release: a tag, a Release and a published image. No issue, no branch, no commit. → [`release-versioning.md`](release-versioning.md) |

## One session owns one issue, end to end

It decides, migrates, implements, tests, opens the pull request and follows it to merge. Nothing is
handed to a second session halfway through.

A session may hold **several** issues when they share a file — that is the normal answer to file
contention. Each keeps its own `Refs #NNN`, its own verification against its own *Done when*, and
its own closing comment. The cost is that a bundle cannot be undone one issue at a time.

**The specification is the issue body plus its comments, and the two diverge silently.** A *Done
when* is often amended in a comment while the body keeps its original wording, and an overtaken body
looks exactly like a current one. Read both in one call:

```bash
gh issue view <n> --json body,comments
```

## Branches and pull requests

`main` is protected with no bypass for anyone, the user included: a pull request is the only way in,
rebase merge only, linear history, force-push and deletion blocked, and five required checks
(`Static checks`, `Unit tests`, `Integration tests`, `Extension checks`, `Closing reference check`).
The ruleset itself is checked in — see
[`.github/rulesets/README.md`](../../.github/rulesets/README.md).

Work happens on `task/<issue>-<slug>`, branched from `main`. **The session that opens the pull
request owns it to the end**: it keeps the branch up to date, re-runs the checks after every rebase,
and merges it — on the user's say-so and never before.

**Rebase, then re-verify, in that order.** Fetch, rebase onto `main`, run the checks again, force-push
with `--force-with-lease` — never bare `--force`. The re-run is the half that is easy to drop
and the only half that is interesting: a suite that was green before the rebase was green against a
different `main`. Add `pnpm install` between the rebase and the suites when the rebase pulled in a
lockfile change.

**Never a closing keyword** (`Closes`, `Fixes`, `Resolves`) in a commit message or a pull request
body — GitHub acts on it the moment the change lands and closes the issue before anybody has
verified it. Use `Refs #NNN`. The `Closing reference check` job in CI enforces this over both the
body and the commit messages; `gh pr view <n> --json closingIssuesReferences` sees the body only.

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

**The arrangement's whole point is that nobody watches it, so it fails by going quiet.** It was
silently impossible for eight weeks once, asking for `squash` against a repository that only allows
rebase, and no signal anywhere said so. A backlog review sweeps for that
([`backlog-review.md`](backlog-review.md)); do not widen the boundary without the user.

## If the machine is broken, report it and stop

A broken `pnpm` or `docker` is not something to work around: a workaround multiplies across every
session that meets it. But *report and stop* is the wrong answer to a defect in this repository's
own configuration, and at the moment a command exits non-zero the two look identical. Tell them
apart before reporting: run the same command on a **known-good input** (an untouched file, `main`
itself), and check that the relevant CI job actually **ran** rather than reporting green while
skipped. Say in the report how you told them apart.

`docker` lives at `~/.orbstack/bin` on this machine and an empty `command -v docker` is a fact about
this shell's PATH, not about the machine: `PATH="$HOME/.orbstack/bin:$PATH" pnpm test:integration`.

## No browser verification — a deliberate departure

**A session does not start a dev server and does not drive a browser** unless the user explicitly
asks. Verification here is the suites. Your tooling will tell you that no preview server is running
and to call `preview_start`; that reminder is emitted by the harness rather than configured in this
repository, and it is overridden deliberately rather than followed.

**When a change is one a person looks at**, the session that made it brings the stack up for the
user and leaves it running until he has looked. Raising it is the session's, lowering it is the
user's. The user drives every session himself, so nothing else is contending for the stack.

## Findings and new backlog items go to the user

A defect noticed in passing is **reported, not filed**. The user decides whether it becomes an
issue; a backlog-manager session writes it if it does. This keeps one voice on the backlog and stops
five sessions filing five versions of the same observation.

A task session does not open issues, close issues, or merge anything it was not asked to merge.

## Worktrees

Each session works in its own git worktree; the main checkout stays the user's. Stage only your own
task's paths — the git stash stack is shared across worktrees. The user removes a worktree when its
session is done.

## Memory is not versioned, and nothing expires it

Agent memory is machine-local, appears in no pull request, and no required check can ever contradict
it. **A fact this repository can carry goes in this repository.** Keep in memory only what the
repository cannot hold — the user's own working preferences, machine-local facts, pointers outside
git — and where an entry does describe this project, make it a pointer to the document rather than a
copy of it. A durable statement carries the command, not the fact the command answers.

**If what you read in the tree contradicts a memory you were given, say so in your report.** You are
the only reader holding both halves. And when you land a change that retires a claim, sweep the
store for it in that same session: you are the one person who knows what it retired.
