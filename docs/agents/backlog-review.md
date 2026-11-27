# Backlog Review

Backlog review answers one question: **what should be worked on next, and how should it be grouped?**
Since 2026-11-22 it is one of the two roles of the **project conversation**, the single router of
the Claude Code Project — the other is the backlog manager
([`backlog-manager.md`](backlog-manager.md), [`collaboration.md`](collaboration.md) § *One router*).

It used to propose a queue and wait for the owner to start sessions. **Now it starts them** (the
owner, 2026-11-22): one cloud thread per **ready** issue, highest priority first, **without asking
the owner for confirmation**. It writes no code, touches no branch, and never cuts a release.

## Measure, never remember

Every number comes from a command run now:

```bash
R=repos/michalwy/stamporama
gh api --paginate "$R/issues?state=open&per_page=100" \
  --jq '.[] | select(.pull_request | not) | "#\(.number)  [\([.labels[].name] | join(","))]  \(.title)"'
gh api "$R/releases?per_page=5" --jq '.[] | "\(.tag_name)  \(.published_at)"'      # the current version
gh api --paginate "$R/pulls?state=open&per_page=100" \
  --jq '.[] | "#\(.number)  \(.user.login)  \(.head.ref)  \(.title)"'               # what is already in flight
```

`/issues` returns pull requests as well — the `select(.pull_request | not)` is what keeps them out,
and dropping it silently doubles the in-flight work into the backlog. Never infer the backlog from
`git log`, from closed issues, or from a number quoted in an earlier message — issues appear at any
time and a released version is one call away. The threads already running are the Project's own
list; read it there rather than remembering what you started.

## Which issues are ready

**A ready issue has no open *Depends on*.** Read the *Depends on* section of each issue — body and
comments, since a dependency can be added in either
([`collaboration.md`](collaboration.md) § *One session owns its issues*) — and look up every issue it
names:

```bash
gh api $R/issues/<n> --jq .body
gh api --paginate $R/issues/<n>/comments --jq '.[].body'
gh api $R/issues/<dep> --jq '"#\(.number) \(.state) \(.state_reason)"'
```

An issue whose dependency is open is **not started**, however high its priority: an idle cloud
thread is reclaimed, and a thread that starts and then waits for another is the retired lead/worker
model by the back door ([`collaboration-rationale.md`](collaboration-rationale.md) § *This is not the retired
lead/worker model*). An issue with an open question for the owner is not ready either — take the
question to the owner as backlog manager first.

**Not more than one migration in flight.** One thread at a time writes a migration
([`platform-prisma.md`](platform-prisma.md)): an issue whose *Scope* says it adds one is not started while another
such issue has a thread or an open pull request.

## Starting threads

**At most 3 threads at once** (the owner, 2026-11-22, #2700). Count the threads still working in the
Project's own list before starting another; when three are running, the next ready issue waits for
one to finish.

Highest priority first (`priority:high`, then `medium`, then `low`, then unlabelled); **product
first** — process and documentation work fills a gap, it is never what the queue is made of.

**Group by whether one issue has to point at what another is moving** — not by whether they land in
the same file or the same section. Two issues 900 lines apart in one document collide with nothing
and get a thread each. Issues that do share a file go to **one** thread, which holds them all
([`collaboration.md`](collaboration.md) § *One session owns its issues*). **Small, related issues from
the same area are bundled into one thread as well** (the owner, 2026-11-22, #2700) — a thread's
context costs the same whether it carries one small issue or three, so three small `ui-patterns`
fixes are one thread, not three. Each keeps its own `Refs #NNN` and closing comment.

**Pick the model per thread** (the owner, 2026-11-26, #2710): the project conversation chooses when
it starts the thread; the owner never labels issues and may override.

- **Sonnet 5.5** (`claude-sonnet-5-5`) — mechanical or read-only work: backlog listing, fetching
  texts, releases, routine non-major Renovate review, small docs and config edits.
- **Opus 5.5** (`claude-opus-5-5`) — the default for ordinary issues.
- **Fable 5.2** (`claude-fable-5-2`) — large multi-file refactors, risky migrations, hard bugs,
  architecture work, or a retry after Opus failed.

**Every thread is told, and nothing else is its brief:**

- the issue number (or numbers), and its role — task or release;
- its branch, and that it opens one pull request with `Refs #NNN` and never a closing keyword;
- that it **asks the owner nothing**: an undecided point gets the most reasonable reading, recorded
  in the pull request under *Decisions taken without the owner*;
- that `gh issue`, `gh pr`, `gh run` and `gh release` do not work in a cloud thread — use `gh api`
  (REST) or the built-in GitHub tools ([`collaboration.md`](collaboration.md) § *GitHub from a cloud
  thread*);
- that it **never deploys**;
- that a task thread **waits for CI with one call** (`scripts/ci/wait-for-checks.sh <PR>`), runs the
  guardrail checklist, records it in the pull request, **merges its own pull request**, reads
  `main`'s run and closes the issue — or, when a guardrail is crossed without the owner's recorded
  decision, does not merge and reports ([`merge-checklist.md`](merge-checklist.md));
- that its **final reply is at most 5 lines**: the result, the link, a question if there is one.

The issue is the specification; do not restate it in the brief, where it would drift from the
issue.

**There are no reviewer threads** (the owner, 2026-11-22, #2700): the author merges. **After every
merge or closed issue**, measure again and start what became ready.

**Route what a thread reports** (the owner, 2026-11-22):

- **merged**: the author has already closed the issue; measure again and start what became ready.
- **blocked on a guardrail** — the pull request crosses one and its issue records no decision: take
  it to the owner; once he decides, record the decision in the issue and send the thread (or a new
  thread on the same pull request, if it is gone) the pull request number.
- **a red `main`**: tell the owner at once; the fix goes forward in its own issue.
- **an open pull request whose thread is gone**: start a new thread on the same pull request (same
  issue, same branch) to take it over.
- **a question for the owner**: take it to him, one at a time.

## Report to the owner

Short, and in Polish: what was started and why, what is blocked and on what, what merged. The owner
redirects when he wants to; do not ask him which direction to pursue.

## Suggest a release, never cut one

When a coherent batch of shippable commits has accumulated since the last release, say so. **A
release is a deploy** — a published release goes to the owner's live instance — so it is cut only on
the owner's explicit word in the project conversation, by a release thread
([`release-versioning.md`](release-versioning.md)). A suggestion is not that word, and neither is
silence after one.

## Sweep the Renovate pull requests

```bash
gh api --paginate "$R/pulls?state=open&per_page=100" \
  --jq '.[] | select(.user.login == "renovate[bot]") | "#\(.number)  \(.created_at)  \(.head.sha)  \(.title)"'
gh api "$R/commits/<head-sha>/check-runs?per_page=100" --jq '.check_runs[] | "\(.status) \(.conclusion)  \(.name)"'
gh api $R/pulls/<n> --jq '.auto_merge'
gh api -X GET search/issues -f q='repo:michalwy/stamporama is:issue is:open in:title "Dependency Dashboard"' \
  --jq '.items[] | "#\(.number) \(.title)"'
```

Report every open one whose checks are **red**, that is **older than a week**, or that has automerge
armed and has not merged; then open the Dependency Dashboard issue and report anything rate-limited
behind `prConcurrentLimit`. `auto_merge` is non-null once
GitHub's auto-merge is armed, which Renovate does through its `platformAutomerge` default. A check
listed twice is two runs — a cancelled one and its re-run is common — so read the latest.

This exists because automerge is an arrangement whose whole point is that nobody watches it, so it
fails by going quiet rather than by going wrong. For most of one period `renovate.json` asked
Renovate to merge by squash, which this repository does not allow: automerge was impossible
throughout and no signal anywhere said so — five stale pull requests, one red for eight weeks, and
thirteen further updates rate-limited behind them, visible only on a dashboard nobody was reading.
**A quiet week is not evidence that this works**: a batch that merged and a batch that was never
opened look identical from outside, so check that the weekly batch actually appeared and say so if
none has in a fortnight.

**Every Monday after the Renovate window** (after 06:00 Europe/Warsaw) start one **dependency
review** thread for the Renovate pull requests still open (the owner, 2026-11-23, #2706): it reads
the changelogs, merges what is neither major nor risky, and reports the majors and risky ones (auth,
marketplaces, cloud storage) for you to take to the owner →
[`dependency-review.md`](dependency-review.md). It counts toward the three-thread limit. Do not
merge, close or rebase a Renovate pull request yourself, and do not edit `renovate.json` as part of
a review.
