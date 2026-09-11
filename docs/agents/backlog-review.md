# Backlog Review

A backlog-review session answers one question: **what should the next session or two take, and how
should it be grouped?** It proposes and changes nothing — no issues written, no issues closed, no
release cut, no branch touched.

## Measure, never remember

Every number in the proposal comes from a command run in this session:

```bash
gh issue list --state open --limit 300           # the full picture, not recent activity
gh release list                                  # the current version
gh pr list --state open                          # what is already in flight
```

Never infer the backlog from `git log`, from closed issues, or from a number quoted in an earlier
message — issues appear at any time and a released version is one command away.

## The proposal

Two sections, in Polish, as the user reads them:

- **Najbliższe** — the next 2–3 sessions. Three columns: `Sesja`, `Temat` (short theme label), `Opis`
  (issue links and a sentence each, `<br>`-separated when a session holds several), and `Dlaczego?`
  (one sentence of rationale).
- **Dalsze** — beyond that. Three columns: `Track`, `Opis`, `Dlaczego?` — track-level only, no
  per-session breakdown.

**Product first.** Process and documentation work is what fills a gap while something is waiting on
the user; it is never what the queue is made of.

**Check dependencies before ordering.** Read the *Depends on* section of each issue body (`gh issue
view <n> --json body,comments`) and never schedule an issue ahead of an open dependency.

**Group by whether one issue has to point at what another is moving** — not by whether they land in
the same file or the same section. Two issues 900 lines apart in one document collide with nothing
and do not need to share a session. An issue that needs the pointer says so in its own *Done when*,
so the question is answerable from the bodies alone.

**Do not ask which direction to pursue.** Present the plan and let the user redirect.

## Suggest a release, never cut one

When a coherent batch of shippable commits has accumulated since the last tag, say so. Preparing,
tagging and publishing is a release-manager session's work — see
[`release-versioning.md`](release-versioning.md).

## Sweep the Renovate pull requests

```bash
gh pr list --author app/renovate --state open --json number,title,createdAt,statusCheckRollup
```

Report every open one whose checks are **red**, that is **older than a week**, or that has automerge
armed and has not merged; then open the Dependency Dashboard issue and report anything rate-limited
behind `prConcurrentLimit`.

This exists because automerge is an arrangement whose whole point is that nobody watches it, so it
fails by going quiet rather than by going wrong. For most of one period `renovate.json` asked
Renovate to merge by squash, which this repository does not allow: automerge was impossible
throughout and no signal anywhere said so — five stale pull requests, one red for eight weeks, and
thirteen further updates rate-limited behind them, visible only on a dashboard nobody was reading.
**A quiet week is not evidence that this works**: a batch that merged and a batch that was never
opened look identical from outside, so check that the weekly batch actually appeared and say so if
none has in a fortnight.

Report what you find and stop there — do not merge, close or rebase a Renovate pull request, and do
not edit `renovate.json` as part of a review.
