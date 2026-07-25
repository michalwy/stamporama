# ADR-0018: Database-Queued In-Process Background Jobs

## Status

Accepted

## Context

Generating an offer's listing images (#311) is the first piece of work in this app that
is genuinely too slow for a request. One collage decodes every scan in its group,
composites them, and then re-encodes the canvas repeatedly to hit the platform's
file-size limit (#310). A large offer is therefore **seconds of CPU per image**, and a
listing can plan a dozen images. Running that inside the Generate request would hold a
connection open for minutes and time out behind any reverse proxy.

Two further properties make this more than "run it later":

- The work must survive a **restart**. The app is a single self-hosted container that is
  restarted on every upgrade; a render interrupted halfway must not leave an offer with
  a half-replaced set of images and no way to notice.
- The collector must be able to **see** it happening. Generation is explicit — a button
  — so the screen that pressed it owes the user visible progress and a visible failure.

The existing precedent is the photo orphan-GC sweep (#112): an in-process timer started
from `src/instrumentation.ts` `register()`, deliberately not a second compose service.
That is periodic, stateless work with nothing to report, so it needed no queue. This
ADR settles the shape for *triggered* work that does.

The alternatives considered were a real job runner (BullMQ/pg-boss and a Redis or
dedicated worker container), and the simplest thing — a fire-and-forget promise started
by the request handler.

## Decisions

### 1. The queue is a table, not a broker

Each kind of job gets a small table whose rows are both the queue entry and the state
the UI reads. For offer photos that is `offer_photo_generation`: one row per offer
(unique `offerId`), carrying `status` (`queued | running | ready | failed`), progress
counters, an `error` string, and the timestamps.

Postgres is already a hard dependency and already the thing every other state lives in.
Adding Redis or a second container to a self-hosted deployment is a real operational
cost — one more thing to back up, upgrade, and explain in the installer — and buys
nothing at this scale: a single collector pressing Generate is not a throughput problem.

The row being the UI's state, rather than a separate progress record, is what makes the
panel trivial: it polls one endpoint and renders what the worker wrote.

### 2. The worker is a timer in the app process, one job at a time

`src/lib/offer-photo-worker.ts` is started from `instrumentation.ts` `register()`
alongside the GC sweep. It claims the oldest `queued` row with a conditional update,
runs it, and repeats until the queue drains; then it polls every few seconds.
Concurrency is deliberately **one**: rendering is CPU-bound through `sharp` inside the
same process that serves requests, so running several at once would only make the app
slower, not the queue faster.

A `kick` function is exported so the action that enqueues can nudge the worker
immediately — pressing Generate should start rendering now, not on the next tick. The
kick is best-effort and unawaited; the poll is what *guarantees* the job runs.

Worker state is pinned to `globalThis`, like the Prisma and GCS clients, because a plain
module-level value resets on every `next dev` hot reload and would stack a second
interval on each recompile.

### 3. Crash safety comes from the queue, and jobs are idempotent

At boot the worker moves every row still marked `running` back to `queued`: any such row
belongs to a process that no longer exists. This is only safe because the job itself is
written to be **repeatable** — the photo render produces a complete new set of images
and swaps them in atomically, so running it twice is indistinguishable from running it
once.

That requirement is the pattern's price, and it is stated here so future jobs are held
to it: a job that cannot safely be re-run does not belong in this queue.

### 4. Enqueuing is idempotent too, and validates up front

Enqueuing an offer whose run is already `queued` or `running` is a no-op rather than a
second job, so a double click renders once. Anything that makes the job pointless — no
collage numbers on the offer, no scans to render — is rejected **at enqueue time** with
a message the UI shows, instead of being discovered by a worker whose only way to report
it is a failed run.

### 5. Not a fire-and-forget promise

Starting the render as an unawaited promise inside the request handler would have been
the smallest change, and was rejected: nothing would survive a restart, nothing would
serialize two concurrent renders, and the only place the outcome could be recorded is
the same row this ADR introduces anyway — at which point the queue is already built,
minus the crash safety.

## Consequences

- No new service, image, or credential; the installer and `docker-compose.prod.yml` are
  untouched.
- Rendering shares CPU with request handling. Acceptable for a single-collector,
  self-hosted app; the one-job-at-a-time cap is what keeps it bounded.
- **Multiple app replicas would need work.** The claim is a conditional update, so two
  workers cannot claim the same row, but nothing else about horizontal scaling has been
  thought through (no lease renewal, no heartbeat, and the boot-time requeue of
  `running` rows would steal a *live* job from another replica). Single-instance is an
  assumption, documented here rather than discovered later.
- A job that hangs rather than crashing stays `running` until the process restarts.
  There is no timeout; adding one is a change to this ADR.
- Future triggered work (bulk exports, backfills) should reuse this shape — a table, a
  claim, an idempotent run — rather than introducing a second mechanism.
