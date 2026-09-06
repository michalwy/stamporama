# Agent Collaboration

How work is split between sessions: what one session owns, what the long-lived **lead session**
owns, and how a question, a branch and a closed issue travel between them. The model was adapted
from the sibling project `michalwy/darkroom`, but the shape it takes here is set by three facts that
project does not share: **717 issues filed to date**, design tracks that run to nine issues at a
time, and several releases a day.

Most of this file describes what already happens and had simply never been written down. The parts
that are genuinely new arrived on **2026-09-06**, when `main` was protected — read *A protected
`main`, and what it changed* below before believing anything you remember about pushing here.

## One session owns one issue, end to end

One session takes an issue from the first decision to the last test: it reads the design, writes
the migration by hand, writes the code, updates `docs/user-guide/` and the topic file, runs the
suites, commits, and opens the pull request. Nothing is handed to a second agent halfway through.

**This is not a new rule; it is the only thing that has ever happened here.** `.claude/plans/` holds
**261 implementation plans** and every one of them is a single session's, start to finish. Not one
hands a step to another agent.

AGENTS.md used to describe four roles — Architect, Designer, Developer, Tester/Reviewer — powered
up in sequence for anything crossing a domain, data or authorization boundary. In 261 plans they
were **never used once**. They are gone, and this file replaces them.

**Splitting one issue between agents needs a reason beyond size.** The reason it has never been
worth it here is the invariant list in AGENTS.md: a feature in this project is a hand-written
migration, the Prisma types it generates, a server component that must not import a client value,
a dialog built from `dialog-shell.tsx`, an icon added to `icons.tsx`, and a token that needs a value
in both `:root` and `.dark`. Those are not four specialists' tasks; they are one decision seen from
six angles. Two agents on the same surface produce two half-designs, and neither has read the
other's reasoning.

## The two kinds of session

**The lead session** is long-lived. It holds the backlog, decides what is worked on next, writes
the prompt for each piece of work, spawns the task session, answers its questions, verifies what
came back **in the repository**, collects the user's go-ahead, merges the pull request and closes
the issue. It writes little or no code.

What it holds is the state no single task ever sees: forty-odd open issues, the `## Depends on`
edges between them, which design track an issue belongs to, and what is in flight in another
worktree right now. None of that is cheaply re-derivable from a file.

**A task session** is short-lived and owns exactly one issue. It works in its own worktree on its
own branch, asks the lead when it is blocked, commits as it goes, pushes the branch, opens the
pull request, and **reports back**. It does not merge, does not close issues, and does not file new
ones.

**The user talks to the lead.** That is much of the point of the split: the user should not have to
track which of three sessions is asking, or repeat the same decision to each of them. The design
session below is the one deliberate exception.

## How a task session is actually spawned

Getting this wrong once cost a session's worth of work, so it is stated plainly.

- **A task session is a separate session, not a subagent.** The lead spawns it as a task tile. It
  gets its own worktree under `.claude/worktrees/` and its own transcript, and it **outlives the
  lead's turn** — the lead is not blocked waiting for it, and it does not return a value into the
  lead's context.
- **The worktree comes with the session; the `task/` branch does not.** The spawn puts the session
  in a fresh worktree on a throwaway branch. The first thing the session does is
  `git fetch origin main` and cut `task/<issue>-<slug>` from `origin/main`.
- **The channel is two-way, and the lead is reachable mid-flight.** Sessions address each other by
  session id: the task session can ask a question, and the lead can send a correction or an answer
  while the work is still running. "The lead cannot be reached once the session has started" is
  false; do not write it down again.
- **The prompt must carry the lead's session id**, because a session cannot infer who spawned it.
  Nothing in a fresh session's context says where it came from. The id is a per-round value and
  belongs in the prompt, not in this file.
- **One real cost: spawning goes through a tile the user clicks.** The user is therefore in the loop
  at the start of every task session, whether or not they wanted to be. That is the price of the
  model as it stands, and it is worth knowing before anybody proposes spawning six sessions at once.

**Everything travelling around this loop is written in English** — the prompt, the questions and the
report alike, whatever language the user and the lead are speaking. AGENTS.md requires English of
everything that lands in GitHub or the repository; these messages land in neither, but the work they
produce does, and a report written in one language and a commit message in another is a translation
step nobody asked for.

## The loop

1. A backlog review produces an order (`backlog-review.md`).
2. The lead spawns a task session with a **self-contained prompt**: the issue, the branch name, what
   is out of scope, which files a parallel session is holding, the decisions the user has already
   made, and **how to reach the lead**.
3. The session works, and asks the lead whenever it is blocked.
4. The session commits on its branch, rebases onto `main`, re-runs the checks, pushes, and opens a
   pull request.
5. The session **reports back to the lead**: what landed, on which branch, which pull request, what
   was verified and how, what was left out and why, and anything it noticed outside its scope.
6. The lead **verifies the work in the repository** and collects the user's go-ahead.
7. The lead merges the pull request and closes the issue.

**The report is part of the work, not a closing courtesy.** A session that finishes silently has not
finished: its branch then waits until somebody happens to look, and the lead's whole job is to be
the one who does not have to.

### A prompt carries its reasons, not only its instructions

**Five sessions in one day came back having refuted something in the brief they were given, and all
five were right.**

- **#785** was told the trap was the reference line. It is not: the closing keyword counts in ordinary
  prose too, and #787 armed a closing reference twice while explaining that very mistake.
- **#793** found that the test case the brief specified could not distinguish the two readings it was
  written to settle — a 26 mm stamp with 8 mm of clearance needs 34, and the 30 mm packet is exactly
  34, so both readings agree there — and wrote the case that does separate them.
- **#814** found that the lead's own spelling would have automerged the dependency the list exists to
  protect: `matchPackageNames` misses the CI Node pin, whose `depName` is `node` but whose
  `packageName` is `actions/node-versions`.
- **#815** found a better precedent than the three the lead pointed at — the lot builder's spelling of
  a viewport-height workbench — and a second bug beside the one it was sent to fix (#820).
- **#816** found that the carried ref could go stale and stay stale, and fixed a latent `splice(-1)`
  in three places that nobody had asked about.

The conclusion is not that sessions are clever. It is that **a reason can be refuted and an
instruction can only be obeyed.** In every one of those five the session had what it needed to see
the mistake, and what let it act was knowing what the instruction was *for*.

So the self-contained prompt of step 2 carries the reasoning with the constraint: which precedent was
chosen and why, what a specified test case is meant to separate, what a rule is protecting against.
And it says which parts are the **lead's reading** rather than the user's decision — that is the
sentence a session can answer, and #793 and #814 are both answers to it.

### `Refs #NNN`, never a closing keyword

A pull request references its issue as **`Refs #NNN`** — never `Closes`, `Fixes`, `Resolves` or any
of their variants, in the body or in a commit message that will land on `main`. A closing keyword
hands the close to GitHub at merge time, which is exactly the human step 7 above puts *after*
verification.

This is the one rule here the platform works against, so it needs stating rather than reasoning
about: every convention outside this repository says to write `Closes`, and there is no repository
or GitHub setting that turns the keywords off.

**It is not only the reference line.** GitHub matches the keyword wherever it appears, so a sentence
of ordinary prose that puts the verb in front of the number arms it just as well — the pull request
adding this rule did exactly that twice in its own body, the second time while quoting the first
mistake in order to explain it. Read the reference back rather than the text:
`gh pr view <n> --json closingIssuesReferences` returns `[]` when the body and the commits are clean.

#783's body opened with `Closes #780 (the lead closes it, not this pull request — the reference is
here for the trail)`. GitHub does not read the parenthetical: merging #783 closed #780 one second
later, at the merge timestamp, before anything had been verified. #784 carried `Closes #781.` for
the same reason and was changed by hand minutes before it merged — that is a catch, not a control.

## What the lead may answer, and what it must escalate

**The lead answers only what is already written down, and names the source.** AGENTS.md, a
`docs/agents/` topic file, an ADR under `docs/decisions/`, or an issue body — design tracks record
their reasoning in a `## Decisions (from design discussion, YYYY-MM-DD)` section, and that section
is quotable. Naming the source is part of the answer: it lets the task session read the reasoning
around it, and it makes a wrong answer traceable instead of absorbed.

**Everything else goes to the user.** AGENTS.md opens by forbidding an implementer from assuming
domain behavior and picking a reading of catalog standards, condition scales, trade workflows or
pricing. A lead settling one instead is the same failure with more authority behind it and less
visibility.

## Questions are asynchronous

A lead session acts only while it is awake, and it may itself be waiting on the user. A task session
that asks a question is not calling a service that answers within the minute.

So **ask, and then carry on with everything the question does not block. If it blocks everything,
say so and stop.** An idle session that has stated what it is waiting for is a cheap state to
recover from. A session that guessed is not, because the guess is found only after the code has been
written around it.

## Verification, not trust

**The lead checks the repository, not the report**: `git log`, the diff, the migration SQL, the
issue's own *Done when*, and CI. A report is evidence of what a session believes it did.

This is not distrust dressed up as procedure — it is the standard whether or not the check finds
anything, because a verification performed only when something feels wrong is a hunch with a ritual
attached, and the reports worth checking are exactly the ones that read as confident.

Two things here reward reading the diff specifically:

- **A migration is never edited once written** (AGENTS.md, `platform.md`) — including one written
  minutes ago. A migration that should not have been written the way it was costs a second migration
  to correct, and the cheapest moment to notice is before the merge.
- **Closing is deliberately done by somebody who did not write the code.** The author is the worst
  available reader of their own *Done when*.

**It earns its keep, and the day this file was written proves it.** Reading #783's diff caught two
defects that the report, the four required checks and the session's own confidence had all passed
over: a claim that two concurrent suites truncate each other's tables, when this suite performs no
`TRUNCATE` at all, and a reference to a `pnpm check:migrations` script that does not exist — which
inverts the point, since nothing here checks migration ordering. Both were a sentence away from
shipping as documented rules in this very file. Neither was anybody's failure of diligence: both were
imported from the sibling project, where they are true.

**A finding about a file may simply be stale, and that is the first thing to check about it.** A
design session reported that `albums.md` documented a defective box rule; #793 had corrected it three
commits earlier, and the session was reading a worktree cut before that. So the first question about
a finding of that shape is **whether `main` moved underneath it**, asked before anybody reasons about
the content. The mirror-image error is just as available and the lead made it in the same exchange:
telling a session its *branch* was behind when only its working tree was.

**"Did the assertions pass" is not the check. "Would this have failed if the code were wrong" is.**
#814's first ordering control passed for the wrong reason — the never-alone rule was placed first and
Prisma came out protected, but by the blanket rule's own exclusion list rather than by ordering, so
the test could not see the mechanism it claimed to test. The corrected control strips the exclusions
until ordering is the only thing left, and the trap reproduces. The session caught this on itself
with nobody looking, which is the only way it ever gets caught: a control that passes for the wrong
reason is indistinguishable from one that works, and it is green either way.

**And a check that cannot see the failure is not a check.** The never-alone list in `renovate.json`
has two criteria, and the second is the one that gets missed: a dependency waits for a person either
because something written in this tree states a reason a bump could invalidate, **or because its
failure mode is invisible to every required check** (*Automerge is the one exception* below). That
second criterion is not about dependencies. Lint, typecheck and build see types, `test:unit` is pure
logic, `test:integration` is server-side — so nothing in the four checks exercises a React Query
cache, and nothing in them looks at a screen at all. Green means *the failure modes these four can
see did not occur*, and **which failure modes they cannot see** is worth asking of any change, not
only of a bump.

## A protected `main`, and what it changed

Since 2026-09-06 `main` is protected by a ruleset with **no bypass for anyone, the user included**:

- a pull request is required (0 approvals);
- **rebase merge only** — merge and squash commits are disabled on the repository, and `main`
  requires linear history;
- force-push and deletion are blocked;
- four checks must pass — `Static checks`, `Unit tests`, `Integration tests`, `Extension checks`
  (the `name:` values of the jobs in `.github/workflows/ci.yml`) — and they are **strict**
  (`strict_required_status_checks_policy: true`), so a branch must be up to date with `main` before
  it can merge at all. That last clause is what makes merges serialise; see *What may run in
  parallel*.

A direct `git push origin main` was attempted and rejected. This is verified, not assumed.

**`git log` will mislead you about this.** Every pull request in this repository's history before
2026-09-06 came from Renovate; all feature work went straight to `main`. And the `(#769)`-style
reference in a commit title is an **issue** number, not a pull request — the convention predates
pull requests here entirely.

Three consequences:

- **Auto-merge is the normal path.** With the user's go-ahead in, the lead runs
  `gh pr merge --rebase --auto` and GitHub merges the moment the four checks are green. Without it,
  somebody sits watching CI for several minutes and nobody can tell whether the work has landed or
  whether it was forgotten. The user's decision still gates the merge; only the waiting moves off a
  human.
- **A merged branch deletes itself** (`delete_branch_on_merge`). The worktree does not — see
  *Worktree cleanup* below.
- **A rejected change leaves no trace.** In a linear history it simply drops out and whatever sat
  above it rebases down over the gap, where a merged branch would have to be reverted and leave both
  the change and its undoing in `main` forever.

### Automerge is the one exception, and where its boundary runs

Everything above says a **person** decides and the lead is who asks — step 6 of the loop, and the
sentence just above that the user's decision still gates the merge. **Renovate is the single
exception to it.** A dependency pull request inside the boundary below merges itself, with nobody's
go-ahead, the moment the four required checks are green. The boundary was decided by the user on
2026-09-06 and is expressed in `renovate.json`; #814 carries the reasoning and the citations.

**What may land without a person:**

- **`patch` and `minor` only**, and only for dependencies **outside the never-alone list** in
  `renovate.json`;
- as **one grouped pull request a week** — `weekly dependency batch`, opened early Monday — never as
  a stream of individual merges;
- by **rebase**, the only method `main` allows;
- behind the same four required checks as everything else, and no sooner than
  `minimumReleaseAge: "3 days"` after the release.

**What may not, ever:**

- **Every `major`, of every dependency, without exception.** The last rule in `renovate.json` says so
  whatever matched before it, and it is last for exactly that reason.
- **Anything on the never-alone list**: the Next.js/React framework group (`eslint` included),
  TanStack, Prisma, the bundled Postgres image, `pdf-lib`, `lucide-react`, `marked`/`dompurify`,
  `sharp`, `better-auth`, `node`/`pnpm`, `@google-cloud/storage`. These are grouped and
  **unscheduled**, so they reach the user promptly instead of waiting for the Monday window, and they
  wait for a person however small the bump.

  **Two things put a dependency on that list, and the second is the one that gets missed.** The first
  is a reason written *in this tree* — AGENTS.md, a topic file, an ADR — that a bump could invalidate;
  every rule in `renovate.json` names its source. The second is that **its failure mode is invisible
  to all four required checks**, which is a different question and a sharper one, because automerge
  trusts exactly those four checks and nothing else. TanStack is the example: lint, typecheck and
  build see types, `test:unit` is pure logic, `test:integration` is server-side, and nothing in the
  suite exercises a Query cache or a Table interaction — so a minor that changes refetch or
  invalidation semantics goes green on all four and reaches the browser. Ask both questions before
  leaving something off.
- **Anything that is not a dependency update.** No feature, fix or documentation branch automerges,
  and no `task/` branch does. The lead still asks; the user still answers.

**How to tell an authorised exception from a broken process**, which is the reason this is written
down at all: somebody reading `main`'s history later will find merges nobody approved, and needs to
be able to tell which kind they are looking at. An authorised one is a pull request **opened by
`app/renovate`**, titled `chore(deps): …`, and merged with no human in the timeline — #561, merged
by `app/renovate` on 13 August, is what one looks like. **Renovate is the only actor permitted to
merge without a person.** Anything else that reached `main` without somebody having said yes is the
process failing, not an exception being exercised — report it as a finding rather than assuming it
was fine.

The trade was taken with its cost stated: a weekly batch that breaks `main` **cannot be bisected,
only reverted whole**. That is accepted because the batch is patch and minor, outside the list, and
behind four required checks.

**An arrangement whose whole point is that nobody watches it is one where nobody notices it break.**
That is not a hypothetical here. Automerge was silently impossible from the moment `main` was
protected until #814: `renovate.json` asked to merge by squash, which this repository does not allow
and the ruleset does not permit, and *nothing anywhere said so* — five stale pull requests, one red
for eight weeks, thirteen further updates rate-limited behind them and visible only on the Dependency
Dashboard. So **every backlog review sweeps the open Renovate pull requests** and reports the red and
the stale ones (`backlog-review.md`). That sweep is not decoration on the automerge; it is the half
that makes the other half safe, and neither half may be enabled without the other.

### A documentation-only pull request skips all four

Since #798, a `Detect changes` job runs first and the four required jobs are gated on its output, so
a pull request touching only `*.md`, `docs/**` and `.claude/**` reports them as **skipped** and is
mergeable in seconds. GitHub counts a skipped required check as satisfied, which is why the gate is
a job-level `if:` and never a workflow-level `paths-ignore:` — a workflow that does not run reports
no contexts at all and the pull request would wait on four `expected` checks for ever. The reasoning
lives in full in `.github/workflows/ci.yml`, next to the job.

Two things follow for a session. **The list is a whitelist**: anything else — `package.json`,
`pnpm-lock.yaml`, `prisma/**`, `.github/**`, `scripts/**`, the compose files, `extension/**` other
than its `*.md` — runs everything, as does a tag and as does anything the detection cannot answer
confidently. And a pull request that merges in seconds is still a pull request the lead verifies;
the gate removes the waiting, not the reading.

### Rebase, then re-verify, in that order

Fetch, rebase the branch onto `main`, **run the checks again**, force-push the branch. With sessions
working in parallel, `main` moving underneath a branch is the normal case rather than an accident.

The re-run is the half that is easy to drop and the only half that is interesting. A suite that was
green before the rebase was green against a *different* `main`; all it establishes is that the
branch worked in isolation, which is not the claim anybody needs. If GitHub offers to update the
branch for you, doing it locally is still better — that is where the checks get re-run by somebody
who then reads the result.

## Branches

`task/<issue>-<slug>`, branched from `main`: `task/780-collaboration-model`. One branch per issue,
the same issue the session owns.

## What may run in parallel

Sessions run in parallel, each in its own worktree. **Merges serialise, and that is the trade**: the
second branch ready rebases onto the first and re-runs its checks. At two or three parallel branches
that costs one extra CI run, which is cheap next to the alternative.

**Where two branches touch the same file, that trade is not one extra CI run — it is a round trip.**
A rebase that conflicts is not something GitHub can do for you: *Update branch* fails, and the branch
waits for whoever can resolve it. Dependency updates and one `pnpm-lock.yaml` are the worked example.
Merging one of them leaves the others **conflicted** rather than merely behind, and Renovate has to
regenerate the lockfile on its own next run, so draining N updates costs N Renovate cycles and N
serialised CI runs — which is the reasoning behind the weekly batch in #814.

The shape is general, and it is the thing to reason about before starting two sessions: **work that
shares a file serialises whatever this section says about parallelism**, and choosing what runs at
once is choosing which files are shared. The lead already does this by hand in feature work — #815's
amendment held it back while #816 and #820 were in the same renderer, on the grounds that three
changes at once in one file is how a conflict happens.

Two limits are being worked out in **#781** rather than here, and that issue's files carry the
detail — do not restate it in this file:

- each worktree needs its own Compose project, ports and test database. `pnpm test:integration`
  brings up `docker-compose.e2e.yml`, which binds host port **5433**, so the second session's
  `docker compose up -d --wait` fails outright with `port is already allocated` — loud, and easy to
  diagnose. The quiet failure is **schema drift**: the suite then runs `prisma migrate deploy`
  against that one database, so a session whose branch adds a migration changes the schema
  underneath the other session, whose generated client no longer matches it. The rows themselves are
  safe either way — the suite isolates by unique ids per test, and nothing in it wipes tables.
- **one schema-touching session at a time — and here that rule is the only thing there is.**
  Migrations are hand-written, timestamped directories under `prisma/migrations/`, and **nothing
  checks their ordering**: no script, no CI job. Two written in parallel each look correct on their
  own branch and can only be reconciled once both are in one tree, by which point the fix is a
  *third* migration rather than an edit, because a written migration is never edited (AGENTS.md,
  `platform.md`). Anything without a migration parallelises freely.

## No browser verification — a deliberate departure

**A session does not start a dev server and does not drive a browser unless the user explicitly asks
for it.** It verifies with `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` and `pnpm test:integration`,
and says in its report what it ran.

**The user tests the application themselves, through Docker Compose.** That is where the app is
actually exercised here, and a session's dev server is a second, differently-configured copy that
proves less and leaks memory besides (AGENTS.md, on Turbopack and issue #161).

This is recorded because the darkroom model this file is adapted from requires the **opposite** — it
has a whole section on exercising work in a browser afterwards. That is right for that project and
wrong for this one. **It is a decision, not an oversight; do not "fix" it back.** If a change really
does need a browser, ask the user first.

## Findings go to the lead, not into new issues

A task session that notices something outside its scope — a stale document, a missing index, a bug
next door — **reports it to the lead and carries on**. It does not open an issue, and it does not
fix it.

With forty-odd open issues and design tracks spanning nine issues at a time (#763–#771 for albums,
#744–#750 for multi-stamp copies), five sessions each filing what they happened to notice produce
five overlapping issues that nobody reconciles, and the backlog grows sideways faster than it is
worked through. This is the same reason two rules already in force exist: search the backlog for a
duplicate or a planned child before filing, and split genuinely independent scopes rather than
bundling them. Both need the whole backlog in view.

## New backlog items come through the lead

Writing an issue here *is* placing it in the backlog. It means a Conventional Commits title, the
`backlog` label plus a type and a priority, a check that no open issue already covers it, a
`## Depends on` line naming what must close first, and a position relative to everything else open.

**Drafting can be delegated; the triage never is.** A session may be asked to write out the issues
for a design track — the lead reconciles them against the rest of the backlog before any of them is
filed. A dependency edge is only ever wrong *between* two issues, which is the one place a task
session is not looking.

## Design sessions

A large feature is discussed in **its own session**, not in the lead's: the dialogue runs long, and
it would consume exactly the context the lead exists to hold.

**This is the one place the user talks to somebody other than the lead**, because a product
conversation cannot be run through a proxy — the valuable part is the follow-up question neither
side knew to ask.

Its output is an **ADR** under `docs/decisions/`, a topic file update, and a **proposed set of
issues** whose bodies carry a `## Decisions (from design discussion, YYYY-MM-DD)` section recording
what was settled and, just as usefully, what was deliberately left out. This is already the
established shape here — #755 (albums) produced ADR-0045/0046/0047 and #763–#771/#777/#778; #744
(multi-stamp copies) produced ADR-0044 and #745–#750; #71 produced #72 and #736–#740. The proposals
go back to the lead, who reconciles them before any of them becomes backlog.

## Release sessions

Cutting a release is its own kind of session and fits neither shape above. It has no issue and no
branch, and what it produces is a tag, a GitHub Release and a published image.
**`release-versioning.md` owns the procedure end to end**; none of it is restated here.

It stays separate rather than becoming the tail of the task session that wrote the last feature,
because a release session changes nothing else — no code, no documentation, no configuration — so
that its transcript reads afterwards as the record of one release. Since the version bump was
dropped from the procedure (#780), that rule is now literally true rather than aspirational: there
is no longer anything for a release session to commit.

A release session is spawned **fresh** every time, for a reason the procedure itself states in its
first line: never assume the last released version from memory or from local tags, always run
`gh release list`. A long-lived release session is a session accumulating exactly the thing that
file forbids — and the procedure changes between releases, so it would follow the version it
remembers rather than the one on disk.

The boundary runs the other way too: a session **reviewing the backlog** only *suggests* a release
and never prepares one (`backlog-review.md`), and the lead is normally the session that applies to.

## Worktree cleanup

Three layers, and the middle one is what makes forgetting the first harmless:

1. **A merged branch deletes itself** on GitHub, and **the lead removes the worktree** — along with
   the local branch, and the remote branch too if the work was dropped rather than merged.
2. Per-worktree slots are reclaimed when the worktree goes (#781).
3. **Every backlog review sweeps**: `git worktree list`, `git worktree prune`, and remove what is
   stale (`backlog-review.md`).

Two orphaned worktrees from 27 August were found by hand while this model was being written. A
worktree nobody removed holds a slot and a database permanently, and the cost surfaces weeks later,
in an unrelated session, as a failure with no visible cause.

## How much experience is behind this

**One day.** Before 2026-09-06 every commit in this repository went straight to `main` and every
session was the only one running. The single-session rule at the top has 261 plans behind it; the
lead, the pull request and the parallel worktrees have a single afternoon. This file records the
current state of the practice, not settled practice, and the parts likeliest to be wrong are the
ones exercised least: more than two sessions at once, and how a design track's issues get spawned as
a batch.

## Keeping this file honest

Every backlog review asks whether the model above still describes what actually happens, and
**reports what it finds rather than quietly fixing it** (`backlog-review.md`):

- Did a task session stall waiting on the lead, and for how long?
- Did the lead answer something that was not written down anywhere?
- Did anything reach `main` without the user's explicit go-ahead? A Renovate automerge inside
  the boundary above is the one authorised answer — check that it really was inside it.
- Is automerge still working at all? Its whole failure mode is silence, so the answer comes from
  the Renovate sweep in `backlog-review.md`, not from the absence of complaints.
- Did a task session open an issue, close one, or merge a pull request?
- Are there worktrees or `task/` branches left over from work that has already landed?

Each of these is one of the rules above failing in a way that looks like nothing at the time. A lead
answering from its own judgement is indistinguishable from a lead answering from the documentation,
right up until somebody asks where the answer came from.
