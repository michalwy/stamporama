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

**This is not a new rule; it is the only thing that has ever happened here.** `.claude/plans/` in the
main checkout holds **261 implementation plans**, and every one of them is a single session's, start
to finish. Not one hands a step to another agent. **That is a count from the single-checkout era and
it stopped growing on 2026-09-06**: plans are no longer asked for, and a session that writes one
keeps it as a working note in its own worktree (*Worktree cleanup*, #875). **The evidence is
unaffected by that.** It counts what was actually done across this project's entire history to that
date, and an argument from what happened does not weaken because the practice that produced it has
ended — it is a closed record, not a shrinking one.

AGENTS.md used to describe four roles — Architect, Designer, Developer, Tester/Reviewer — powered
up in sequence for anything crossing a domain, data or authorization boundary. In those 261 plans
they were **never used once**. They are gone, and this file replaces them.

**Splitting one issue between agents needs a reason beyond size.** The reason it has never been
worth it here is the invariant list in AGENTS.md: a feature in this project is a hand-written
migration, the Prisma types it generates, a server component that must not import a client value,
a dialog built from `dialog-shell.tsx`, an icon added to `icons.tsx`, and a token that needs a value
in both `:root` and `.dark`. Those are not four specialists' tasks; they are one decision seen from
six angles. Two agents on the same surface produce two half-designs, and neither has read the
other's reasoning.

### It is about handoffs, not arithmetic

**A session may hold more than one issue.** Decided by the user on 2026-09-08 (#997), against a
sentence in this file rather than from it: the lead had been bundling all day — #821+#951+#924 in
`AGENTS.md`, #932+#942+#979 in one passage, #969+#982+#974+#992 across two files — while the
heading above said something narrower, and a reader arriving the next morning would have found the
practice contradicting the file.

**The section's own argument settles which of the two is meant.** Everything above is about
splitting **one issue** between agents: four role-players powered up in sequence on a single piece
of work, two of whom produce half a design each. The 261 plans are evidence of that same shape —
not one of them hands a step to another agent — and none of them is evidence about a *count*. And
this file already implies the conclusion from the other side: *work that shares a file serialises
whatever this section says about parallelism*, and choosing what runs at once is choosing which
files are shared (*What may run in parallel*).

**The condition is a shared file, and never convenience.** Four issues in `collaboration.md` run as
four sessions only as four sequential merge cycles, each rebasing on the last and each landing on
prose the previous one moved — which is how two copies of one claim drift apart, and that is
#982's whole subject. Serialisation is what a bundle buys off. Saving a worker, a chip or a round
trip is not, and *no free worker* is the reason that most needs refusing, because it is the one
that is true whenever the pool is empty.

**Since 2026-09-10 the shared-file condition is doing more work, not less, and the reason narrows**
(#1059). With one worker at a time, *every* split serialises — four issues are four sequential
cycles whatever files they touch — so *serialisation* on its own would now argue for bundling
everything, which is plainly wrong. What a bundle actually buys is the half that is still peculiar
to a shared file: **not waiting, but each cycle rebasing onto prose the previous one moved.** That
is #982's failure and it does not arise between issues in different files, however long the queue.
And the refusal above is now the ordinary state rather than the busy one — with one track, *no free
worker* is true most of the time.

**Three things stay separate, and they are what keep a bundle verifiable** rather than one diff
answering four criteria nobody can check it against:

- its own **`Refs #NNN`** line;
- its own **verification against its own *Done when***;
- its own **closing comment**.

That is exactly what the three bundled sessions of 2026-09-08 did, and it is why none of them
produced a pull request whose scope could not be read off it.

**The cost, stated rather than glossed: a bundle cannot be undone one issue at a time.** History
here is linear and force-push is blocked, so four issues in one commit are four things that can only
be reverted together. Weigh that each time against the serialisation it buys — it is the reason
*shared file* is a condition and not a preference.

**A finding filed against the lead is the one case the lead should not settle about itself.** #995
bundled #969 — a finding that the lead had been *writing* the pull requests it is only authorised
to merge — with three unrelated changes, so an audit of *was that corrected* has to disentangle it
from the rest. **This is a sentence rather than a rule**, and the reasoning is worth more than the
verdict: the three separations above already keep the trail, because the closing comment is
per-issue and is where the correction is recorded. What bundling actually costs such a finding is
separate revertability — the general cost in the paragraph above, not something peculiar to
findings. What is peculiar is who decides: the party choosing the bundle is the party the finding is
against, which is *The lead's licences are to merge, never to write* one level up. **So the brief
says that a bundled issue is a finding against the lead**, and the worker may refuse the bundle on
that ground. Stating it costs a clause; deciding it silently is the half that cannot be audited.

**A session holding several issues has a title for it** — `#NNN/#NNN/…: <what they share>`, in
*Session titles* below. Same gap, two symptoms, settled together (#993).

## The two kinds of session

**The lead session** is long-lived. It holds the backlog, decides what is worked on next, writes
the prompt for each piece of work, spawns the task session, answers its questions, verifies what
came back **in the repository**, collects the user's go-ahead, merges the pull request and closes
the issue. It writes little or no code.

What it holds is the state no single task ever sees: forty-odd open issues, the `## Depends on`
edges between them, which design track an issue belongs to, and what is in flight in another
worktree right now. None of that is cheaply re-derivable from a file.

**A task session** is short-lived and owns its issue end to end — one issue normally, and
sometimes a bundle of issues that share a file (*It is about handoffs, not arithmetic*). It works in
its own worktree on its own branch, asks the lead when it is blocked, commits as it goes, pushes the
branch, opens the pull request, and **reports back**. It does not merge, does not close issues, and
does not file new ones.

**The user talks to the lead.** That is much of the point of the split: the user should not have to
track which of three sessions is asking, or repeat the same decision to each of them. The design
session below is the one deliberate exception.

### The lead's licences are to merge, never to write

**Every authorisation the lead holds over a pull request is an authorisation to *merge* one.**
*A pull request no CI job can speak to skips all four* and *Process work the lead may merge* both
say what the lead may put into `main` without the user's second yes. **Neither says anything about
who may write it**, and the two paragraphs opening this section already answer it: the lead *writes
little or no code*, and a task session owns its issue end to end. **A documentation task is a
task** — it gets an issue, a worker and a pull request like anything else, and the lead's part in
it is the brief, the verification and the merge.

**This is written because the lead read one as the other.** On 2026-09-08 it wrote and merged five
documentation pull requests in a single session, and opened a sixth, on the stated ground that
*documentation, so I do not need a tile for this*. **That ground does not exist.** #906 was a
decision about merging, taken because a pull request whose four gated checks are skipped has no CI
run worth waiting for; nothing in it moved the writing.

**It accelerated, and that is the part a rule has to catch rather than the first step.** The first
of the five was defensible on its own terms — the merge boundary had no durable home and was one
handover from being lost (#958). Each one after it felt more ordinary than the one before, and by
the third the question had stopped being asked at all. **Nothing goes red when this happens**: the
pull requests were fine, the checks passed, and what was actually spent was the lead's context —
which went on writing prose instead of holding the backlog, the `## Depends on` edges and what is in
flight in another worktree, the one thing this file says is *not cheaply re-derivable from a file*
and the one thing that dies with the lead.

**The general shape, because this is the second instance in two days: an authorisation is bounded on
the axis it was granted on.** #941 is the mirror image, recorded by the previous lead against
itself — *who decides what is worked on* read as *who may merge it*. This one reads *what may be
merged* as *who may write it*. Same failure, perpendicular axes, and **neither rule would have
caught the other**, which is why the general form is written down instead of a third instance being
waited for. A lead extending its own authority along an axis nobody drew a boundary on is the case
with no detector: it is invisible in the moment, it is always locally reasonable, and the person
judging it is the person it benefits.

**And when a documentation fix is urgent and no worker is free, the lead waits.** No urgency
exception is written here, and the omission is deliberate rather than an oversight:

- **An authorisation carrying its own *unless it is urgent* clause is not bounded.** The person
  deciding it is urgent is the beneficiary, deciding alone, in the moment, with no second reader —
  which is the shape of every self-granted extension. Had that licence existed in writing on
  2026-09-08 it would have covered all five, because each felt as reasonable as the first.
- **What the urgent case is actually protecting is a decision, not a file — and the lead already
  has an instrument for that which needs no pull request.** #962's real risk was that the merge
  boundary would be lost with the session that held it. **Filing the issue records it**, in GitHub,
  durably, and filing is the lead's own job rather than a worker's: #958 is that instrument being
  used for this very boundary. The prose catches up when a worker writes it, and nothing is at risk
  in between.
- **The wait is bounded and visible.** Assigning a free worker costs a message, which reaches the
  user anywhere; only an empty pool costs a chip, which he clicks when he is next at the computer.
  The free-worker count is in every status table for exactly this reason (*The pool of generic
  workers*), so a lead that is about to be blocked by an empty pool can say so a reply earlier.

**What is not restricted, said plainly, because the rule is about pull requests and not about
typing.** The lead writes the prompt, the issue body, the closing comment, the status table and its
own handover; none of those is a pull request, and all of them are its job. The line is the pull
request.

## How a task session is actually spawned

Getting this wrong once cost a session's worth of work, so it is stated plainly.

- **A task session is a separate session, not a subagent.** The lead spawns it as a task tile. It
  gets its own worktree under `.claude/worktrees/` and its own transcript, and it **outlives the
  lead's turn** — the lead is not blocked waiting for it, and it does not return a value into the
  lead's context. The tile is normally spawned **without a task**, from a pool, and the issue reaches
  it by message afterwards (*The pool of generic workers*); everything below holds either way.
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
- **Spawning goes through a tile the user clicks — so spawn on foreseeability, not on
  startability.** The click cannot be removed. Being interrupted *at the moment each session becomes
  startable* can be, and that is the half worth removing: **plan the queue and spawn it whole**,
  holding whatever cannot start yet, so he clicks a batch at a time of his own choosing and then
  walks away. Decided by the user on 2026-09-07 (#897), whose stated aim is to look at the computer
  as rarely as possible.

**Everything travelling around this loop is written in English** — the prompt, the questions and the
report alike, whatever language the user and the lead are speaking. AGENTS.md requires English of
everything that lands in GitHub or the repository; these messages land in neither, but the work they
produce does, and a report written in one language and a commit message in another is a translation
step nobody asked for.

### Spawn ahead and hold

**The unit is the batch, and "earlier" is only the means** — a chip spawned an hour early still
interrupts him an hour early. In one round the lead should be able to spawn the work whose files are
free **now**, with no hold; the work blocked behind one of those, **held on a checkable
precondition**, typically *"this commit is in `main`"*; and the work blocked behind something else
entirely — a release, a decision — held on that.

**The planning is the work; the holds are only how it is expressed.** Spawning when a session *can*
start means spawning one at a time and paging him each time. Spawning the queue whole means knowing
the file-level dependencies up front, which is exactly what the lead holds and what no task session
can see (*What may run in parallel*).

Three sessions on 2026-09-07 were spawned this way and not one of them needed him at the moment it
became startable: **#868**, held until `main` carried #844, which waited, read itself in, armed a
monitor and reported *"no action needed from you unless #893 is stuck"*; the **release session**,
spawned before the work it would release had merged, which prepared everything the procedure allows
without a tag; and the **incoming lead**, spawned by the outgoing one with the handover as its
prompt. He clicked three chips at a time of his choosing.

**A hold is not "do nothing", and a held session must be told five things.** Each was learned from
one of those three, and each is load-bearing:

1. **What it is waiting for, as something checkable** — a commit in `main`, a named pull request
   merged, a release tagged. Never "wait for the lead", which cannot be verified and invites
   guessing.
2. **What to do meanwhile, said explicitly — and since 2026-09-08 the answer turns on whether the
   session has a task.** A session held *with* its issue does everything that does not write:
   reading itself in is real work, and #881 did its entire measurement while held, because
   measuring changes nothing. **A pooled worker, which is held with no task at all, reads
   nothing** — the reversal and its reasons are in *The pool of generic workers*. What this point
   said without that qualification is quoted there rather than deleted, so that a later reader can
   tell which of the two instructions is the newer.
3. **What it must not do**, listed rather than implied. The incoming lead was told not to merge, not
   to close, not to spawn, not to check a branch out in the main worktree, and **not to answer task
   sessions that message it** — two leads answering one question is worse than a slow answer.
4. **To ask rather than proceed** if it believes the precondition is met before the signal arrives.
   A session that starts early on a stale premise costs more than one that waits.
5. **That the state may have changed** between the chip being written and the signal arriving. The
   signal names what actually landed, and **the lead re-briefs at that point** rather than assuming
   a prompt written hours earlier still describes the issue.

**The chip's title says what the session is, and since 2026-09-08 it says it in a fixed
vocabulary** (*Session titles*, below). A pooled worker is `⏳ Worker 7`; the moment it is assigned
it becomes `🔨 #812: quick-add an area from the filter facet`. He is choosing what to click and
when, and a title saying the session is waiting tells him it costs nothing to start it now; one that
does not, does not. **Since 2026-09-10 the waiting is the leading `⏳`**, which is what that
sentence had been asking the wording of the title to carry (#1042).

**Until that date the rule was deliberately looser — *what a title says, not which phrase it uses*
— and the reason it was written that way is still true.** A rule matched against one phrase
strands every session that worded it differently, and *awaiting assignment* discharged it as well as
*hold for the lead's signal* did. What changed is not that the argument failed but that the user
set the vocabulary, which buys back the checkability a free-form convention cannot have. Both
readings fail safe in the same direction, so nothing that was written under the old one is stranded
by the new one.

**The lead spawns its own successor** the same way: the handover as the prompt, and a hold on the
signal. That removes the one interruption that used to be unavoidable — a handover being something
he had to notice was due, paste and start himself. The handover's shape is recorded in #897 and has
now been used twice; it is not restated here.

**It is cheaper, not free, and the old paragraph's candour is worth keeping.** The click is still
real. A held session still holds a worktree and a slot (#781). **What used to follow — *the room is
four or five held alongside what is running, and spawning ten at once is still not a thing to
propose* — is superseded** (2026-09-10, #1059, with #998 behind it): a pooled worker now reads
nothing at spawn, one task runs at a time, and ten held alongside one working is the intended state.
The worktree and the slot are what remain real. A chip spawned
too early can still go stale, which is what point 5 guards. And **none of this moves a decision off
the user**: he still chooses what is worked on, still answers what is escalated, still gives the
go-ahead before a merge. What goes is being paged at moments a machine chose.

### The pool of generic workers

**The lead spawns a pool of generic workers rather than a chip per task.** Twelve on the first round,
clicked in one batch; they start with no task and wait. The lead then hands each one an issue **by
message**. Decided by the user on 2026-09-07 (#906), the same afternoon as *Spawn ahead and hold*.

**The reason is device-bound clicking, and it is the part worth carrying.** A chip is expensive not
because it is a click but because it can only be clicked **at the computer**, while a question can be
answered from a phone. So what is being minimised is not the number of his interactions but **how
many of them require him at the desk**: the pool turns a stream of per-task chips into one batch he
clicks when he is there anyway, and everything after that reaches him wherever he is. It is *Spawn
ahead and hold* taken one step further — that section removed the moment a machine chose, and the
pool removes the task from the chip altogether.

What was settled with it:

- **One task per worker, and no recycling.** A worker on its fifth task carries four tasks of context
  and reads the fifth through them, which is the objection this file already makes to a long-lived
  release session. The pool is consumed one worker per task and topped up when convenient.
- **One worker at a time. One task in flight.** **Decided by the user on 2026-09-10 (#1059)**, and it
  **supersedes** what #906 settled on 2026-09-07, which this bullet used to state as: *"Two or three
  sessions working at once, four or five for small tasks."* **The old figure is quoted rather than
  replaced**, for the reason this section gives about an inherited prompt — it will keep arriving, in
  handovers and in habit, and a bare replacement cannot tell a later reader which of the two is the
  newer (`feedback_polish_to_him_always` is the local shape to copy). **A second track runs only on
  the user's explicit request**, and *What may run in parallel* is what governs it when he asks.
- **In flight means *actively working*, and a session waiting for a showcase is not.** **Decided by
  the user on 2026-09-10 (#1081)**, amending the bullet above within hours of it landing. The bullet
  had been read conservatively — a branch pushed, verified and waiting on him to look still counted
  as in flight, so the queue stopped whenever he stepped away — and **that reading is now wrong**.
  When a session finishes its main work and enters showcase-waiting, **the lead starts the next
  task**. **A correction coming out of his look queues behind whatever is then running** rather than
  pre-empting it, unless he says to run it in parallel. **His own wording governs the cases nobody
  has enumerated**, which is why it is quoted rather than paraphrased: *"gdy worker kończy główną
  część i przechodzi w tryb czekania na pokaz, możesz startować następne zadanie… robisz wszystko
  jednym torem, ale tak żebym ja nie blokował pracy"* — one track, arranged so that he never blocks
  the work. **The reason is the rule's own purpose rather than a detail of it**: one track exists to
  stop two sessions writing the same file, and a session awaiting a showcase is writing nothing.
  Counting it as in flight bought nothing and spent the whole queue on his availability, which
  inverts what the pool and *Spawn ahead and hold* were built for. **The figure did not change** —
  one session working, still. This is one track that stops counting a session as working when it
  has stopped working.
- **The pool size is still not the concurrency, and now less than ever.** A pooled worker reads
  nothing at spawn (#998), so **ten idle alongside one working is the intended state** rather than a
  sign of over-provisioning. What each still costs is a worktree and a slot (#781), and a sweep that
  can tell it from an abandoned one (*A held session's worktree is not stale*).
- **The lead reports the count of free workers in every status table**, so the user tops up when he
  is at the computer rather than when the lead runs out.

**A branch waiting on a showcase still holds its files, and that is the hazard the amendment
creates.** It will rebase, so a second branch editing the same file turns a wait into a conflict
somebody resolves by hand — which is why the next task started while one waits is chosen against
the waiting branch's **diff** and not merely for being next in the queue. **It went the right way on
its first day**: with #1077 waiting on the user and holding `AGENTS.md` and `ui-patterns.md`, the
next issue in the queue needed exactly those two files, and the lead read the waiting branch's diff
before assigning rather than after. **So file contention is exercised more under this rule, not
less** — *What may run in parallel* turning out to be needed on the single track, one step earlier
than #1059 expected it to be needed at all.

**Two costs the user took knowingly, stated here and not restated elsewhere.** Neither is an
argument against the rule; they are what it buys serialisation with.

- **Throughput is bounded by wall clock.** A queue of eight ready issues is eight sequential cycles,
  each with its own CI run. Nothing overlaps, so *when* is now additive rather than a judgement about
  contention.
- **An unanswered question blocks more than it used to.** With three tracks a question could sit
  while other work moved; with one, whatever is asked of the user is in front of everything. That
  sharpens two rules already here rather than adding a third: *ask, and then carry on with everything
  the question does not block* (*Questions are asynchronous*) is now most of what a blocked session
  has left, and the age on a 🔴 row (*The three things a row must carry*) is measuring the whole
  pipeline rather than one lane of it.

#### A pooled worker reads nothing until it is assigned

**This reverses what this file said until 2026-09-08**, and the reversal is written as one so that
a later reader is not left with two instructions and no ordering. The sentence above used to read
*they start with no task, read AGENTS.md and this file, and wait*, and point 2 of *Spawn ahead and
hold* used to say without qualification that **reading itself in is real work and every held
session did it**. Both were true of the sessions they were written about. **The user decided on
2026-09-08 (#998) that a pooled worker reads `AGENTS.md`, this file and the topic files at the
moment it is assigned** — as the first step of the work, not before it.

**Which copy — and the branch cut answers it, not a rule per file.** Reading at assignment leaves
a worker in a worktree cut when the **pool** was clicked, which may be hours old, so reading this
file off that worktree hands it the file as it stood at spawn: **the staleness this section
exists to remove, reproduced honestly, with nothing to say so** (#1060). So **the wake-up drill's
first two commands run before any reading** — `git fetch origin main`, then cut
`task/<issue>-<slug>` from `origin/main`. After the cut the worktree **is** `origin/main`, so
`AGENTS.md`, this file and every topic file are current by construction. Anything read *before* the
cut is read with `git show origin/main:<path>` — `AGENTS.md` included, since `CLAUDE.md` tells
every session to read it *before starting any task*, and an assignment is a task starting.

**And `AGENTS.md`'s wake-up-drill bullet is the record of that ordering; this section is the
reasoning behind it and `CLAUDE.md` is a pointer to it** (#1068). Three files now assert one
ordering, and this project's answer to three copies is to name the one that decides —
`.github/rulesets/main.json` for the ruleset, the `Detect changes` `case` glob for the safe list.
**`AGENTS.md` is the right one here, and the reason is not that the drill happens to be stated
there**: a rule about what to do *before you read* cannot have its record in the file that is read
third. A worker meets this section only after `CLAUDE.md` and `AGENTS.md`, which is after the
moment the rule governs.

**The precedent transfers only halfway, and a reader who takes it whole will believe they have a
guarantee they do not have.** `main.json` and the `case` glob are records because they **are** the
mechanism — they cannot drift from what they describe, which is the whole reason this file reaches
for them. Nothing here executes: the mechanism is a session's behaviour, and all three copies are
prose. So naming a record buys **which copy wins when they disagree** and buys **nothing against
drift**. What still guards the drift is what guards it everywhere else in this file — the sweep,
run before the edit as well as after (*Sweeping for a claim*).

**A session that cuts no branch has no such moment, and `git show` is the whole of its answer.** A
release session has no issue and no branch (`release-versioning.md`, *The wake-up drill is not this
session's*), so the fetch is the only step of the drill it runs and its worktree never becomes
`origin/main`. It reads its own procedure file the explicit way. That file took 102 added lines on
2026-09-10 — the largest single move of any process file that day — so this is the case with the
most to lose, not the tidy corner it looks like.

**Every process file gets this, and the reflex to exempt some of them fails on its own terms.** The
tempting alternative is to name the fast-moving files and `git show` only those. Measured on
2026-09-10 over `origin/main`, by author date, from 2026-09-06 — the day this model started — the
list a person would write is wrong both ways:

| file | commits since 2026-09-06 | busiest day |
| --- | --- | --- |
| `docs/agents/collaboration.md` | 43 | 17 on 2026-09-08 |
| `docs/agents/ui-patterns.md` | 21 | 10 on 2026-09-07 |
| `AGENTS.md` | 18 | 6 on 2026-09-07 |
| `docs/agents/backlog-review.md` | 16 | 7 on 2026-09-08 |
| `docs/agents/inventory-lists.md` | 14 | 7 on 2026-09-07 |
| `docs/agents/platform.md` | 13 | 7 on 2026-09-07 |

`AGENTS.md` is not the rarely-changed file it is assumed to be — eighteen commits in five days,
three of them in the two hours before this paragraph was written. *A topic file is read only by the
session touching that area* is true and does not help: that session is the one about to act on it,
`ui-patterns.md` out-moved `AGENTS.md` over the same window, and on 2026-09-10 `offers.md` took four
commits to this file's three.

**The session writing this is the worked example, and it did not go the way the reasoning above
predicts.** Its worktree was cut at `51faddc` and it was assigned two and a half hours later. In
between, `origin/main` took four commits, **two of them under `docs/agents/`** — `ui-patterns.md`,
and 102 added lines of `release-versioning.md`. Neither was `collaboration.md`. **The file everyone
watches was the one that had not moved**, which is the argument for an ordering rather than a
watchlist in one line.

**And it costs nothing, which is why it is an ordering and not a discipline.** The drill was already
unconditional and already first; what moves is the *reading*, to after its first two commands rather
than beside them. The cut is instantaneous and is the whole of what the reading depends on —
`pnpm install` and `pnpm exec prisma generate` are the slow half and may run while the reading
happens.

**The decisive reason is staleness, and it is removed rather than mitigated.** Workers spawned at
14:57 on 2026-09-08 read this file as it then stood. **It changed four times that afternoon** —
#975, #984, #994, #995 — growing from about 1570 lines to over 1900, and what changed included the
session-title convention, the merge loop, the whole sweep discipline and the boundary on what the
lead may write. A worker assigned the next morning would carry a stale reading of the very file
that governs it, honestly acquired, with nothing to tell it so. That is the inherited-chip failure
exactly (*Memory is not versioned, and nothing expires it*): ninety percent right, so it behaves
correctly nine times out of ten and the tenth looks like ordinary diligence. The workaround was to
tell the successor lead to make them re-read; **reading at assignment makes the problem not arise**,
which is a different kind of answer from remembering to say so each time.

**The worker that wrote this section is the worked example.** It was spawned in that 14:57 batch,
read the file as it then stood, and was assigned these four issues afterwards — so its brief
opened by telling it that its copy was stale and to re-read the file from `origin/main` before
touching anything, which it did, and two of its four issues turned out to be about passages that
had moved in the interval. **That instruction is the workaround, performed once, by hand and
correctly.** It is also the last time it should be needed here: a rule landing with a live instance
of the failure it prevents is worth more than the rule on its own.

**That last sentence was wrong, and it took two days to fail.** On 2026-09-10 a lead wrote the same
by-hand instruction into a brief again, because the routine read this section prescribes had never
been given a source and the workaround was the only place `origin/main` appeared here at all. The
paragraph stays as the dated account it is; the instruction is up in *Which copy*, where a worker
at assignment will meet it — which is #1060's point, and the reason it was filed rather than this
paragraph being edited into a rule.

**The budget argument is second, and it is a halving rather than a deferral.** The lead's first
framing — *shifted, not saved* — compared reading at assignment against the **old** model, which
the paragraph above has just broken. The honest comparison is against the *fixed* old model, read
at spawn **and** re-read at assignment; against that, reading once saves one full read of
`AGENTS.md` and a 1900-line process file **per assigned worker**, which on 2026-09-08 is ten. The
shape argument sits on top of it: twelve simultaneous reads at spawn are a spike inside the
five-hour window, competing with sessions doing actual work, where one read at assignment is paid
by the task that needs it.

**The spawn prompt is not empty, and that is what makes this safe rather than merely cheap.** It
still says: you are a pooled worker, you have no task, **do not read the process files yet**, this
is what you are waiting for — a message naming one issue, which is checkable where *wait for the
lead* is not — and this is how to reach the lead: by looking up the session whose title is the
lead's and whose `cwd` is under this repository (*Session titles*), never by an identity a message
claims for itself.

**And the assignment message says where to read from, because that is where a lead looks when it is
writing one.** It names the issue, and it says: run the drill's `git fetch origin main` and the
branch cut **first**, then read `AGENTS.md`, this file and the topic file — the worktree is as old
as the pool until the cut, and current the moment after it. That is one clause in a brief, and it is
the half a lead composing a prompt from habit will otherwise leave out (#1060).

**One consequence is recorded as open rather than decided.** A session that reads on demand is not
specialised at spawn, so the pool stops being a pool of *workers* and becomes generic capacity: a
release session, a design session **or the incoming lead** could come out of it by message rather
than by a tile. That would remove the one remaining interaction that requires him at the machine,
which is the whole reason the pool exists — a handover currently needs a chip, and a message does
not. Nobody has tried it, and a lead drawn from a pooled worker is a larger change than a release
session drawn from one, so it is written here as a possibility and not as a rule.

**A dozen idle worktrees are the worktree sweep's problem, and it already has the answer**: an
unassigned worker is indistinguishable from a held session by every git signal, so it is removed on
the session lookup and never on age (*A held session's worktree is not stale*).

**Two mechanical steps go with an assignment, and both are the lead's reasoning rather than the
user's decision** — #906 marks them as such, and they are refutable:

- **The wake-up drill, unconditionally, on every assignment**: `git fetch origin main`, cut the
  `task/` branch from `origin/main`, `pnpm install`, `pnpm prisma:generate`. **The first two come
  before the reading**, and the reason is above — until the cut every process file in the worktree
  is as old as the pool, and after it none of them is (#1060). The last step looks
  redundant and is not. A pooled worktree may be hours old by the time it is assigned, and if `main`
  has taken a migration since, `pnpm install` reports *"Already up to date"*, skips the postinstall,
  and leaves a Prisma client that is **stale rather than missing** — which compiles, and whose tests
  pass against a schema the branch no longer declares (#862). A stale client looks exactly like a
  sound one, and regenerating costs seconds. **Two steps of one drill answer two different
  staleness problems** — the cut answers the prose, the regenerate the schema — and both are
  invisible when they go wrong.
- **A worker that used the integration suite releases its slot before it finishes**:
  `pnpm e2e:db:down && pnpm slot release`. A slot is allocated **lazily**, on first use of that
  suite, so releasing it holds demand at the number of sessions actually running rather than the size
  of the pool. `scripts/dev-slot.sh` caps at slot 9 and that is **not** a ceiling on the pool; no
  change to it is needed and none should be made. **Do not run `pnpm slot` from that worktree
  afterwards** — printing the table allocates, and hands the number straight back (#922, open and
  undecided).

### Session titles

**Decided by the user on 2026-09-08 and amended by him three times since** — #928 set the
vocabulary, #975 added the pull request number to it, #1042 replaced the `[DONE]` prefix with a
state icon on 2026-09-10, and #1048 gave the design session an icon and a row of its own the same
day. A session's title is the only signal that travels between the app's session list, the
user's screen and the worktree sweep, so it is a fixed vocabulary rather than a description:

| state | title |
| --- | --- |
| Worker spawned, no task yet | `⏳ Worker N` |
| Assigned, no pull request yet | `🔨 #NNN: <the issue's theme>` |
| Assigned several issues at once | `🔨 #NNN/#NNN/…: <what they share>` |
| Pull request opened | `🔨 #NNN[#PPP]: <the issue's theme>` |
| Worker finished, and spent | `✅ #NNN[#PPP]: <the issue's theme>` |
| Release session | `🔨 Release: X.Y.Z` |
| Release cut | `✅ Release: X.Y.Z` |
| Design session, running | `🎨 <what is being designed>` |
| Design session, finished | `✅ 🎨 <what is being designed>[#PPP]` |
| The lead, while it is the lead | `👑 ===> Leader <===` |
| A lead that has handed over | `✅ Leader YYYY-MM-DD`, the date of the handover |

**Eleven rows take five icons: a phase for a session that has phases, and a role of its own for a
session that does not.** `⏳` is waiting, `🔨` is working, `✅` is finished; `👑` is the lead and `🎨`
is design. A worker waits, works and finishes, and so does a release session — which is why the
subject after the icon carries *what* it is working on and there is no release icon and none for a
bundle. **The lead and the design session have no phases in that sense at all**: one runs until it
hands over, the other until the design is settled.

**That is a correction of what #1042 landed on 2026-09-10, not an exception to it** (#1048, decided
by the user the same day). That sentence read: *"Nine rows take four icons, because the icon encodes
the **state** and not the kind of work"*, and said in as many words that this is why there is *no
release icon, no design-session icon and none for a bundle*. **It was already not true of `👑`** —
the lead is a role rather than a stage of work, and it had an icon from the start — so the principle
was never *state and not kind*. Both wordings are kept here, dated, because the older one will keep
arriving in an inherited prompt and a bare replacement cannot say which is newer. **The set is now
five and is still closed**: a sixth needs the same argument — a role with no phases — and not a
preference.

**Pick codepoints that need no variation selector, and check any substitute the same way before
adopting it.** A title typed `⚙️` is `U+2699 U+FE0F` and one typed `⚙` is `U+2699`: different
strings, comparing unequal, so an emoji requiring VS16 turns the sweep's one string comparison into
a normalisation problem. The five here are clean — `⏳` U+23F3, `🔨` U+1F528, `✅` U+2705, `👑`
U+1F451, `🎨` U+1F3A8, none carrying FE0F. **This is the row of the decision with machinery behind
it**, so it is checked rather than remembered. **The rule earned its keep on its first use**: `✏️`,
`🖌️` and `🗺️` were the obvious candidates for design and all three carry `U+FE0F`, which
disqualified them on that ground alone; `📐` U+1F4D0, `💭` U+1F4AD, `🧭` U+1F9ED and `🧩` U+1F9E9 are
clean and would each have served.

**A design session's title leads with `🎨` while it runs and with `✅` when it is finished**, and
that ordering is the whole of why the sweep is untouched: the done icon stays the prefix and the
role icon stays with the subject, so a finished design session still says what it was. A bare
`✅ badanie autentyczności[#1008]` would lose that, and the issue number that carries identity for a
worker does not exist here — which is the reason design needed a row at all. **Its bracket takes the
pull request that carried the ADR**, not an issue number: a design track produces several issues and
none of them is its number. `Design[#1008]` in the live register had already done this by instinct,
and #1042 left it deliberately open.

**`===> Leader <===` survives, with the icon in front of it.** The proposal was to shorten it to
`👑 Leader`; the user kept the arrows on 2026-09-10, and they are shouty on purpose. The way a
session reaches the lead is *find the session whose title is the lead's and whose `cwd` is under
this repository* (*A pooled worker reads nothing until it is assigned*), never an identity a message
claims for itself — and a lookup against a bare word can miss the session or half-match something
else. The icon goes in front; nothing else about that title changes.

**A lead that has handed over takes `✅` like any other finished session.** That row is machinery
rather than legibility: to the worktree sweep a handed-over lead **is** a finished session, and it
is removed on the same comparison as a spent worker.

#### The changeover from `[DONE]`

**Sessions titled `[DONE] …` exist at the moment this lands, so the sweep accepts both spellings
during the changeover**: a title beginning `✅` **or** `[DONE]` is finished. Two string comparisons
instead of one costs nothing, and what it buys is that no live session has to be renamed before the
file does — a lead reading a mixed register is never sent to *ask the user* about a session that
plainly finished.

**It ends when the register is clean, which is checkable rather than dated.** The table above no
longer contains `[DONE]`, so no new title can acquire it: the set carrying it closed on 2026-09-10
and only shrinks. The backlog review already asks whether every session's title matches this table
(*Keeping this file honest*), and the first review finding none of them carrying the bracket is when
the second comparison can go. **Whoever drops it edits this section and both sweeps together** —
the same enumeration lives in three places, which is what *And the enumerations shrink with the
table* is about below.

**Renaming the live ones is the lead's**, and machine-local: the session list belongs to the app and
not to this repository. Nothing here asks a session to rename another one.

**`#NNN` is the issue and `#PPP` is the pull request**, which needs saying because #975 records the
format as `#XYZ[#NNN]`. It is the same format with the placeholders renamed: `#NNN` already means
*the issue* everywhere else in this file, the worktree sweep below included, and giving it a second
meaning three lines from its first would read as two conventions rather than one.

**So a worker renames itself twice, and the two renames answer different questions.** On assignment
it takes the issue number and swaps `⏳` for `🔨`, because the lead is not there at that moment and
the worker is. On opening its pull request it takes the bracket — and until that moment there is no
number to put there, which is why the second row carries none. `✅` goes on when the work is
finished, by the session if it is still awake and by the lead otherwise, since the lead is who
learns that a pull request merged.

**The bracket is for a person, and it answers the other half of the question the title asks.** The
issue number says what a session was *for*; the pull request number says what came *out of* it.
Without it the lead reads its own session list and must still go and ask GitHub which pull request
belongs to which session — the same shape of lookup the done marker was introduced to remove,
surviving in the half of the title nobody had touched.

**That the bracket appears at push time rather than at the done icon is the lead's reading rather
than the user's decision** (#975), and the alternative it was chosen over was brackets on a finished
session only. That one loses the number for exactly the window in which a run is being watched and a
branch is being updated — which is the window the number is for. The objection to a second rename is
that it is one more unenforced step; the answer is that the first rename is unenforced too, so what
changes is how many such steps there are and not what kind of thing this is.

**The estate arrived at the same format independently, and that is evidence rather than trivia.**
darkroom is running `[DONE] #89[#92]` and `#90[#94]`; the lead noticed the spelling there, and the
user asked for it here. No rule is shared between the two projects, and since the cross-project
process layer was stopped on 2026-09-08 there is nobody left to coordinate one. **It is convergence,
not a port**, and the distinction is recorded because *Verification, not trust* has the opposite case
on file: two claims imported from that same sibling project, true there and false here, which reached
this file and were caught only by reading the diff. Two projects reaching one format from one problem
is a different kind of argument from one project copying another. **What converged is the bracket**,
and darkroom still spells the finished marker `[DONE]` — that is their register and not a stale copy
of this one, so do not sweep it into an icon from here.

**A session holding several issues spells them all, separated by `/`** —
`🔨 #997/#998/#993/#996: collaboration.md` — and the theme becomes what the issues share, which is
normally the file. Added on 2026-09-08 (#993), when three of that day's sessions had no correct
title available and each invented one. It is the vocabulary catching up with the decision in *It is
about handoffs, not arithmetic*: bundling by shared file is legitimate, so the fixed vocabulary
needs a spelling for it. The bracket behaves as it does everywhere else — `🔨 #997/#998[#1001]` once
the pull request is open, and `✅` in front once it is finished.

**This row is legibility, not machinery**, and saying which of the two it answers is the thing the
last three amendments have each had to state. The done icon remains the whole test the sweep runs
and it is a prefix, so any spelling that keeps it in front is safe by construction. What the row
buys is the user reading his own screen and seeing at a glance that one session is answering four
issues rather than guessing at a theme that names none of them.

**The separator is `/` because two sessions have now reached for it and the alternatives cost
something.** `+` is how the lead writes a bundle in prose and reads as arithmetic in a title; `,`
wants a space after it, which spends the width a fourth number needs. Nothing turns on the choice,
which is why it is settled by convention rather than argued — but it is settled, so that the next
session does not spend a turn inventing it.

**One shape is deliberately left with no spelling: a bundle that opens two pull requests.** These
sessions open one, which is what a shared file makes natural, so the bracket above is the whole
story in practice. Inventing a spelling now, for a case nobody has met, is how a vocabulary
acquires a row that cannot be checked against anything.

**And the enumerations shrink with the table — a simplification, and not a new guarantee.** The
worktree sweep's list of non-done titles (*A held session's worktree is not stale*) and its
restatement in `backlog-review.md` used to enumerate the working title *shapes*, and each lengthened
twice on 2026-09-08 as the vocabulary grew (#975, #993). With one icon per state they name the
working icons instead — `⏳`, `🔨` and, since #1048, `🎨` — and a new title *shape* no longer
lengthens either, though a new *icon* still does. **The failure direction is
unchanged**: a title with no icon in front falls through to *ask the user*, exactly as one with no
`[DONE]` did, and the list is still descriptive rather than a decision procedure — this file already
argues that a longer one invites being read as one. **So this does not make the sweep safer than it
was.** It makes it shorter, and it removes an amendment that has already been forgotten once.

**The done icon is the load-bearing half, and it is what the worktree sweep tests.** Everything else
in the table is for the user reading his own screen; the leading icon is for a machine. It replaces
*resolve the worktree to its session, then go and establish whether its pull request merged* with a
string comparison, and it covers the case that test could not see at all — a session that finished
without ever opening a pull request. **`✅` serves that identically to `[DONE]`**, on the one
condition the variation-selector rule above states.

**The bracket must not become a second test, and the reason is worth stating before somebody
reaches for it.** It looks machine-readable and it is not: it is unenforced, it arrives later than
the title it is added to, and it is legitimately absent from every session that has not pushed yet.
A sweep keyed on it would read *pooled* and *working, mid-implementation* as the same thing while
appearing to have checked something. The sweep needs one prefix and has it.

**One task per worker and no recycling** (*The pool of generic workers*), so `✅` is terminal: a
spent worker is never renamed back to `🔨`. That is why the word is *spent* rather than *idle*.

**What this convention cannot do, said rather than assumed.** Nothing enforces any of the three
renames. A worker that is assigned and does not rename still reads `⏳ Worker N`; one that opens a
pull request and does not re-title looks like one that has not pushed yet; one that finishes and
does not gain its `✅` still reads as working. **All three errors leave a worktree standing**, which
is the safe direction — the sweep never removes on a missing marker — but it means the register
drifts toward *too many* live-looking sessions, never toward too few. The middle one is the mildest
and the only new one: it is invisible to the sweep, and it costs exactly the lookup the bracket was
added to save. The backlog review asks after the missing icons for that reason (*Keeping this file
honest*), and a review finding several is reporting a missing mechanism rather than a careless
session.

**The lead renames the outgoing lead**, since a session that has handed over is by definition no
longer acting. `✅ Leader YYYY-MM-DD` carries the handover date, not the date the session started,
because what a later reader wants from that row is when this project changed hands.

## The loop

1. A backlog review produces an order (`backlog-review.md`).
2. The lead spawns a task session with a **self-contained prompt**: the issue, the branch name, what
   is out of scope, which files a parallel session is holding, the decisions the user has already
   made, **how to reach the lead**, and — for a worker from the pool — that the drill's fetch and
   branch cut come **before** it reads the process files (*A pooled worker reads nothing until it
   is assigned*).
3. The session works, and asks the lead whenever it is blocked.
4. The session commits on its branch, rebases onto `main`, re-runs the checks, pushes, and opens a
   pull request.
5. The session **reports back to the lead**: what landed, on which branch, which pull request, what
   was verified and how, what was left out and why, and anything it noticed outside its scope.
6. The lead **verifies the work in the repository**: the diff, the migration SQL, the issue's *Done
   when*, CI. This is a check of the change as written.
7. The lead **collects the user's go-ahead**. Where the change is one a person looks at, that
   go-ahead is the user having **looked at the branch running** — a second act, not the same one,
   because it cannot be done from a diff, and the lead raises the stack for it (*No browser
   verification* below). **A pull request inside the `Detect changes` safe list is the exception
   and needs no go-ahead** — *A pull request no CI job can speak to skips all four*.
8. The lead **re-reads the head it is about to merge**, merges the pull request and closes the
   issue (*Who moves a branch that has fallen behind*).

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
hands the close to GitHub at merge time, which is exactly the human step 8 above puts *after*
verification.

This is the one rule here the platform works against, so it needs stating rather than reasoning
about: every convention outside this repository says to write `Closes`, and there is no repository
or GitHub setting that turns the keywords off.

**It is not only the reference line.** GitHub matches the keyword wherever it appears, so a sentence
of ordinary prose that puts the verb in front of the number arms it just as well — the pull request
adding this rule did exactly that twice in its own body, the second time while quoting the first
mistake in order to explain it. Read the reference back rather than the text:
`gh pr view <n> --json closingIssuesReferences` returns `[]` when the **body** is clean — and only the
body. **That query does not see commit messages at all**, which was measured against a throwaway
pull request whose sole commit said `Closes #914` over a body with no keyword in it: the query
answered `[]` while the merge would have closed the issue (#790). So the by-hand check every
session has been told to run covers half of the rule stated above, and the missing half is the
half a rebase-merge repository replays verbatim onto `main`. The job below covers both.

**Read it back again at the moment auto-merge is armed**, and not only when the body is written.
Arming is the last point at which a person is looking: the pull request then merges when GitHub
decides the five checks are green, so a keyword that survived the body fires with nobody watching and
the issue closes before step 8 of *The loop* has happened at all. Noticed by the #803 session (#854).

#783's body opened with `Closes #780 (the lead closes it, not this pull request — the reference is
here for the trail)`. GitHub does not read the parenthetical: merging #783 closed #780 one second
later, at the merge timestamp, before anything had been verified. #784 carried `Closes #781.` for
the same reason and was changed by hand minutes before it merged — that is a catch, not a control.

#### The check that enforces it

Since #790 a job named **`Closing reference check`** runs on every pull request in
`.github/workflows/ci.yml`, and everything above stops depending on anybody remembering it. It needs
no checkout and answers in about three seconds.

**It reads two sources, because they need different instruments.** The body goes through
`closingIssuesReferences` — GitHub's own parse of what it will act on, which no regular expression
can beat and which a regular expression would actively lose to: **a keyword inside a code span is
inert**, measured on the pull request that added the job, whose body needs to quote the trap in
order to explain it. Put the same clause in backticks and the query goes from `[780]` to `[]`. The
commit messages are matched by pattern instead, because of the paragraph above — the query cannot
see them.

**It is deliberately not gated on `Detect changes`.** Every other job asks whether a change touches
the application; this one asks what the pull request *says*, which is independent of which files it
touches. Both incidents that produced this rule were documentation-only pull requests — squarely
inside what that gate skips — so gating it there would switch it off in the case that produced it.

**It fails closed.** If the API cannot be reached it reports red, because green here means *safe to
merge*. `Detect changes` fails the other way for the opposite reason: its safe direction is to run
more, not less.

**Renovate is unaffected**, which had to be established before the job was written rather than
after: a dependency batch merges itself with nobody watching, so a check that failed one would stop
an automerge silently — the failure mode *Automerge is the one exception* warns about for that whole
arrangement. Renovate renders `#595` in upstream release notes as `#&#8203;595`, a zero-width space
GitHub does not parse, and its commit messages are a single `chore(deps):` line. All 80 of its pull
requests here pass.

**The evidence that it fires is the job's own pull request.** The first push carried
`… and closed #780 one second later` in both the body and the commit message — an ordinary clause of
prose, written while explaining the trap, which is #787's mistake exactly, made by the session
building the guard against it. The check went red in three seconds and named the issue. Nothing was
armed deliberately and nothing broken reached the branch: [that run](https://github.com/michalwy/stamporama/actions/runs/34156034548) is an accident
being caught. Beyond that the script was run against **all 130 pull requests in this repository's
history** — it passes 129 and fails one, #783 — and its commit pattern over all **971 commits** on
`main` gives 49 hits, every one genuine, and no false positives.

**The user decided on 2026-09-06 that it is a fifth required check**, so that an armed pull request
cannot be merged rather than merely warned about. The `name:` is `Closing reference check`, and
ruleset `22358128` has required it since 2026-09-07. **The lead added it only once the job was green
on `main`** — a required check that does not yet exist there never reports, so it sits as `expected`
for ever and nothing in the repository can merge. The order was: merge the job, watch it report its
context on a real pull request, and only then put that exact string into the ruleset.

**Then the count had to catch up, and the sweep is the part worth keeping.** The sentence that stood
here said *four places say so* and offered `git grep -nE 'four (required )?(checks|jobs)'` to find
them. It was wrong twice, in the two ways this file already records under *Verification, not trust*:

- **It undercounted by eighteen.** The four it named — the protected-`main` bullet in `AGENTS.md`,
  the ruleset list below, and two `description` fields in `renovate.json` — are the places a person
  thinks of. The other eighteen are where the claim had spread on its own: an automerge boundary, a
  never-alone criterion, a step of the merge loop, an aside about what the showcase is not, two
  comments in `ci.yml`, and a counterfactual in `release-versioning.md` about a release that no
  longer happens. **And all twenty-two are summaries.** Since #937 the count is *stated* in
  [`.github/rulesets/main.json`](../../.github/rulesets/main.json) and nowhere else; every sentence
  in that list describes it. A sweep of the prose is now the second half of the job, and the
  artifact is the first.
- **And the expression missed two of its own targets.** This file is hard-wrapped at 100 characters,
  so `the four required` / `checks are the verification` falls across a line break where no phrase
  match can see it. It returned a plausible subset and looked like it had worked — #896 and #905 in
  a third costume.

**So match the fixed word and classify every hit.** `git grep -nw four` over `AGENTS.md`, this file,
`renovate.json`, `.github/workflows/ci.yml`, `release-versioning.md` and the two files #937 added
under `.github/rulesets/` returned **48 lines and 50 occurrences** on 2026-09-07: **22 lines
carrying 24 of those occurrences stated the live count and became five, and 26 lines kept the number
four.** Report both halves wherever a sweep like this is reported. That was written here as a
guarantee — *a sweep that states its own count cannot return a silent zero* — and it is not one:
a count computed over an instrument's empty output says nothing about whether the instrument ran
(*Sweeping for a claim*, under *Verification, not trust*, where the guards and their boundary now
live in one place). Report the count anyway; it is cheap and it has caught things.

**And draw the boundary at the claim, not at the file — because the authoritative record contains
the word zero times.** `main.json` states the count as an array of that many objects. No expression
over the word can see it, and no hardening would have helped: the failure is not the pattern but the
assumption that a claim is made in words at all. The artifact landed an hour before this change and
its stale copy would have shipped with it, caught by reading the branch. **That is an argument for
having exactly one authoritative place, not for sweeping better.** Prose drifts and can at least be
swept for; an array cannot be swept for at all — which is why the artifact is the record and every
sentence about the ruleset is a summary of it.

**The same error one level up produced the file list.** It came from the lead's brief, drawn from
the places that brief had thought of, and two of the three misses sat in a file it named **out of
scope**: `ci.yml`, carrying one claim about what the ruleset requires and one counting the contexts
a suppressed workflow would leave `expected` — both about the ruleset rather than about the gate —
with a third comment there classified as safe by its number while the noun it counted had gone
wrong. `release-versioning.md` carried the last, in a file nobody had listed because it is about
releases. A file list is a convenience for running the grep. It is not the scope, and it inherits
every blind spot of whoever wrote it.

**And a word sweep does not find every wording of the word.** The stale count also survived spelled
`fourteen`, in `.github/rulesets/README.md` and in this file — invisible to any expression matching
`four`. It was a pre-sweep estimate that travelled from a brief into the durable record, and it came
to rest in the one file whose whole thesis is that prose drifts from what it describes. Both copies
were found by reading, not by sweeping. **Ask what else asserts this, and in what form**, before
choosing an expression at all.

**And the last one is the worst, because the tool answers honestly.** Checking whether this branch
had altered the ordering rule above, the lead searched the right file for the right phrase —
`grep -c 'in this order'` — and got **0**. It wraps as `two acts, in` / `this order` across the same
100-character break, so it was never present in that form; `grep -cw order` gives 10. **The grep did
not fail: it ran and exited 1**, which is the truthful report of *no match* and is byte-for-byte the
truthful report of *not present*. So #932's guard cannot help here — that one separates *did not
run* from *no matches*, and this is a real no-match that means the opposite of what it looks like.
What it nearly produced was the conclusion that a session had changed something it had reported
leaving alone. **A hardened sweep is still a sweep**: the count, the exit status and the fixed word
are three guards against three different failures, and none of them makes a search a substitute for
opening the file. One step further, because this instance is the one that shows it: **the guards
protect the instrument; the remaining failure is the question** (#942). Every other instance above
is a search that could not run properly, which is what those three are aimed at. This one ran, and
asked for the wrong thing.

**The 26 are what makes a careless sweep worse than none.** Most are about the **four jobs gated on
`Detect changes`** — a different four, which did not change, because `Closing reference check`
carries no `needs:` and runs on every pull request. The rest are roles, sessions, steps, suites and
dated incidents that were never about required checks at all. Changing any of them would be a
regression introduced by the fix. **Five of those 26 needed the sentence around the number corrected
even so**, because a documentation-only pull request no longer skips everything it must wait for:
it skips four of five, and the fifth can be red.

## How the lead reports to the user

**Every reply from the lead ends with a status table.** Detail first, in prose; the table last.
Decided by the user, and confirmed on 2026-09-08 when he asked for the shape to be written down so
that it survives a handover.

**Polish to him, English everywhere else** — GitHub, the repository, and messages between
sessions. This includes the table. An inherited handover chip has said the opposite (*statistics
tables in English*); it is wrong, it will keep arriving, and it is overridden deliberately rather
than followed.

### The table

Three columns: **id**, **co** (what it is), **stan** (where it stands). One line per row —
anything needing a paragraph goes in the prose above, and a row grown to three lines is a sign
the prose is missing.

| mark | meaning |
| --- | --- |
| 🔴 | needs him, or is broken |
| 🟡 | in flight — a CI run, a session working, a question sent |
| 🟢 | done **and verified**, not merely attempted |
| ⚪ | queued, or context that could change |
| 🔵 | standing context that does not move |

**The mark and the id share the first column**, as `🔴 D20`. A row with no id takes an em dash —
`🟢 —` — which is what most 🟢, ⚪ and 🔵 rows look like, since only things he must answer get
numbered. Do not add a fourth column for the mark: at a glance the left edge should read as a
column of colour, and a separate column puts a gap through it.

### What each column actually holds

**`id`** — the mark, then the id where there is one. Nothing else.

**`co`** — one line. **Issue numbers are links**, and identifiers that are typed or copied go in
code spans: a branch, a commit, a flag, a query parameter, a session title. He acts on these, so
they are marked as things to act on rather than described.

**`stan`** — a short fixed vocabulary, not a sentence. The whole point of the column is that it can
be read down rather than across:

| stan | when |
| --- | --- |
| `czeka N h` | waiting on him, with the age — see below |
| `czeka na Ciebie` | waiting on him, asked in this same reply, so no age yet |
| `w locie` | 🟡 rows: running, sent, or being answered elsewhere |
| `zrobione` | 🟢 rows, and only once verified |
| `do kolejki` | ⚪ rows that are ready and waiting for a worker |
| `do decyzji` | ⚪ rows that are ready and waiting for a judgement, not a worker |
| `kontekst` | 🔵 rows |

**Row order is by mark, not by age or by id**: every 🔴 first, then 🟡, 🟢, ⚪, 🔵. Within the 🔴
block, put what he can settle in one word above what needs him to think — a release or a look
before a design question. He reads from the top and stops when he stops; the order decides what he
sees.

**One 🔵 row is always the free-worker count**, in bold, and it is the last row in the table.

### A worked example, because prose about a layout is not the layout

| id | co | stan |
| --- | --- | --- |
| 🔴 D20 | Release v0.135.0 — 26 commitów, `main` zielone na `b63117f` | czeka 13 h |
| 🔴 D1 | [#849](https://github.com/michalwy/stamporama/issues/849) — redesign paska zaznaczenia | czeka 39 h |
| 🟡 — | CI na [#965](https://github.com/michalwy/stamporama/pull/965) | w locie |
| 🟢 D28 | Pięć worktrees usuniętych, `prune` czysty | zrobione |
| ⚪ — | Plan trzech sesji z przeglądu backlogu | do kolejki |
| 🔵 — | **Wolnych workerów: 0** | kontekst |

**Every open item, every time — the table is not a diff.** Restating what he has already seen is
the cost; being able to answer *"D3: nie"* without going back to find what D3 was is what it buys. A
table that showed only what is new makes the oldest item the least visible, which is precisely
backwards.

### Ids

**Stable, and never reused.** An id attaches to a question when it is first asked and stays with it
until it is answered, however many replies that takes.

**The counter does not reset at a handover if its ids are still live.** An inherited chip may say to
reset; do not, when the open set still contains D1–D5. Continue past the highest id in use and say
so once. This is not pedantry — the held file and his own memory of a question are both keyed
by that id, and reusing D1 for something new silently rewrites both.

### The three things a row must carry

- **A 🔴 waiting on him carries its age.** *"czeka 38 h"*, not *"czeka"*. Nothing else in the
  table makes a question that has been open for two days look different from one asked this morning,
  and the age is the whole argument for answering it.
- **A question names the issue it blocks**, where it blocks one. Five of the six open questions on
  2026-09-08 each sat on an issue that could not be worked until it was answered — which is
  a different and much stronger claim than *he has not replied yet*, and it was invisible until the
  rows named them.
- **The count of free workers, in every table.** A tile can only be clicked at the computer; a
  question can be answered from a phone. Reporting the count in every reply lets him top the pool up
  when he happens to be at the machine rather than when the lead runs out
  (*The pool of generic workers*).

### And never the blocking question menu

The interactive question tool stops the session until he answers, which is the opposite of the point
when he is away from the machine. **Ask in a row and carry on with everything the answer does not
block** — the same rule *Questions are asynchronous* gives a task session, applied to the lead.

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

**On a rebase-merge repository the diff is not the whole of what lands: read
`git log origin/main..<branch>` as well.** Every commit on the branch becomes a commit on `main`, so
a clean net diff says nothing about what is replayed. #881's branch carried a deliberate type error,
pushed in order to photograph a red `Static checks`, and the revert of it. The lead reviewed the net
diff and the file list, both clean — the revert had already been applied, so the change as a whole
introduced nothing — and never looked at the commits. `main` now carries a commit that does not
compile, and in a linear history with force-push blocked that cannot be undone: a `git bisect` across
that range lands on it for a reason unrelated to whatever is being bisected (#891). Nothing is broken
at `HEAD`; the whole cost falls on whoever reads or bisects the history later.

**A deliberate breakage goes on a throwaway branch, never on the branch that will merge.** The
session did nothing wrong by its brief — it was asked to *demonstrate* a red run rather than assert
one, which was the right instruction and produced the best evidence in that pull request. **Nobody
said where.** Push the breakage to a branch that is allowed to die, read the run, and let the pull
request quote the output and link to the run. The evidence is identical and nothing enters `main`'s
history.

**Whether *every* commit on a task branch must build is deliberately left open (#891).** That is the
wider rule which would also have caught this, and it is a much bigger claim: it would forbid an
ordinary work-in-progress sequence in which a commit compiles only once the next one lands. Nobody
has weighed that trade, so it is **not** a rule here — do not enforce it as though it were, and do
not write it in until it has been decided.

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
logic, `test:integration` is server-side, and `Closing reference check` reads what the pull request
says — so nothing in the five checks exercises a React Query cache, and nothing in them looks at a
screen at all. Green means *the failure modes these five can see did not occur*, and **which failure
modes they cannot see** is worth asking of any change, not only of a bump.

**A correction is verified by grepping for the retired claim, not by re-reading the passage you
fixed.** #880 had stated a local speed-up ratio as a fact about CI, noticed, and shipped the
correction as its own commit — deliberately, because the wrong number had reached the durable record.
That commit (`5e89146`) reached `src/lib/db.ts` and the `platform.md` bullet the correction was
*about*, and **missed a second bullet four lines away that merely mentioned the number**. So the file
opened by asserting `92% of CI's wall clock` as fact, with the bullet below it teaching against
exactly that error; a reader stopping after the first took away the wrong number *and* the wrong
habit. `bf69b84` is the second correction that should not have been needed.

**The failure is structural rather than careless**, which is why the answer is a procedure and not
more care: correcting means editing the place you reasoned about, and a claim spreads to the places
you did not reason about — a sibling paragraph, a code comment, a pull request body, an issue, a
closing comment. The correcting edit goes where the thinking is; the stale copy sits where it is not.
This project multiplies those copies on purpose, writing long prose beside its code, with the same
figure often in a schema comment, a topic file and an ADR.

**So state it as a grep, not as care.** "Be thorough" is not a procedure; `git grep '92%'` across the
whole tree is, plus a look at the pull request and issue text if the claim ever left the repository.
The #880 session's own words are the part worth keeping: *a correction is not done when the thing you
were thinking about is fixed; it is done when the retired claim does not appear anywhere. That is a
grep, and I did not run it until you pointed at the line* (#854).

### Sweeping for a claim

**It runs twice, and the pass nobody writes down is the first one.** Run *after* the edit, the sweep
is a **check** — did I miss a copy of what I just changed. Run *before* it, the same command is
**scoping** — what is this claim, and therefore what does the edit have to cover. The rule above
states only the second, and every word of it reads as after-the-edit; the #975 session ran it first,
and its boundary question then arrived as *this list is incomplete* rather than *did I miss
anything*. **Keep both** (#979). They answer different questions, and the after pass is the only one
that can catch a copy the edit itself created.

**Scoping first is what makes *a file list is not the scope* actionable** rather than a warning you
can only agree with afterwards: a brief's file list is where the search starts and never where it
stops. #975's brief named one section and put two files out of scope; the vocabulary it was changing
was enumerated in three places and the change broke two of them. Found while scoping, that cost a
round trip with the lead. Found while checking, it would have cost the edit.

**Then the guards — three of them, against three different failures.** Each is cheap, each has
caught something, and each has since been undercut, which is why this section ends where it does
rather than on a guarantee.

- **The count.** Wrapping each hit in context with a *mandatory* trailing quantifier —
  `grep -oiE '.{140}claim.{200}'` — matches nothing whenever a hit lands within 200 characters of a
  line end: where every hit does, it exits 1 and prints nothing, byte-for-byte what a clean tree
  prints, and where only some do it exits 0 and looks like it worked. That is how #910's first sweep
  lost a stale claim it had already found. **Shorter lines make it worse rather than better**, since
  they create more line ends. So run `grep -c` or `grep -n` first and check the total against what
  you classified (#896, #905).
- **The exit status.** `<pattern> || echo clean` fires on the tool's *error* as readily as on a
  clean result, so an invalid pattern prints the all-clear. For that idiom to be sound, non-zero
  would have to mean *no match*; it also means unreadable path, unsupported flag and rejected
  pattern. The bounded form `.{0,200}` is one of those here — the `grep` in a session shell routes
  to ugrep, which calls it *"exceeds complexity limits"*. **The rejection is at position 100, so
  `.{0,120}` fails too**: reaching for a smaller bound does not get you past it, and
  `/usr/bin/grep` accepts either.
- **The fixed word.** A phrase you half-remember is a phrase you are asserting. This file is
  hard-wrapped at 100 characters, so `the four required` / `checks are the verification` falls
  across a line break no phrase match can see. **The session that wrote this section lost a hit to
  it while checking its own work**: a fixed-string sweep for the retired claim below answered `1`
  where the truth was `2`, because the second copy wraps mid-sentence. Its positive control was
  green — the control's own string does not wrap — so only searching the word found the copy.

**The count is not the floor it was stated to be**, and that matters more than any single cause
because it was this section's own guarantee. *A sweep that reports its own count cannot return a
silent zero* is **false**: the #810 session ran one invocation per file inside a `while read` loop,
every invocation failed with the complexity error above, each exited 2, **the pipeline exited 0**,
and the job was recorded as complete. The count was computed over the empty output rather than over
the tool's success, so counting results cannot detect an instrument that never produced any. That
sentence stood in two sections of this file while it was wrong, in two wordings; both are corrected
here, and the second was found by sweeping before the edit rather than after (#932).

**Two directions the same signature arrives from that are not a grep failing at all.** A pattern
containing a newline makes `git grep -F` treat it as **two** patterns and OR them — 280 files, a
result that looks thorough and is a search for two common fragments (#970). **A flood is worse than
a zero**, because a zero prompts a second look while 280 hits prompt you to narrow the pattern,
which is the wrong response to a pattern that never matched the phrase. And a selector over a
**projection** does it with no shell involved: the rulesets list endpoint does not return
`conditions`, so a `--jq` filter on `.conditions` answers `0`, exit `0`, indistinguishable from a
repository that genuinely has none — and `jq`'s `?`, which exists to survive missing keys, is what
converts *this field is not here* into *no match*.

**The shell is half of the rest, and here it is zsh.** Unquoted parameter expansion is word-split in
bash and **is not** in zsh, so `git grep -n 'x' -- $F` hands git **one** pathspec literally named
`AGENTS.md docs/agents/collaboration.md`: nothing matches it, nothing is searched, it exits 1.
`for a in $WRITES` runs its body once over the joined string for the same reason. Both are
idiomatic, both are **correct in bash**, and neither is visible in review — which is how a snippet
copied from outside a zsh shell changes meaning on arrival. Use an array, `-- "${FA[@]}"`, or name
the paths inline.

**So two habits, and deliberately habits rather than a list.** Seven causes is not something anybody
recalls at the moment they are about to search, and a list of seven that reads as coverage is worse
than none:

- **Run a positive control.** Search for something you expect to **find** beside the thing you
  expect to be gone, with the same command shape. A retired-count of 0 next to a live-count of 0
  says the instrument is broken; 0 next to 2 says the correction landed. It is the one guard that
  catches the empty pathspec, the flood, the projection and the broken loop alike, because it does
  not ask *what* went wrong — it asks whether the thing could have found anything at all.
- **Check that the instrument ran, not only what it returned.** Capture the per-invocation status
  inside a loop rather than the pipeline's, and read stderr. What caught the `||` case was ugrep
  printing its diagnostic *above* the session's own "clean" line — a human noticing stray text,
  which is the kind of catch these rules exist to stop depending on. **And the way this habit is
  most often defeated is the pipe you added to tidy its output**: after a pipeline `$?` is the
  *last* command's status, so a search that failed and a filter that succeeded report success
  together. The #995 session added exactly the status line this habit asks for, piped the search to
  `grep -v`, and read `exit=0` off the filter while eight patterns had searched nothing (#996) —
  the status it checked was the filter's, not the search's. Capture the search's own status before
  anything is piped to it, or run the search alone and filter afterwards.

**The guards protect the instrument; the remaining failure is the question.** Everything above is a
way for a search not to run properly, and the count, the exit status and the fixed word are aimed at
exactly that. What survives all three is a search that runs correctly, over the right files, for the
wrong thing: `grep -c 'in this order'` exiting 1 on a phrase that wraps, `grep -niw -m2 precedent`
stopping at two unrelated hits, a claim stated as an array of objects in a file containing the word
zero times. Each ran, each exited truthfully, and each meant the opposite of what it looked like.
**Ask what else asserts this, and in what form**, before choosing an expression at all — and a
hardened sweep is still a sweep, which is not a substitute for opening the file (#942).

**And say what you believe the state is, in a form somebody can contradict.** That is the same rule
turned on a message rather than on the tree. Acting on a belief that came from a report, a brief or
another session rather than from the repository, state it: a wrong reading written down and
addressed to somebody is correctable by the one party who can see it is wrong, and the same reading
held privately is not. The #975 exchange had the lead and the session a turn apart in opposite
directions, each briefly certain about a state the other had moved past, and nothing broke because
both had said what they thought was true (#979).

## Memory is not versioned, and nothing expires it

Every session here, lead and task alike, starts by reading a store of durable notes that is **not in
this repository**: `~/.claude/projects/-Users-michalwy-stamporama/memory/`, machine-local, one file
per fact, with an index loaded into every session's context before it has read a line of code.
**39 entries as this is written**, and that figure is one to re-run rather than trust —
`ls ~/.claude/projects/-Users-michalwy-stamporama/memory/` answers it, for the reason this whole
section is about. No pull request can contradict the store, no required check can go red over it,
and no session reading it can tell an entry that is still true from one that stopped being true last
week. It is the only store of process this project has that is **unreviewable by
construction**.

This is `dev-agent`'s **R-012**, and our #941 audit scored it `absent` — zero hits across
`AGENTS.md`, `CLAUDE.md`, `README.md` and all three process files, which is what #947 was filed to
correct. The card counted 37 entries on 2026-09-07 and there are 39 two days later; that drift is
the smallest available demonstration of its own subject.

**The evidence is ours and none of it is a week old.**

- **The lead handover chip went stale within hours.** The incoming lead of 2026-09-07 was told a
  release had been cut when it had not, that the pool had free workers when it had one, and that the
  lead works from the main checkout when the tile had put it in a worktree. Three claims, written in
  good faith by a lead that knew the state, all false by the time they were read. **Each had a
  one-command answer** — `gh release list`, the app's session list, `pwd` — and the chip carried the
  answer rather than the command.
- **The store contradicted itself for a day, and the newer entry was the wrong one.**
  `project_docker_orbstack_path` (2026-09-07) records that `docker` is real here, lives in
  `~/.orbstack/bin` and is merely off a session's PATH, and says in as many words never to conclude
  a tool is missing from `command -v` plus a guess at install locations.
  `project_no_docker_in_worktrees` (2026-09-08) then concluded exactly that, from four locations not
  including `~/.orbstack/bin`, and told every later session that `pnpm test:integration` cannot run
  in a worktree at all. Both stood in the store at once with the index line carrying the wrong half,
  and **four sessions met this and two reached the wrong answer from a correct check** (#933). The
  wrong entry has since been removed and one `docker` entry remains.

  **Its removal is this bullet's strongest evidence rather than its retraction, and the sentence you
  are reading is the demonstration.** The paragraph above said *both entries are in the store* in
  the present tense; it merged at 08:48 UTC on 2026-09-08 and was **false within the hour**, caught
  by
  the next lead opening the directory (#960). Nothing announced the change: the store records no
  reversal, no pull request could have contradicted either entry while both stood, and no required
  check will ever go red over any of it. A section arguing that a claim about this store rots the
  moment it is written down does not need a better example than having done so itself, forty minutes
  after being merged, in the one paragraph whose whole subject was that hazard.
- **An entry that predicted its own obsolescence is still there.** `project_worker_pool_model` ends
  *"Being written into `docs/agents/collaboration.md` by issue #906; once that lands, read the file
  rather than this."* #906 landed — *The pool of generic workers* above is that section — so the
  entry is now a second copy of it, kept harmless only by a sentence its author thought to write.
  It is the only entry that names where its own replacement would land, and nothing removed it
  when the replacement arrived.
- **The process mandate lives in memory and in no repository.** The user delegated process decisions
  for this project to `dev-agent` on 2026-09-07, and the merge boundary that moved with it on
  2026-09-08 is recorded in a memory entry and nowhere in git. That is **one handover from being
  lost, or worse, from surviving after it has been withdrawn.** #958 is where it gets a home; this
  section is why it needs one.

**Three shapes, and only one of them has an invalidation path.** Sorting an entry is a decision taken
when it is written, and it is what makes the rules below cheap rather than a standing audit:

- **A working preference** — Polish in every reply, no browser verification, never `git add -A`,
  split independent scopes. Only the user falsifies one; no repository check ever will, and diffing
  these against the tree is pure waste.
- **A machine-local fact** — OrbStack's path, `~/Downloads` blocked by TCC, which ports a slot binds.
  Falsified by the machine rather than by this repository, and checked by running the command it
  describes at the moment you rely on it, which costs a second.
- **A claim about this project** — a design track's shape, the pool model, the merge boundary, a
  migration rule. **This is the only class the repository can contradict, and it is the class that
  rots**, because the repository moves and the entry cannot.

**So the write-side rule, and it is the half that shrinks the problem rather than policing it: a fact
this repository can carry goes in this repository, and the memory entry keeps a pointer rather than a
copy.** AGENTS.md already says where project knowledge goes — the matching `docs/agents/` topic file
— and this is the same rule seen from the other side. A pointer costs one line, survives the thing it
points at being rewritten, and turns a claim nothing can check into one a reader checks by opening
the file. `project_worker_pool_model` above is what a copy looks like after the file catches up.

**And a durable statement carries the command, not the fact the command answers.** That is the whole
lesson of the handover chip: a release version, a count of free workers, which checkout a session is
in, which issues are open — all of these have a one-line answer that is correct whenever it is run,
and writing the answer down converts something always current into something true once. It applies to
a memory entry and to a handover prompt identically, and it is the only one of these rules that costs
nothing at all to follow.

**A fact that lands in memory because there is nowhere else for it is a finding, not a filing.** It
means a document is missing, and the entry is a placeholder standing where that document should be.
The mandate is the worked example and it is why #947 and #958 are written with each other in view:
one says a fact of that shape does not belong in memory alone, the other gives this particular fact
its home.

**Then the read side, and its trigger is the change that invalidates — not a calendar.** Whoever
lands a process change sweeps the store for what that change retires, **in the same commit's
session**. This is not new discipline: it is the rule *Verification, not trust* already states — *a
correction is done when the retired claim does not appear anywhere* — with its scope corrected.
`git grep` stops at the worktree, and the store is outside it, so the sweep is
`grep -rn '<retired claim>' ~/.claude/projects/-Users-michalwy-stamporama/memory/`, counted before it
is classified, for the reason that section gives. The person landing the change is the one reader who
knows what it retires, which is why the trigger is there and not somewhere tidier.

**A superseded entry is rewritten to say what the rule is now *and* that it changed and when** —
never quietly replaced. An entry stating only the new thing cannot tell a later session that a
reversal happened, and a reversal is exactly what an inherited handover prompt will go on asserting
for as long as it is inherited. `feedback_polish_to_him_always` is the local worked example: it
records that the handover chip says statistics tables are in English, that this is wrong or has been
superseded, and that it will keep arriving and must therefore be overridden deliberately rather than
followed. An entry that had merely said *"Polish"* would lose that argument every time the chip was
read.

**Any session that meets a memory entry the tree contradicts reports it to the lead** (*Findings go
to the lead, not into new issues*). This costs nothing, because that session is already reading both
halves and is the only reader who ever holds them at once — which is also why it is worth stating at
all. It does not edit the store: the store is this project's own, and a session editing it is the
same overreach as a session closing an issue. It does not stop to investigate either; it says what
the entry claims, what the tree says, and carries on.

**At a handover the artifact to reconcile is the chip, not the store.** The outgoing lead writes no
state into it that a command answers, and the incoming lead treats every state claim that remains as
a claim to check before acting on it. R-012 asks that the handover prompt be enumerated alongside the
memory entries and here it is the sharper half of the two: it is the single artifact through which
every future lead inherits its understanding of this project, and it is the one nobody edits. **It
goes stale one clause at a time**, which is why it will not announce itself — a prompt that is
ninety percent right produces correct behaviour nine times out of ten, and the tenth looks like
ordinary diligence.

**And a backstop at backlog review, for the same reason the worktree sweep is one.** The write-side
sweep is the half that gets forgotten, so every review asks which process changes landed since the
last one — `git log --since=<last review> --name-only -- AGENTS.md docs/agents/
.github/workflow-rules.yaml .github/rulesets/` — and greps the store for each retired claim. It is
mechanical, it produces a count, and it deliberately does **not** ask whether anybody remembered to
sweep, because a question answerable only by remembering is this file's own failure mode wearing a
checklist (*Keeping this file honest*).

**The whole-store diff is deliberately not the rule, and that is a departure from how R-012 states
it.** The card asks that a process change *enumerate the project's agent memory and diff it against
the new process*. At thirty-nine entries that is a task nobody performs on the way to doing something
else, and **a rule that is skipped is worse than no rule, because it reads as coverage** — which is
this file's argument against the never-alone list's second criterion and against a sweep that reports
no count. The card's own evidence points the same way: ohm-sweet-ohm's four stale entries were found
*during* the change that invalidated them, and darkroom's one was found by enumerating fifteen, which
is a store you can enumerate. And the card answers itself, about its own registry, in the sentence
that matters most here — *the mitigation is not diligence, it is that every claim about a project
should be generated from something that project publishes*. That is the write-side rule above,
generalised. **A first enumeration of these thirty-nine has still never been run**, and #947 put it
out of scope on purpose, so that the rule was not written to justify whatever an audit happened to
find.

**What none of this catches, said rather than glossed.** An entry falsified by something that is in
no repository at all — a mandate withdrawn, a convention reversed in conversation — is invisible to
every sweep above, because the invalidating event leaves nothing to grep. darkroom found one of those
only by enumerating its whole store the day the mandate arrived. There is no detector for that class
here and none is proposed; the one thing that helps is the write-side rule shrinking the store toward
facts only the user can invalidate, so that the class with no detector is also the class that is left.

## A protected `main`, and what it changed

Since 2026-09-06 `main` is protected by a ruleset with **no bypass for anyone, the user included**:

- a pull request is required (0 approvals);
- **rebase merge only** — merge and squash commits are disabled on the repository, and `main`
  requires linear history;
- force-push and deletion are blocked;
- five checks must pass — `Static checks`, `Unit tests`, `Integration tests`, `Extension checks` and
  `Closing reference check`, the fifth added on 2026-09-07 (#790); these are the `name:` values of
  the jobs in `.github/workflows/ci.yml`, and they are **strict**
  (`strict_required_status_checks_policy: true`), so a branch must be up to date with `main` before
  it can merge at all. That last clause is what makes merges serialise; see *What may run in
  parallel*.

A direct `git push origin main` was attempted and rejected. This is verified, not assumed.

**The gate itself is in the repository, and the list above defers to it.**
[`.github/rulesets/main.json`](../../.github/rulesets/main.json) is a normalised snapshot of the
ruleset, fetched from the API and committed. The second bullet is not entirely the ruleset's, and
that is worth knowing rather than glossing: the ruleset narrows the merge methods to `rebase`, but
*which methods exist at all* is a repository setting, recorded beside it in
[`.github/rulesets/merge-settings.json`](../../.github/rulesets/merge-settings.json) (#945).
[`.github/rulesets/README.md`](../../.github/rulesets/README.md) carries the normalisation contract
for both, how to reproduce each, and the one rule that matters when either disagrees with GitHub.
**Where this file and those differ, those are right** — the bullets above
are a summary written for a reader, and a summary drifts from the thing it summarises without either
of them looking wrong. That is not hypothetical: it is what #937 was filed about, after a sweep found
the same claim asserted as live fact on twenty-two lines across five files.

Two consequences for anybody working here. **A change to how `main` is protected is now two acts, in
this order**: the pull request that edits the artifact, and the ruleset change on GitHub — which is
the lead's, and which nothing in git can perform. **And between those two acts a comparison of the
artifact against the live ruleset is legitimately red.** The artifact is the intent and GitHub is the
current state; editing the artifact to match GitHub makes the two agree by construction and is how a
control quietly stops being one. The full reasoning is in that README rather than here, because the
person who meets a red comparison is looking at `.github/rulesets/`.

**The first exercise of that order went the other way, deliberately, and it is not a precedent.**
#790 added the fifth required check as `artifact(4) → ruleset(5) → artifact(5)`, because #937's whole
argument was that the artifact's first commit had to **match** the live ruleset: a control whose
first green is also its first run cannot be told apart from one incapable of going red (#814). That
was the bootstrap, and it cost one ambiguous window. **The two directions are not equally
diagnosable** — artifact-first leaves GitHub *behind* the intent, which only a pending pull request
can produce, while ruleset-first leaves GitHub *ahead* of it, which is byte-identical to the
unauthorised-change signature the README tells you to report rather than absorb. From here the order
above holds, and that window does not recur.

**`git log` will mislead you about this.** Every pull request in this repository's history before
2026-09-06 came from Renovate; all feature work went straight to `main`. And the `(#769)`-style
reference in a commit title is an **issue** number, not a pull request — the convention predates
pull requests here entirely.

Three consequences:

- **Auto-merge is the normal path.** With the user's go-ahead in, the lead runs
  `gh pr merge --rebase --auto` and GitHub merges the moment the five checks are green. Without it,
  somebody sits watching CI for several minutes and nobody can tell whether the work has landed or
  whether it was forgotten. The user's decision still gates the merge; only the waiting moves off a
  human. **Arming it is not the same as landing it**: GitHub waits for a branch to *become*
  mergeable here and never makes it so, so an armed `task/` branch that has fallen behind stays
  armed and stays behind. Arming is also the last moment a person looks at the head, so the checks
  that belong at merge time belong here instead — both in *Who moves a branch that has fallen
  behind*.
- **A merged branch deletes itself** — `delete_branch_on_merge`, recorded in
  [`.github/rulesets/merge-settings.json`](../../.github/rulesets/merge-settings.json) rather than
  asserted here. The worktree does not — see *Worktree cleanup* below.
- **A rejected change leaves no trace.** In a linear history it simply drops out and whatever sat
  above it rebases down over the gap, where a merged branch would have to be reverted and leave both
  the change and its undoing in `main` forever.

### Automerge is the one exception, and where its boundary runs

Everything above says a **person** decides and the lead is who asks — step 7 of the loop, and the
sentence just above that the user's decision still gates the merge. **Renovate is the single
exception to it.** A dependency pull request inside the boundary below merges itself, with nobody's
go-ahead, the moment the five required checks are green. The boundary was decided by the user on
2026-09-06 and is expressed in `renovate.json`; #814 carries the reasoning and the citations.

**What may land without a person:**

- **`patch` and `minor` only**, and only for dependencies **outside the never-alone list** in
  `renovate.json`;
- as **one grouped pull request a week** — `weekly dependency batch`, opened early Monday — never as
  a stream of individual merges;
- by **rebase**, the only method `main` allows;
- behind the same five required checks as everything else, and no sooner than
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
  to all five required checks**, which is a different question and a sharper one, because automerge
  trusts exactly those five checks and nothing else. TanStack is the example: lint, typecheck and
  build see types, `test:unit` is pure logic, `test:integration` is server-side, `Closing reference
  check` reads only the pull request's text, and nothing in the suite exercises a Query cache or a
  Table interaction — so a minor that changes refetch or invalidation semantics goes green on all
  five and reaches the browser. Ask both questions before leaving something off.
- **Anything that is not a dependency update.** No feature, fix or documentation branch automerges,
  and no `task/` branch does — nothing in this repository merges itself but Renovate. For a feature
  or a fix the lead still asks and the user still answers. **A pull request inside the
  `Detect changes` safe list no longer needs the question** — documentation, and since 2026-09-08
  `renovate.json` with it — and that is a second licence rather than a second automerge: see
  *A pull request no CI job can speak to skips all four*, and the paragraph below for how to tell
  them apart. Note where that puts this very boundary: **`renovate.json` is where the automerge
  rules live, so a change to them is now the lead's to merge**, which the user decided knowingly
  (#970).

**How to tell an authorised exception from a broken process**, which is the reason this is written
down at all: somebody reading `main`'s history later will find merges nobody approved, and needs to
be able to tell which kind they are looking at. An authorised one is a pull request **opened by
`app/renovate`**, titled `chore(deps): …`, and merged with no human in the timeline — #561, merged
by `app/renovate` on 13 August, is what one looks like. **Renovate is the only actor permitted to
merge with nothing read at all.**

**There are now three authorised shapes, and they are not the same licence.** A Renovate merge has
had **nobody** verify it — the five required checks are the whole of the review, which is why the
boundary above is drawn so tightly. A pull request inside the `Detect changes` safe list, merged by
the lead, **has been read by a person, and by one who did not write it**; what was dropped is the
user's second yes after that reading, not the reading. **Process work in `.github/`, `scripts/` and
`package.json`, merged by the lead, is the third** — the same licence as the second, extended to
paths that run the whole suite rather than skipping four fifths of it (*Process work the lead may
merge*, below).

Each has its own signature in the history, and they are worth telling apart: Renovate's is opened by
`app/renovate` and merged with no human in the timeline at all; the second stays inside the
`Detect changes` safe list and reports four checks skipped; the third touches process paths, runs
everything, and is merged by the lead with a green run behind it. Anything outside those three
shapes that reached `main` without somebody having said yes is the process
failing, not an exception being exercised — report it as a finding rather than assuming it was fine.

**The second shape's membership is not stated here, and that is the fix for how this went wrong
twice in one day.** Named for its files rather than for its rule, the second shape read as
*documentation only*, and a `renovate.json` pull request merged by the lead — authorised, and the
right thing to do — matched none of the three shapes as they were then written. **A stale
authorisation list manufactures a finding against somebody doing the right thing**, which is the
most expensive way for a sentence here to go out of date: #958 found this list naming two shapes
when there were three, and #970 found it stale again the same afternoon.

**So the safe list is stated once, where it is executed.** The membership is the `case` glob in the
`Detect changes` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), and **that is
the record** — not because it is tidier but because it is the thing that actually decides, in the
same sense that `main.json` is the record of the ruleset and every sentence about it is a summary.
Prose naming the members is a copy that can drift from the gate while agreeing with every other
copy, which is exactly what two of them did. **Prose that points does not drift; prose that copies
does** (#975).

**The copies were counted rather than assumed, and there were more of them than the issue that
found them said.** #982 was filed about three: this section, *Keeping this file honest*, and
`backlog-review.md`. A sweep before editing found **six** statements of the membership — those
three, the opening of *A pull request no CI job can speak to skips all four*, the comment beside the
`case` in `ci.yml`, and the `case` itself. The undercount is the same mechanism the list itself
suffers from: whoever writes down where a claim lives enumerates the places they thought of.

**What each site keeps is decided by what changes.** The **names of the three shapes** change rarely
— once, from two to three — so they stay spelled out wherever a reader needs to recognise one.
**Membership changed inside a day**, so it is a pointer everywhere but the gate. That split is the
answer to the objection that a pointer costs a reader a jump: the checklist reader gets the count
and the names without leaving the page, and only somebody deciding whether a specific pull request
was inside the boundary — who has to be exact — follows the link.

**One copy is deliberately left in place**: the comment beside the `case` in `ci.yml`, which records
that adding a path grants the lead a merge licence over it, and which enumerates the entries four
lines above the glob it describes. A comment that far from the code it explains is the one drift a
reader catches for free.

The trade was taken with its cost stated: a weekly batch that breaks `main` **cannot be bisected,
only reverted whole**. That is accepted because the batch is patch and minor, outside the list, and
behind five required checks.

**An arrangement whose whole point is that nobody watches it is one where nobody notices it break.**
That is not a hypothetical here. Automerge was silently impossible from the moment `main` was
protected until #814: `renovate.json` asked to merge by squash, which this repository does not allow
and the ruleset does not permit, and *nothing anywhere said so* — five stale pull requests, one red
for eight weeks, thirteen further updates rate-limited behind them and visible only on the Dependency
Dashboard. So **every backlog review sweeps the open Renovate pull requests** and reports the red and
the stale ones (`backlog-review.md`). That sweep is not decoration on the automerge; it is the half
that makes the other half safe, and neither half may be enabled without the other.

### A pull request no CI job can speak to skips all four

Since #798, a `Detect changes` job runs first and four of the five required jobs are gated on its
output, so a pull request whose every file is inside that job's safe list reports those four as
**skipped** and is mergeable in seconds. **The membership is the `case` glob in that job** and is
not restated here — see *Automerge is the one exception* for why the gate is the record and every
sentence about it a summary. GitHub counts a skipped required check as
satisfied, which is why the gate is a job-level `if:` and never a workflow-level `paths-ignore:` —
a workflow that does not run reports no contexts at all, and the pull request would wait on five
`expected` checks for ever. The reasoning lives in full in `.github/workflows/ci.yml`, next to the
job.

**The heading no longer says *documentation*, and that is the change of 2026-09-08 (#970).** The
list was named for what its first three entries happened to be; what it actually holds is **paths
no job in this workflow can say anything about**. `renovate.json` is the fourth and it is not
documentation: **nothing in this repository reads it** — zero hits across `src/`, `scripts/` and
`extension/` — because it is consumed by Renovate's service on GitHub, so the four gated jobs never
had anything to report about a change to it. It is a single filename rather than a glob: `*.json`
would sweep in `package.json` and `tsconfig.json`, which is the opposite of what was decided. The
measurement behind it is small and cuts the same way either direction — `renovate.json` had been
touched five times in the project's history, four of them with no application file in the diff.

**The fifth is not gated, and it does run.** `Closing reference check` asks what a pull request
*says* rather than which files it touches, and both incidents that produced that rule were
documentation-only — so gating it here would switch it off in exactly the case that produced it
(#790). The heading is therefore exact rather than loose: four are skipped, one runs, and it answers
in about three seconds, which is why *mergeable in seconds* survives. What does not survive is the
inference that such a pull request has nothing at all to wait for. It has one check, and that check
can be red.

Two things follow for a session. **The list is a whitelist**: anything else — `package.json`,
`pnpm-lock.yaml`, `prisma/**`, `.github/**`, `scripts/**`, the compose files, `extension/**` other
than its `*.md` — runs everything, as does a tag and as does anything the detection cannot answer
confidently. And a pull request that merges in seconds is still a pull request the lead verifies;
the gate removes the waiting, not the reading.

**So the lead merges one without asking the user**, and reports what it merged — the user's other
decision that afternoon (#906). The authorisation reuses this whitelist exactly, and for the reason
the whitelist exists: where the four gated checks report *skipped* and the fifth answers in seconds,
there is no CI run worth waiting for, so the verification **is** the lead's read of the diff, which
this file already says in *What this is not*. What goes is a question whose answer was never in
doubt; anything touching `src/`, `prisma/` or the compose files still asks, as does a change to a
dependency itself — and `.github/`, `scripts/` and `package.json` moved out of that list on
2026-09-08, which the next section records. **It is not automerge** — a person still verifies, and
that person is the lead. **And it is not a licence to write one**: this authorises the merge and
says nothing about who produces the change, which is *The lead's licences are to merge, never to
write* above — the reading that section exists because the lead got wrong.

**Adding a path here grants that merge licence too, and for `renovate.json` the user took both
knowingly.** Membership does two jobs — which checks run, and what the lead may merge on its own
read — and the second is invisible from `ci.yml`, which is why it is written beside the `case` there
as well as here. So a `renovate.json` change is now the lead's to merge without the user's
go-ahead, **and that includes changes to the automerge boundary and to the never-alone list** that
*Automerge is the one exception* describes. Both consequences were put to him on 2026-09-08 and he
took both, in these words: *keep one list, add `renovate.json` there; I do not see a need to review
Renovate changes* (#970). **It is a priced decision, not an oversight** — a later reader finding a
merge licence over Renovate configuration should not "fix" it back, and the lead's own reading, that
the coupling argued for leaving the file outside the list, was refuted by the user and is recorded
in that issue. What the argument turns on is a judgement only he can make, so anybody proposing to
split the list in two (option A there) is reopening his decision, not correcting a defect.

### Process work the lead may merge

**Since 2026-09-08 the lead may also merge process work in `.github/`, `scripts/` and
`package.json` on its own verification.** Decided by the user, in the lead's own channel, answering
a question that named those three paths. It is the safe-list licence of the section above extended
to process paths, and the reasoning is the same: a person who did not write the change reads it, and
what is dropped is the user's second yes after that reading.

**What it is not.** These paths are **outside** the `Detect changes` safe list, so `Detect changes`
gates nothing away and the full suite runs. The verification is therefore *the lead's read of the
diff **and** a green run*, never the read alone — a stricter bar than the second shape, not a
looser one. And it does not reach product: `src/`, `prisma/`, the compose files and dependencies
still ask, as do backlog direction, issue closure, anything irreversible, and every change with a
surface, which also needs his look (*If nobody could see it, the user looks before the merge*).
**Nor is it a licence to write the change** — the same boundary as the section above, and for the
same reason (*The lead's licences are to merge, never to write*).

**Why this is written here rather than somewhere tidier, which is the part worth keeping.** For a
day this boundary was recorded in exactly two places, both outside this repository: the lead's own
agent memory, and the standing-authorisations file of a cross-project session that held process
authority for this project between 2026-09-07 and 2026-09-08. When an incoming lead checked the
second of those, **the boundary was not in it**: that session had never heard it from the user, and
said so plainly. The rule was live, acted on, and recorded by nobody with the authority
to record it. That layer was stopped the same day, which turned its file into history; had the
boundary still lived only there, it would have been lost with it, or worse, survived after being
withdrawn.

**So: a peer relaying the user's approval is not the user's approval**, and the instrument that
caught this was reading the file rather than believing the message. That check cost one command and
it was applied against a claim that would have *expanded* the lead's own authority, which is the
only direction in which anybody reliably forgets to run it. This is *Memory is not versioned, and
nothing expires it* arriving in governance rather than in practice, and it is why that section's
write-side rule — **a fact this repository can carry goes in this repository** — is stated there
as the load-bearing half rather than as advice.

**One judgement is deliberately left open, and it is the lead's reading rather than the user's
decision.** Three answers in two days about where this line runs suggests a path list may be the
wrong shape: the real distinction is *process versus product*, and paths are a proxy that fails at
its edges — `scripts/check-ruleset.mjs` is process, `scripts/e2e-db.sh` is arguably not. A rule
phrased on the distinction, with paths as examples, might survive better. Against that, a path list
is checkable without judgement, which is exactly why #906 chose one. Nobody has weighed the trade;
do not enforce either reading as settled.

### Rebase, then re-verify, in that order

Fetch, rebase the branch onto `main`, **run the checks again**, force-push the branch. With sessions
working in parallel, `main` moving underneath a branch is the normal case rather than an accident.

The re-run is the half that is easy to drop and the only half that is interesting. A suite that was
green before the rebase was green against a *different* `main`; all it establishes is that the
branch worked in isolation, which is not the claim anybody needs. Do it locally, because that is
where the checks get re-run by somebody who then reads the result. **Nothing here updates a branch on
its own**: an update happens because a person asked for one, and who that is depends on whether the
branch is still being worked on (*Who moves a branch that has fallen behind*, below).

**When the rebase pulled in a lockfile change it is four steps, not three: `pnpm install` goes
between the rebase and the suites.** Otherwise the installed tree is still the old one and the suites
verify against dependencies the branch no longer declares. **Check rather than reinstall every
time** — `git diff ORIG_HEAD --name-only -- pnpm-lock.yaml package.json` answers it in a second, and
a rule that says *always reinstall* will simply be ignored on the many rebases where it is pointless.

`main` moved **three times** under #867 and one of those moves was a `better-auth` bump; that session
noticed and reinstalled, and nothing in this file had told it to (#854). It matters more than when
the section above was written: with a Renovate batch draining alongside feature branches, a
dependency landing under an open branch stopped being the exception — on 2026-09-06 it happened to
most branches that stayed open for more than an hour.

### Who moves a branch that has fallen behind

**The session stops rebasing once it has pushed and reported; the lead updates the branch from
there**, with `gh pr update-branch --rebase`, and reads the CI run that follows. **That boundary is
a state and not a one-way door**: a re-brief hands the branch back, and the subsection below is that
half of it.

Both halves are separate claims and both are needed. **The session stops** because a further
re-verify costs a full local suite run and buys nothing CI is not about to run anyway: the discipline
above is for a branch **still being worked on**, and nothing had ever said where it ends. **The lead
updates** because otherwise the branch never merges at all, and because the lead is the one who then
reads the run — an `update-branch` costs one CI run and no local suite run, and that asymmetry is the
whole point.

#### A re-brief hands the branch back, and it is a state rather than an event

**The sentence above states the handover as something that happens once, and it does not.** A
session that has been re-briefed is working again, and the branch is its own again — nothing in the
event wording says so, and on 2026-09-08 both parties followed the file and collided over the same
commit (#933 / PR #980, filed as #984).

So read it as a state. **The branch is the lead's only while nobody is briefing the session**: the
session's from the brief until it reports, the lead's from the report until the next brief, and it
alternates as often as that happens. A report is not a door that shuts.

**Who announces the handback depends on where the brief came from, and both directions are needed.**

- **The lead re-briefs.** No announcement is required, because sending the message *is* the
  handback; what is required is that the lead then act on its own knowledge. Having messaged a
  session, do not run `update-branch`, do not arm auto-merge, do not merge, **and do not remove its
  worktree**, until it reports again. **Knowing and not acting are different things, and it is the
  second that failed here** — which is why this is written as a prohibition rather than left to
  follow from the lead being informed.

  **The last of those was not on this list until 2026-09-10, and its absence is the whole of a
  second incident.** The list stopped the lead re-merging and said nothing about the act it went on
  to perform — removing the worktree of a session it had re-briefed eleven minutes earlier, on the
  strength of the merge that had just happened. A prohibition list is read as complete by whoever is
  consulting it, which is why the act that is missing from one is more expensive than the act that
  is merely unwritten (*Merging a pull request is not the event that ends a session*, under
  *Worktree cleanup*).
- **Anyone else re-briefs.** Then only the session knows. The user reaching a session directly is
  not exotic here: *If nobody could see it, the user looks before the merge* has his comments
  during a showcase turning into fixes on the branch, and a design session talks to him by
  definition. None of that is visible to the lead, so **a session re-briefed by anyone but the lead
  tells the lead it is working again, before it starts.** One line. An announcement somebody must
  remember is the weaker instrument, which is why it is asked for only in the case where nothing
  else can supply it.

**It failed safe by one flag, and that is why a flag is named in a file that mostly states
principles.** The lead's `gh pr update-branch --rebase` rewrote the commit the session was amending;
the session's `--force-with-lease` refused with *stale info*, and it recovered by fetching and
rebasing its amended work itself. **A bare `--force` would have discarded the lead's rebase with
neither party noticing.** So: **force-push with `--force-with-lease`, never bare `--force`.** The
lease is what converts this collision from silent loss into a refusal somebody has to read — the
same reason this file spells `gh pr view <n> --json closingIssuesReferences` rather than saying
*check the references*. A guard that is one word long, against a failure mode no required check can
see, is worth its line.

**Nothing here closes the loop by itself, and that was got wrong twice before anybody checked:**

- **GitHub does not bring a behind branch up to date here** — `allow_update_branch` is off,
  recorded in
  [`.github/rulesets/merge-settings.json`](../../.github/rulesets/merge-settings.json) rather than
  asserted in this line (#945). Auto-merge waits for a branch to become mergeable and **never makes
  it so**, which is what makes the rest of this section necessary. The bullet used to end *"verify
  that yourself rather than trusting this line"* — a reader-by-reader habit standing in for a
  control. The artifact is the control.
- **Renovate's branches self-update because *Renovate* rebases them** — `automergeStrategy: "rebase"`
  in `renovate.json` — not because GitHub does. That is its bot, and a `task/` branch has none.
- **So a `task/` branch left armed and alone sits at `BEHIND` for ever.** #837 and #839 did exactly
  that.

**Two formulations were considered and rejected. Both are recorded because both are tempting.**

1. **"Skip the re-run when the bump looks unrelated."** It is a judgement about code the session has
   not read, which is the shape of reasoning this file warns against everywhere else. And it
   misidentifies the reason: the value of a local run was never that it might fail, it is that
   **somebody reads the result** — and once auto-merge is armed, nobody will.
2. **"Arm auto-merge and GitHub takes it from there."** False here, for the reason above, and the
   more dangerous of the two, because it sounds like the mechanism working. What it actually produces
   is a branch nobody is watching that never merges.

The #803 branch was rebased and fully re-verified **four times** while waiting to be merged — each
time a local run of all four suites plus a ten-minute CI run, with `main` moving *during* three of
them. Every one of the four re-runs caught nothing (#854).

**Draining a queue of verified branches is one branch at a time, and the head is re-read at the
moment of merging.** Both halves are the lead's merge loop and both failed on 2026-09-07 (#905);
they are written here together, under the verb they are about, because split across two sections one
of them gets read without the other. **The re-read half then failed a second time, on 2026-09-08, in
a way that went green** — which is why it is now three steps rather than one (#984).

1. **Update one branch. Not two.** `gh pr update-branch --rebase`, wait for green, merge — and only
   then touch the next. The intuition to update several at once is that their CI runs would overlap;
   the arithmetic kills it before either run finishes, because **merging the first invalidates the
   second**, which then needs another update and another run. Draining N verified branches costs
   N−1 update cycles: that is the floor, not a target to beat, and parallelising the updates does
   not lower it — it only spends the waste earlier.
2. **Re-read the head immediately before merging** — `gh pr view <n> --json headRefOid` —
   **against a SHA you wrote down when you acted, never one you have just fetched.** Verification is
   a snapshot and merging is a later act, and nothing else here says to re-take the snapshot at the
   moment of the act: this section's opening covers the **base** moving (#854), and *Verification,
   not trust* covers what is **already on the branch** (#891). This is the third case — the branch
   itself growing in between. **A session that has reported is not necessarily finished**; it may
   still be acting on a brief from the lead or from the user, which is exactly what had happened
   when `540712f` went to `main` unread, and again in #984.

   **The value to compare against is the lead's own record of its last act on that branch** — the
   SHA the diff was read at, or the SHA its `update-branch` produced, whichever came later. Both are
   the lead's. **Neither is the session's, which is why the report is the wrong place to carry
   this**: step 1 moves the head as a matter of course, so a SHA quoted in a report is stale by
   construction in precisely the case the check exists for, and asking a session to supply half of
   the lead's control would make the control worse rather than better.

   **Re-fetching the value is the failure, and it is indistinguishable from the check working.** On
   2026-09-08 the lead re-read the head and compared it against a SHA it had itself pulled from the
   same, already-moved branch minutes earlier. They matched, the check went green, and the
   implementation the user had **not** chosen merged. A branch compared against itself agrees every
   time (#984).

3. **Where the head is not the SHA you recorded, read the delta — not the branch again.**
   `git range-diff <recorded>...<head>` on a freshly fetched branch answers *what moved under me* in
   one command, and it is the right instrument because it survives a rebase: after your own
   `update-branch` it reports the base moving and the patches unchanged, and after a rewrite it
   reports the content. `git diff <recorded> <head>` will do where nothing was rebased.

   **This is not a re-verification and must not be allowed to grow into one.** The suites are CI's
   job and gate the merge anyway; what no check can answer is whether what sits on the branch is
   still the change that was verified and chosen, and that is a question about the delta rather than
   about the branch. **A rule costing a full re-verification is a rule that gets skipped, and a
   skipped rule reads as coverage** — this file's own argument against the never-alone list's second
   criterion, turned on itself.

   `9cb5c06` verified, `13135ec` from the lead's own `update-branch`, `721b173` from the session's
   rewrite. One `range-diff` across the last pair shows the chosen implementation being taken out,
   in a few lines. The identifiers said nothing, and there were three of them (#984).

4. **A refused merge is a signal, not a transient.** `gh pr merge` declining with *"add the `--auto`
   flag"* means the requirements are not met **right now**, and for a pull request inside the
   safe list, whose four gated checks are skipped, it is nearly always one of two things: the branch
   has fallen behind, or `Closing reference check` — the one check such a pull request does run —
   has not reported yet, or is red. Go back to steps 2 and 3 before retrying; retrying without
   re-checking is the exact sequence that produced the unread merge.

**None of the three failures is a case for more diligence, which is why all three are mechanical
steps.** The verification that missed a third commit was correct when it was performed; the lead
that updated two branches at once knew quite well that merges serialise; and the lead that compared
a branch to itself was running the very command this section prescribes. **And the one-at-a-time
rule is a repeat**: the same correction had been made to an earlier lead, about a drain loop pushing
four branches per cycle when only one could merge. It was known, said once to somebody who is no
longer in the conversation, and nowhere in the repository — which is the whole case for writing it
here.

## Branches

`task/<issue>-<slug>`, branched from `main`: `task/780-collaboration-model`. One branch per issue,
the same issue the session owns.

## What may run in parallel

**One worker at a time is the default since 2026-09-10, and this section is not on hold.** It is what
governs a **second track**, which the user may ask for at any moment — and the answer has to be
available then, rather than worked out under time pressure with two sessions about to write the same
file. So the lead goes on holding what this section holds while one thing runs: which work shares a
file, that merges serialise under strict required checks, that one session at a time may touch a
migration, that choosing what runs at once is choosing which files are shared. **The concurrency
default changed; the concurrency reasoning did not** (#1059). **And the queue is still sequenced by
file contention even while nothing contends**, because that ordering is what makes a second track
safe the moment there is one — worked out in advance or not at all.

**And since 2026-09-10 it is not only a second track this governs** (#1081). A session waiting for a
showcase no longer counts as in flight, so the lead starts the next task while a verified branch
sits waiting — and **that branch still holds its files**. Two branches open on the single track is
now the ordinary case rather than the exception, so this section is what the lead reads before
choosing the next task, not only before answering a request for a second one
(*The pool of generic workers*).

Where sessions do run in parallel, each is in its own worktree. **Merges serialise, and that is the
trade**: the second branch ready rebases onto the first and re-runs its checks. At two or three
parallel branches that costs one extra CI run, which is cheap next to the alternative.

**That estimate assumes nothing else is landing, and a busy day is not that.** On 2026-09-06 four
Renovate pull requests and three task branches were in flight together and something landed every few
minutes; `strict_required_status_checks_policy` makes up-to-date a merge precondition, so the real
cost is one run **per move, per branch**. Under those conditions a verified branch is not a mergeable
branch — **it is mergeable only until the next thing lands** — which is why updating it stops being
the session's job at all (*Who moves a branch that has fallen behind*). **That section carries the
loop; this one only prices it.** Knowing that branches serialise does not by itself stop you from
pre-emptively updating all of them, and #905 is that gap being fallen into.

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

**The position was taken on 2026-09-06, in this file's first commit (#780)**, and it replaced a
permissive predecessor rather than writing down what was already happening: until that day AGENTS.md
told a session that *had* started a dev server for verification to stop it before finishing, which is
a tidying rule and not a prohibition. That is what the date is for — it lets a reader tell a decision
that was taken from practice that merely accumulated, and date the reason above when weighing whether
it still holds.

**The tooling itself says the opposite, and it is overridden deliberately rather than followed.**
After an ordinary `Write` a session is told that no preview server is running and to call
`preview_start`; it arrives unprompted, at every session in every project, and **it is emitted by
the harness rather than configured here** — `.claude/settings.json`,
`.claude/settings.local.json` and both files under `~/.claude` configure no hooks at all, and
nothing under `~/.claude` names it — so unlike a wrong sentence in a file there is nothing here to
correct and no hook to hunt for. Noticed on 2026-09-10 (#1040): the #1022 session ignored it
**because it had read this section**, which is the whole of the guard — one that had not would have
started a dev server and left it running, which AGENTS.md separately forbids.

### If nobody could see it, the user looks before the merge

The rule above says no session can verify a visual change. It did not say who does, or when, and in
practice the answer had been *after the merge*. That cost two rounds in one day. **#815** merged, the
user looked, and the scrolling was wrong — the sidebars moved with the page instead of staying pinned
— so a follow-up now exists for something a five-minute look would have caught. **#824** — the pull
request carrying #816's drag feedback and #820's safe centring — merged while this was being
discussed, and both are on `main` unseen. Neither session did anything wrong: both said plainly that
the appearance was unverified. The gap was that *unverified* had no consequence attached to it.

**So: if the change is one a person looks at, the pull request goes to the user before it is merged,
and his confirmation is what releases the merge** (step 7 of *The loop*). A screen, a layout, copy,
a flow — anything with a surface. Not documentation, not a refactor that leaves no trace on an
interface, not a mechanism nobody sees. **If you are unsure, show it**: five minutes before the merge
is the cheaper side of that trade, and #815 already paid the dearer one.

**This trigger replaces #826's, rather than standing beside it.** #826's was *the session reported
that the appearance is unverified* — a good signal and a bad gate, because it depends on the session
thinking to write the sentence, and a session can simply not mention that it could not see something.
Whether a change has a surface does not depend on anyone remembering to say so. The report is still
worth reading; it is no longer the thing that decides.

**Verify first, then show — never the other way round.** Branch shape, scope against the issue's
*Done when*, CI green, the suites the session says it ran: all of it before he is asked to look.
Showing a branch with red CI, or one whose scope has not been checked, collects his comments against
a version that is going to change anyway, and every one of them then has to be collected again
against the version that ships. Step 6 of *The loop* comes before step 7, and this is why.

**How the user actually looks at it.** He tests through Docker Compose, and the dev overlay
bind-mounts the working tree — so for a source-only change **switching the branch in the main
worktree is enough**; nothing rebuilds. Anything else on the branch — a dependency, a migration, an
environment variable, a change to the Compose files themselves — does need a rebuild, and it is the
lead that does it.

**One address, always the same.** The main worktree at `/Users/michalwy/stamporama`, on the stable
ports the README documents — it is slot 0, so the app is at `http://localhost:3000` (#781). Never a
session's worktree and never a slot port. He is not to be remembering which session is on which
port, and an address that moves is an address he has to ask about before he can look at anything.

1. **The lead checks the tree is clean and asks before touching it.** The main worktree is the
   user's, and switching a branch under him while he is mid-something is not the lead's to do
   unannounced.
2. **The lead fetches and checks the branch out** in `/Users/michalwy/stamporama`.
3. **The lead brings the stack up to the branch — the user does not.** Check out, rebuild if the
   change needs it, and only then send the message. Asking him to raise it himself puts the one step
   that can fail on the person who did not make the change.
4. **Open the addresses yourself before saying it is up.** Every URL you are about to send: it
   answers, the page renders, and the thing being shown is actually on it. *Do not hand him a link
   you have not opened yourself — half of all failed showings are a link returning an error that
   nobody clicked before sending.*
5. **Then the message, and it carries four things:**
   - **the exact addresses, as clickable links**, full paths, one per screen he needs to see — not
     "have a look at the panel", and not a bare code span. He asked for this on 2026-09-08, having
     asked for the addresses themselves once already: a code span is an address he has to select
     and paste, and he pays that on **every screen of every showing**. It is the cheapest thing in
     this procedure to get right and the likeliest to die at a handover, which is why it is a line
     here rather than a habit (#974);
   - **three to five specific things to look at** — not "check it works", but "click it a second
     time and see whether the first one is still in the list". #815's own pull request does this,
     listing what to look for *and* what would say it is still wrong, which is what makes a showing
     cheap;
   - **what is deliberately absent, and which issue owns it.** This is the point that rescues a
     showing: without it, the first thing he reports is the missing thing, and the showing is spent
     on something that was never in scope;
   - **what is a stub.** If the data is seeded, say it looks artificial and why — otherwise he is
     judging the appearance of something that was never meant to have one.
6. **Sort what he says; do not tip it all into the current issue.** Three destinations: it belongs to
   this issue → **a fix on the same branch, before the merge**, which is the whole saving and what
   #815 cost by doing it the other way round; it is a different issue → file it and tell him where it
   went; it is already planned elsewhere → say where, so he does not report it twice. **And say
   plainly which of his comments block the merge and which do not** — otherwise everything he
   mentioned reads as a condition, including the parts that are not.
7. **On his confirmation the lead merges, then restores `main` in the main worktree and rebuilds**,
   so what is running there is what was merged. Skipping the rebuild leaves him looking at code that
   exists nowhere two hours later.

**A fix pushed to a branch under showcase must be laid into the main worktree.** Steps 2 and 3 cover
the first checkout and nothing covers the second round, which is precisely where it gets skipped: the
first checkout is deliberate and remembered, the re-lay is not. When he rejects something and the
session pushes a fix, verifying `origin/<branch>` is not the end of it: **the lead must put that
commit into the main worktree** — fetch, move the checkout on, rebuild if the change needs it, open
the address again, and only then say it is there. Verifying the remote and putting a change in front
of him are two different acts.

It failed exactly there. The main worktree sat on `e743339` while the fix was `fad16ca` on the
remote; the lead verified the remote, told the user the fix was in front of him, and it was not —
`grep -c closeOnSelect` on his tree returned `0`. **He was looking at precisely the code the lead had
given him.** Worse than the omission was what followed: the lead explained his correct report away
with a container restart time from `docker ps`, an inference built on top of the error and reached
because it was available and it fitted — he had restarted the container for certainty, not after the
fact. **Between "the session pushed it" and "he can see it" there is a step, and it is the lead's**
(#854).

**When a showcase reaches "we disagree about what is on screen", the check has to separate the two
builds that actually differ.** Choose it against the commit in dispute, not against whatever boundary
is easiest to describe — and choose one that does **not** require performing the interaction being
complained about, because a check that makes him repeat the broken step cannot tell *not fixed* from
*fixed, and I did it wrong*.

The lead handed him a one-glance test — *four separate chips means old code, one More filters control
means new* — which was true and useless: it separates pre-#846 from post-#846, a boundary **four
commits away** from the one being argued about. His build sat on the far side of the lead's test and
the near side of the real one, so *"I am looking at good code"* and *"you are on old code"* were both
correct, about different commits, and nothing in the test could tell them apart. **A discriminating
test that does not discriminate the thing in question is worse than no test**: it converts a
disagreement into confidence on both sides and closes off the question that would have found the
error. The implementing session supplied the right one unprompted — *open the location dropdown and
pick nothing; the switch is at the foot of the panel, or it is not* — which pins the disputed commit
against its predecessor and touches none of the interaction under complaint (#854).

**Raising the stack is the lead's; lowering it is his alone.** Never take the stack down and never
delete seeded data without his word. He manages Docker, and a stack that disappears under him is
indistinguishable from one that broke.

**What not to ask him for.** Keyboard traversal, contrast, no overflow on a narrow screen, green
tests — all of that belongs to the session or the lead and is done *before* anything is shown.
**He judges what a machine cannot**: whether the copy says what it should, whether the layout makes
sense, whether this is the thing he asked for, and whether something obvious is missing. A showing
that spends his attention on a checklist has spent it on the wrong thing. (The source procedure also
has him check **both locales**; this app has no i18n, so that item is omitted rather than overlooked
— stated here so the omission reads as a decision.)

**What this is not.** It is not a review gate on every pull request, and his time is not the price
of merging. For a configuration change or a rule with unit tests behind it, **the five required
checks are the verification**. For a documentation change four of them are precisely what does *not*
run — `Detect changes` reports all four as skipped, and only `Closing reference check` does — and
the verification is **the lead's read of the diff in step 6** of *The loop*, which is a thing this
file already has the lead doing. And it is **not a general licence to run the app.** AGENTS.md says not
to leave dev servers running, and *No browser verification* above says a session starts nothing;
**the showcase is the one exception to both, and it is the lead's.**
A task session still starts nothing. The lead starts nothing for its own verification either — step
6 of *The loop* is a check of the change as written, in the repository. The stack goes up to be
shown to the user, and for nothing else.

**Where this came from, recorded because the same misreading is available to the next person
comparing the two projects.** The darkroom model has a section — *The main worktree is the user's
showcase* — saying exactly this: when work is ready to be looked at, the lead brings the branch into
the main worktree and starts it there. **The lead read that as being about dev-server ports and
dismissed it as not applying here.** It is about review order, and it applies exactly.

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

**A finding says where else the claim appears — or says it did not look.** One line in the report,
and the second half of it is load-bearing rather than a softening: a session mid-task must not be
obliged to run an unbounded sweep before it may say anything, and an explicit *I have not checked*
tells the lead the sweep is still owed, which a silent omission does not.

**This is *Verification, not trust* across a session boundary rather than within one file.** That
section's procedure — *a correction is done when the retired claim does not appear anywhere* — is
addressed to the session **landing** the change. A finder cannot land it: that is what this section
is for. So the rule pointed at nobody, and the durable record split. #797 found that
`Album.collectionAreaId`'s schema comment misstated where `{area}` resolves, corrected
`albums.md` — the file it was already editing — and correctly only *reported* the schema line. **The
copy that was reasoned about got fixed and the copy nobody was editing kept the error for two
days**, until #810 was scheduled and a second session re-derived the whole thing from scratch
(#992).

**The cost is asymmetric in the right direction, which is the whole argument for asking.** The
finder pays one sweep, on a claim it already has in its head with the tree open; without it the next
session pays the entire re-derivation, and #810 is what that costs. It is a line in a report and not
a procedure — the instinct to grow it into a checklist should be resisted, for the reason this file
gives everywhere else: a rule nobody performs on the way to doing something else reads as coverage.
Run it the way *Sweeping for a claim* says, positive control included, or say you did not.

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

**It is titled `🎨 <what is being designed>`** — no issue number, because its whole output is the
issues that do not exist yet — and `✅ 🎨 <…>[#PPP]` when it is finished, the bracket carrying the
pull request that landed the ADR (*Session titles*, #1048).

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

1. **A merged branch deletes itself** on GitHub. **The worktree goes when its session is finished,
   which the title says and the merge does not** — the done icon `✅`, the test below — along with
   the local branch, and the remote branch too if the work was dropped rather than merged.
2. Per-worktree slots are reclaimed when the worktree goes (#781).
3. **Every backlog review sweeps**: `git worktree list`, `git worktree prune`, and remove what is
   stale (`backlog-review.md`) — where *stale* is the test below, not a judgement.

Two orphaned worktrees from 27 August were found by hand while this model was being written. A
worktree nobody removed holds a slot and a database permanently, and the cost surfaces weeks later,
in an unrelated session, as a failure with no visible cause.

### A held session's worktree is not stale

On 2026-09-07 the outgoing lead ran the sweep over **every** worktree rather than only finished
ones, and removed the **release session's worktree while that session was holding for its signal**.
Nothing was lost — the branch survived, `git worktree add` restored it, and a release session writes
nothing into the repository — which is luck about which session it was. A session mid-edit loses its
uncommitted work, and AGENTS.md notes that an unpushed commit does not survive its worktree going.

The rule could not have caught it. Layer 1 reaches a worktree whose branch has **merged**; a held
session has no branch, no pull request, and has sat untouched for exactly as long as the hold has
lasted — which is the shape of an abandoned one. #897 made *spawn ahead and hold* the default the
day before, and the pool holds as many at once as the lead cares to spawn (*The pool of generic
workers* carries the number, so that this does not become a second copy of it), so worktrees that
look abandoned are now the normal case rather than the exception — more so since 2026-09-10, with one
of them working and the rest idle by design.

**Git cannot tell the two apart, and that was checked rather than assumed:** branch, commit,
`git status`, mtime, the `.git` file and the contents of `.claude/` are identical for both, and
mtime is the worst of them, because holding *is* doing nothing. Git proves staleness in one
direction only — a merged or dropped `task/` branch is finished. **A worktree carrying no `task/`
branch is the case git is silent about, and is exactly the shape of a held session**; never remove
one on git evidence alone. Three hours after the sweep above, **the incoming lead made the same call
deliberately** — one worktree, examined on purpose rather than in a loop: clean, on a throwaway
`claude/` branch, its work already on `main`, therefore rubbish — and reported it as a removal
candidate while it was still holding. Nothing came of it only because the release ran first. The git
evidence is insufficient even when you are looking at a single worktree, carefully, having read this
file.

**What answers it is a lookup, and the list already exists.** Every session the app knows about
carries the `cwd` it runs in, which for a task session is its worktree path. So before removing
anything, resolve the path to its session:

- **No session** for the path → orphaned; remove it.
- **Title begins `✅`** → finished; remove it. Since 2026-09-08 this is the whole test, and it is a
  leading marker rather than a judgement (*Session titles*). **`[DONE]` counts here too, for as long
  as the changeover lasts** (*The changeover from `[DONE]`*): it was the spelling until 2026-09-10,
  sessions carrying it were live when the icons landed, and no new title can acquire it.
- **Title begins `⏳`, `🔨` or `🎨`** — pooled and unassigned, working, or designing, whether or not
  it has opened a pull request and whether it holds one issue or several → **not stale, whatever its
  age**; leave it. So is a title still spelled the old way — `Worker N`, `#NNN: …`, `#NNN/#NNN/…: …`,
  or any of those carrying `[#PPP]` with no marker in front — for the same window and the same
  reason. **`🎨` joined on 2026-09-10** (#1048) and is the one working icon that is *not* a phase: a
  running design session leads with it, and a finished one leads with `✅` like everything else.
- Anything else, or no clear match → **ask the user**. He can see the tiles; the lead cannot infer
  them.

**`👑` is absent from that list on purpose, and its absence changes nothing.** The lead's `cwd` is
the main checkout rather than a worktree, so it is not a candidate the sweep resolves; the old
enumeration left `===> Leader <===` out for the same reason. If a `👑` title ever does resolve to a
worktree path, that is the last bullet's case and not a removal.

**`🎨` is named rather than left out, and the two roles differ on exactly this point.** A design
session does resolve to a worktree — and would resolve to one every time if design ever came out of
the pool by message, which *A pooled worker reads nothing until it is assigned* records as an open
possibility. Left out, a running design session would fall through to *ask the user*: safe, and
precisely the noise the third bullet exists to prevent.

**The second bullet is the whole test; the third is descriptive.** It names the not-finished icons
only so that *ask the user* stays rare. It used to enumerate title *shapes* instead and lengthened
whenever the vocabulary did — twice on 2026-09-08, when a working session gained its pull request
number and when a session holding several issues gained a spelling at all — and since #1042 a new
*shape* no longer touches it, because every working shape leads with one of the working icons
(*Session titles*). **A new icon still does**, which is what #1048 spent the same afternoon: `🎨` had
to be added here, in `backlog-review.md` and in the table, three places for one row. **The price per
amendment is unchanged — three edits either way — and what is bought is that most amendments stop
being amendments**: a new *shape* now costs nothing, where two of them cost three edits each on
2026-09-08 (#975, #993). **Whether icons are also amended less often is not yet knowable**: the set
is one day old and has been amended once already, so do not read the claim as a rate.
**That is a shorter list and not a stronger one.** A longer one invites being
read as the decision procedure, and this is not one either: titles are unenforced, so a session
whose icon is missing or unknown falls through to *ask the user* rather than into a removal —
exactly where a missing `[DONE]` fell.

**The marker is doing the work the old test could not.** *Finished* used to mean *its pull request
merged, or its work dropped* — a fact about GitHub the sweep had to go and establish for every
worktree, and which is silent about a session that finished without opening one. The icon is put
there by whoever knows, at the moment they know. **It stays one string comparison**, which is why
*Session titles* requires a codepoint that carries no variation selector.

#### Merging a pull request is not the event that ends a session

**A test is only as good as the places that send you to it, and on 2026-09-10 layer 1 did not.** The
lead merged #1030 and then removed the worktree of the session that had produced it, along with its
local branch. **That session was working**: the lead had re-briefed it eleven minutes earlier and it
was mid-commit on the follow-up it had been asked for. Its title was
`#1020/#1021[#1030]: selection vs filter` — **no finished marker**, which the test above says means
*working; leave it*. Nothing in layer 1 pointed at that test, and the merge is what it read as the
licence.

**This is the mirror of the incident this section opens with.** There, layer 1 could not have caught
the removal, because a held session has no merged branch for it to point at. Here it had one and
pointed straight at it: *a merged branch deletes itself, and the lead removes the worktree*, stated
as one event following the other, with nothing in it sending the reader down to the string
comparison that actually decides it. Same sweep, same section, opposite halves of one missing
sentence — which is why layer 1 now defers to the title rather than to the merge.

**The general shape is the part worth the words: merging a pull request is a fact about GitHub; a
session finishing is a fact about the session.** The first is public, timestamped and visible to
anybody; the second is known only to the session and to the lead's own briefing history, and after a
re-brief the two are not close at all. This is #984's *knowing and not acting* one step further
along — there the lead knew a session had been re-briefed and acted anyway; here the prohibition
list it was working from **did not name the act it performed**. That list names it now (*A re-brief
hands the branch back*).

**Nothing was lost, and a rule whose evidence is *nothing went wrong* teaches nothing — so what
saved it is named instead of the outcome.** Two things did, and neither is a property of the sweep.
The session's `--force-with-lease` refused its own push against the lead's rebase rather than
silently overwriting it, which is the flag *A re-brief hands the branch back* names for this exact
collision; and the session
had put a ref on its commits before anything could collect them, so they survive as #1032, one of
them fixing a defect in shipped code. Both are accidents of what that particular session happened to
have done by that minute. **A session mid-edit with uncommitted work would have lost it**, which is
the case this whole section was written about, and AGENTS.md says as much about an unpushed commit.

**What this is not is an instruction to check before cleaning up.** A rule answerable only by
remembering is this file's own failure mode wearing a checklist (*Keeping this file honest*), and
there was nothing wrong with the test: it is one string comparison, it was correct throughout, and
it would have answered in a second. What was missing is that nothing **at the point where the
mistake is made** sent anybody to it. Two places do now — layer 1, and the prohibition list in
*A re-brief hands the branch back* — and both are pointers rather than a new procedure.

**The lead keeps no list of its own, and deliberately not.** A list the lead kept would die with the
lead; this one is the app's, is keyed by the worktree path, and outlives both the worktree and the
lead — the release session above is still in it, still titled *hold*, with a `cwd` that no longer
exists. An incoming lead reads the same list on its first sweep, with nothing handed over.

**A task session's implementation plan dies at layer 1, and for one day that was a defect.**
AGENTS.md required a plan under `.claude/plans/` for multi-area work; `.gitignore` ignores
`.claude/`, so `git ls-files .claude/plans` returns **0** and no plan has ever been committed. The
harness copies the checkout's plans into each new worktree — a session that writes one holds 262
where the checkout holds 261 — and that 262nd file is the only copy of it anywhere. Removing the
worktree removes it. **Five worktrees were removed on 2026-09-06** and those plans are gone. Neither
rule was written knowing about the other, and together they instructed sessions to produce a record
and the lead to destroy it.

**The user settled it on 2026-09-07 (#875): a plan is no longer required, and what it is now is a
working note for the session that writes it.** So this step destroys nothing the project asked for,
and the tension is gone rather than managed. The reason it can go is that the plan was only ever a
record because nothing else was — the 261 were written in an era with no pull requests at all, every
commit going straight to `main`. A task session's reasoning now lands in three places that outlive
its worktree: **the pull request body, the closing comment on the issue, and the topic file it is
required to update.** All three are in git and all three are read.

**Two rejected options, recorded so they are not reopened as improvements.** *Committing the plans*
keeps the corpus growing and puts it where the lead already reads, but `.claude/` also holds
machine-local state, so it needs a narrower ignore rule than the one that exists — and **a plan that
becomes reviewable content changes how it is written**, toward something performed for a reader
rather than used by its author. *Moving the plan into the pull request body* fails on something
simpler: a plan is written **before** the work and a body is written after, so it would become a
retrospective reconstruction and stop doing the one thing a plan is for.

## How much experience is behind this

**One day.** Before 2026-09-06 every commit in this repository went straight to `main` and every
session was the only one running. The single-session rule at the top has those 261 plans behind it —
all written before that date, a closed record rather than a growing one (#875), and none the weaker
for it; the lead, the pull request and the parallel worktrees have a single afternoon. This file
records the current state of the practice, not settled practice, and the parts likeliest to be wrong
are the ones exercised least: more than two sessions at once, and how a design track's issues get
spawned as a batch.

## Keeping this file honest

Every backlog review asks whether the model above still describes what actually happens, and
**reports what it finds rather than quietly fixing it** (`backlog-review.md`):

- Did a task session stall waiting on the lead, and for how long?
- Did the lead answer something that was not written down anywhere?
- Did anything reach `main` without the user's explicit go-ahead? **Three answers are authorised
  and no more**: a Renovate automerge inside the boundary above, a pull request inside the
  `Detect changes` safe list that the lead read and merged (#906), and process work in `.github/`,
  `scripts/` or `package.json` merged by the lead (2026-09-08, *Process work the lead may merge*).
  Check that each really was inside its own boundary — they are three different boundaries, and the
  third is the one this question named as a failure until #958. **A stale authorisation list does
  not merely fail to help: it manufactures a finding against somebody doing the right thing**, which
  is the most expensive way for a sentence here to go out of date — and the second boundary's
  membership has already moved once (#970). So read it off the `case` glob in `Detect changes`
  rather than off any sentence, this one included: the gate is the record and this line is a
  summary of it (*Automerge is the one exception*).
- Is automerge still working at all? Its whole failure mode is silence, so the answer comes from
  the Renovate sweep in `backlog-review.md`, not from the absence of complaints.
- **Did the lead write a pull request as well as merge one?** All three authorised shapes are
  licences to merge, and a documentation pull request the lead both wrote and merged is a finding
  however good the change was (*The lead's licences are to merge, never to write*). It is worth
  asking here rather than trusting the rule, because it accelerated last time and every step of it
  was locally reasonable: `gh pr list --state merged --limit 50 --json number,author,files` against
  who wrote each one.
- Did a task session open an issue, close one, or merge a pull request?
- Are there worktrees or `task/` branches left over from work that has already landed?
- Did a process change land without the memory store being swept for what it retired? Answerable
  rather than remembered: `git log --since=<the last review> --name-only -- AGENTS.md docs/agents/
  .github/workflow-rules.yaml .github/rulesets/` lists the candidates, and each one is a grep of
  `~/.claude/projects/-Users-michalwy-stamporama/memory/` for the claim it replaced. **The sweep
  belongs to whoever landed the change** (*Memory is not versioned, and nothing expires it*); this is
  the backstop for that being forgotten, the way the worktree sweep is the backstop for layer 1 of
  *Worktree cleanup*. It deliberately does not ask whether anybody remembered to sweep — that is a
  question answerable only by remembering, which is this section's own failure mode.
- Does every session's title match the vocabulary in *Session titles*, and in particular **did every
  finished session get its `✅`**? A lookup in the app's session list — machine-local, and no
  part of the repository. **The marker's job has changed twice underneath it**, which is the answer
  worth having. Until 2026-09-07 it had one purpose, telling the user that a chip costs nothing to
  start now, and on that reading #868 — waiting only for `main` to carry #844 — needed none.
  *A held session's worktree is not stale* gave it a second job that afternoon, and a title earlier
  cannot discharge a job that did not yet exist: #868 and the incoming lead were both waiting, and
  neither said so. 2026-09-08 gave it a third, and this time the missing half is the **end** of a
  session rather than the start: a finished worker that never gained its prefix is indistinguishable
  from one still working. It still **fails safe** — an unmarked session is left alone or handed to
  the user, never removed — which is why this is a question and not an incident. **A sweep that
  finds several missing prefixes is not reporting sloppiness; it is reporting that renaming on
  finishing has no mechanism behind it**, which is worth saying plainly rather than fixing quietly.
- Did a held session **start writing before the thing it waited for had landed**? A commit's author
  date survives the rebase merge, so `main` records when work was actually written; compare it
  against the `mergedAt` of the pull request the session was held on. #868 waited correctly by
  twenty minutes, and that is still provable today. **It runs forwards only.** The comparison needs
  the held session's own pull request body to name what it waited for — one line, the convention
  from 2026-09-07 — and nothing that merged before that date recorded it, so there is no history
  here to audit.

Each of these is one of the rules above failing in a way that looks like nothing at the time. A lead
answering from its own judgement is indistinguishable from a lead answering from the documentation,
right up until somebody asks where the answer came from.

**One failure here deliberately has no question.** Nothing records when a chip was *written*: a
session's first transcript record is its spawn prompt, but that timestamp is when the session
started, not when the lead composed it — across forty sessions the two are never more than fifty
milliseconds apart. So *"did a held chip go stale?"* can be answered only by remembering, and a
question answered that way is this section's own failure mode wearing a checklist. The guard stays
where #897 put it: the session asks rather than proceeds, and the lead re-briefs at the signal.
