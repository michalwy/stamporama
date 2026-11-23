# Dependency review — the Monday Renovate thread

**Renovate runs once a week and a thread reviews what it leaves for a person** (the owner,
2026-11-23, #2706). Before that decision Renovate pull requests got no thread, and the ones held
for a person — majors, never-alone groups — sat open for weeks with nobody reading them.

## The schedule

`renovate.json` sets `"schedule": ["before 6am on monday"]`, `"timezone": "Europe/Warsaw"` and
`"updateNotScheduled": false`: Renovate opens **and rebases** its pull requests only in that window,
and no package rule carries a schedule of its own, so every group — the weekly automerge batch and
every never-alone group — arrives on Monday morning together. `scripts/check-renovate-automerge.mjs`
models the three keys as inert: they decide *when* Renovate acts, never *whether* something
automerges. Renovate's built-in `vulnerabilityAlerts` defaults carry an empty schedule of their
own, so a security fix may still open outside the window; that is Renovate's default, not a rule here.

## Who starts it

**The project conversation starts one "dependency review" thread every Monday after the Renovate
window** (after 06:00 Europe/Warsaw), without asking the owner, when any Renovate pull request is
open and not automerged. It counts toward the three-thread limit. The thread's brief is this file
plus the list of open Renovate pull requests ([`backlog-review.md`](backlog-review.md) § *Sweep the
Renovate pull requests*).

## What the thread does, per pull request

1. **Classify it.** Read the title, the branch (`renovate/major-*` is a major) and the diff.
   - **Major** — any `major` update, whatever group.
   - **Risky** — authentication (`better-auth`), cloud storage (`@google-cloud/storage`), and
     anything that touches what is sent to or published on a marketplace or external service
     (Allegro, Delcampe, Facebook, Colnect) — the extension's and integrations' clients included.
   - **Everything else** — patch and minor of a never-alone group (framework, TanStack, Prisma,
     Postgres image, PDF, icons, Markdown, image processing, Node and pnpm toolchain) or a batch
     that did not automerge.
2. **Read the changelog** of every package in it, for every version between the old and the new one
   — Renovate's pull request body links the release notes; follow them to the source when it only
   summarises. Check the reason the group is never-alone (its `description` in `renovate.json`)
   against what changed: that reason is what the required checks cannot see.
3. **Wait for CI** with one call, `scripts/ci/wait-for-checks.sh <PR>`. A pull request that is red,
   or conflicts with `main`, is not merged; ask Renovate to rebase it by ticking the box in its body
   only if a stale base is the whole cause, otherwise report it.
4. **Merge or escalate:**
   - **Major or risky: never merged by the thread.** It goes into the one report to the owner with a
     one-line recommendation (merge, wait, or what has to change first).
   - **Everything else: the thread merges it** (the owner, 2026-11-23, #2706) when CI is green, the
     changelog shows nothing that touches the group's never-alone reason, and the guardrail checklist
     ([`merge-checklist.md`](merge-checklist.md) § 2) is clear. Because a Renovate pull request's
     body is rewritten by Renovate, the checklist and a short changelog note are **recorded as a
     comment on the pull request**, not in its body. Then rebase-merge with the green `sha`
     (§ 4) and read `main`'s run (§ 5). A changelog that does touch the reason is escalated instead.
5. **No issue to close.** Renovate pull requests carry no `Refs #NNN`; the thread's report is the
   record.

## The report

One reply to the project conversation, **at most 5 lines**: how many merged, and the majors and
risky ones, each with a one-line recommendation. The project conversation takes it to the owner, in
Polish. Once the owner decides on one, that decision is recorded in an issue and the next Monday's
thread (or a thread started for it) merges it.

## What this does not change

- The weekly automerge batch still merges without anyone, once the five required checks pass.
- The never-alone list and the every-major rule in `renovate.json` stay as they are; this procedure
  decides who reads what they hold back, not what they hold back.
- A thread never edits `renovate.json` as part of a review; a change to it is its own issue.
