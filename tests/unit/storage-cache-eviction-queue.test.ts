import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleEviction,
  type EvictionSchedule,
} from "../../src/lib/storage/cache-eviction-queue";

/** A pass whose start and finish the test controls, so none of this rests on timing. */
function controllablePass() {
  const started: (() => void)[] = [];
  const pass = () =>
    new Promise<number>((resolve) => {
      started.push(() => resolve(started.length));
    });
  return {
    pass,
    get starts() {
      return started.length;
    },
    /** Let the pass that started `nth` (0-based) finish. */
    finish(nth: number) {
      started[nth]!();
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("storage cache eviction scheduling (#591)", () => {
  it("never runs two passes at once", async () => {
    const schedule: EvictionSchedule<number> = {};
    const control = controllablePass();

    void scheduleEviction(schedule, control.pass);
    void scheduleEviction(schedule, control.pass);
    await settle();

    assert.equal(control.starts, 1, "the second caller must not start a pass beside the first");
  });

  it("gives a caller a pass that starts after it, not the one already running", async () => {
    // The bug this exists for: a caller reaches eviction *because it has just added bytes*, and the
    // running pass took its total before those bytes existed. Handed that pass, the cache would sit
    // over its cap until some later populate arrived with nothing running.
    const schedule: EvictionSchedule<number> = {};
    const control = controllablePass();

    const first = scheduleEviction(schedule, control.pass);
    const late = scheduleEviction(schedule, control.pass);
    control.finish(0);
    assert.equal(await first, 1);
    await settle();

    assert.equal(control.starts, 2, "the late caller must be answered by a pass of its own");
    control.finish(1);
    assert.equal(await late, 2);
  });

  it("costs a burst two passes, not one per caller", async () => {
    const schedule: EvictionSchedule<number> = {};
    const control = controllablePass();

    const running = scheduleEviction(schedule, control.pass);
    const waiting = [
      scheduleEviction(schedule, control.pass),
      scheduleEviction(schedule, control.pass),
      scheduleEviction(schedule, control.pass),
    ];
    control.finish(0);
    await running;
    await settle();

    assert.equal(control.starts, 2, "everyone who arrived during the pass shares the one behind it");
    control.finish(1);
    assert.deepEqual(await Promise.all(waiting), [2, 2, 2]);
  });

  it("hands the turn on when a pass fails", async () => {
    // A pass that throws is the caller's problem to see, not a reason to leave the next caller's
    // bytes uncounted — a cache that stopped enforcing its cap after one failed query would grow
    // without bound until a restart.
    const schedule: EvictionSchedule<number> = {};
    let starts = 0;
    const pass = async () => {
      starts += 1;
      if (starts === 1) throw new Error("aggregate failed");
      return starts;
    };

    const first = scheduleEviction(schedule, pass);
    const second = scheduleEviction(schedule, pass);
    await assert.rejects(first, /aggregate failed/);
    assert.equal(await second, 2);
  });

  it("starts afresh once the schedule is idle", async () => {
    const schedule: EvictionSchedule<number> = {};
    const control = controllablePass();

    const first = scheduleEviction(schedule, control.pass);
    control.finish(0);
    await first;
    await settle();
    assert.equal(schedule.running, undefined, "a finished pass must not be left in the slot");

    void scheduleEviction(schedule, control.pass);
    await settle();
    assert.equal(control.starts, 2);
  });
});
