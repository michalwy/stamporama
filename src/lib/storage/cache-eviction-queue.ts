/**
 * How the local storage cache's eviction passes are scheduled (#591), kept apart from
 * `cache.ts` so the rule can be read — and tested — without a database, a disk or a backend.
 *
 * Two passes must not run at once: each takes the total it works from once, at the start, so a
 * second pass reading the same total would evict twice what either needed. That much is a plain
 * single-flight — hand every caller the pass already running.
 *
 * **And that is the trap this module exists for.** A caller reaches eviction *because it has just
 * added bytes*, and the running pass took its total before those bytes existed. Handing it that
 * pass answers "bring the cache back under the cap" with a pass that cannot see the object which
 * pushed it over, and the cache then stays over the cap — not for an instant, but until some later
 * populate happens to arrive with no pass running, or the hourly sweep does. The hourly sweep is no
 * backstop either, since it joins the running pass by the same rule.
 *
 * So a caller that finds a pass running waits for it and gets a **fresh** one behind it, shared
 * with everyone else who arrives in the meantime. A burst therefore still costs at most two passes
 * — the one running and the one behind it — and awaiting what this returns means *the cache has
 * been measured since I called*, which is the only promise that makes the cap a cap.
 */

/** The two slots a scheduled pass lives in. Held by the caller — `cache.ts` pins it to
 * `globalThis`, so a `next dev` hot reload cannot start a second pass beside the running one. */
export interface EvictionSchedule<T> {
  running?: Promise<T>;
  queued?: Promise<T>;
}

/**
 * Run `pass`, or — if one is already running — wait for it and run another, joining whoever else
 * is waiting for the same thing.
 */
export function scheduleEviction<T>(
  schedule: EvictionSchedule<T>,
  pass: () => Promise<T>
): Promise<T> {
  const running = schedule.running;
  if (running) {
    // `then(next, next)`: a pass that fails still hands the turn on. Its failure is the caller's to
    // see, not a reason for the next caller to be left uncounted.
    return (schedule.queued ??= running.then(next, next));
  }
  const run = pass().finally(() => {
    if (schedule.running === run) schedule.running = undefined;
  });
  schedule.running = run;
  return run;

  /** The queued pass's turn. Release the slot first, so anyone arriving from here on queues behind
   * the pass about to start rather than joining one that will not count their bytes either — and
   * go back through the door above, because between the finished pass clearing itself and this
   * running, another caller may already have started one. */
  function next(): Promise<T> {
    schedule.queued = undefined;
    return scheduleEviction(schedule, pass);
  }
}
