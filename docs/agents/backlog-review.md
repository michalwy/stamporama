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
([`collaboration.md`](collaboration.md) § *One session owns one issue*) — and look up every issue it
names:

```bash
gh api $R/issues/<n> --jq .body
gh api --paginate $R/issues/<n>/comments --jq '.[].body'
gh api $R/issues/<dep> --jq '"#\(.number) \(.state) \(.state_reason)"'
```

An issue whose dependency is open is **not started**, however high its priority: an idle cloud
thread is reclaimed, and a thread that starts and then waits for another is the retired lead/worker
model by the back door ([`collaboration.md`](collaboration.md) § *This is not the retired
lead/worker model*). An issue with an open question for the owner is not ready either — take the
question to the owner as backlog manager first.

**Not more than one migration in flight.** One thread at a time writes a migration
([`platform.md`](platform.md)): an issue whose *Scope* says it adds one is not started while another
such issue has a thread or an open pull request.

## Starting threads

Highest priority first (`priority:high`, then `medium`, then `low`, then unlabelled); **product
first** — process and documentation work fills a gap, it is never what the queue is made of.

**Group by whether one issue has to point at what another is moving** — not by whether they land in
the same file or the same section. Two issues 900 lines apart in one document collide with nothing
and get a thread each. Issues that do share a file go to **one** thread, which holds them all
([`collaboration.md`](collaboration.md) § *One session owns one issue*).

**Every thread is told, and nothing else is its brief:**

- the issue number (or numbers), and its role — task, reviewer or release;
- its branch, and that it opens one pull request with `Refs #NNN` and never a closing keyword;
- that it **asks the owner nothing**: an undecided point gets the most reasonable reading, recorded
  in the pull request under *Decisions taken without the owner*;
- that `gh issue`, `gh pr`, `gh run` and `gh release` do not work in a cloud thread — use `gh api`
  (REST) or the built-in GitHub tools ([`collaboration.md`](collaboration.md) § *GitHub from a cloud
  thread*);
- that it **never deploys**, and a task thread never merges.

The issue is the specification; do not restate it in the brief, where it would drift from the
issue.

**For every pull request a task thread opens, start a reviewer thread** for it
([`reviewer.md`](reviewer.md)). **After every merge or closed issue**, measure again and start what
became ready.

**After a merge, check that its issue was closed.** The author thread closes it
([`collaboration.md`](collaboration.md) § *One session owns one issue*), and readiness waits on that
close — so an author thread that was reclaimed, or never woken by the merge, would leave every
dependent issue blocked with nothing reporting it. If the issue the pull request refers to is still
open once `main`'s run for the merge is green, tell the author thread to close it; if that thread is
gone, close it yourself with a short comment linking the pull request and its `main` run:

```bash
gh api $R/issues/<n> --jq '"#\(.number) \(.state)"'
gh api -X POST $R/issues/<n>/comments -f body="$(cat closing.md)"
gh api -X PATCH $R/issues/<n> -f state=closed -f state_reason=completed
```

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

Report what you find and stop there — **Renovate stays as it is** (the owner, 2026-11-22): do not
merge, close or rebase a Renovate pull request, start no reviewer thread for one, and do not edit
`renovate.json` as part of a review.
