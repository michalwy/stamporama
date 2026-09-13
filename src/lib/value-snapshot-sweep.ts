import "server-only";
import { recordValueSnapshots } from "./value-snapshots";

// The periodic pass behind the daily value snapshots (#652), started from `instrumentation-node.ts`:
// once shortly after boot, then hourly. Hourly rather than daily so a day's row is written even when
// the app runs for only part of it, and so the row that stands for a day is the last pass of that day;
// each pass after the first only updates it (`recordCollectionValueSnapshot` is idempotent per day).

const INITIAL_DELAY_MS = 75_000;
const INTERVAL_MS = 60 * 60 * 1000;

interface SweepState {
  initial?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  /** A pass in flight — a slow one must not be overlapped by the next tick. */
  running: boolean;
}

// Pinned to `globalThis` like the offer photo worker (`offer-photo-worker.ts`): a module-level flag
// resets on every `next dev` hot reload, which would start a second interval beside the first.
const globalForSweep = globalThis as unknown as { valueSnapshotSweep?: SweepState };

function state(): SweepState {
  if (!globalForSweep.valueSnapshotSweep) {
    globalForSweep.valueSnapshotSweep = { running: false };
  }
  return globalForSweep.valueSnapshotSweep;
}

async function runPass(): Promise<void> {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    const pass = await recordValueSnapshots();
    // Quiet on the hourly updates; says something when a day's first rows land or a collection fails.
    if (pass.created > 0 || pass.failed > 0) {
      console.log(
        `[value-snapshots] ${pass.recorded} collection(s) recorded (${pass.created} new day), ` +
          `${pass.areaRows} area row(s), ${pass.failed} failed`
      );
    }
  } catch (err) {
    console.error("[value-snapshots] pass failed", err);
  } finally {
    s.running = false;
  }
}

/** Start the sweep once per process; a second call — a hot reload re-running boot — is a no-op. */
export function startValueSnapshotSweep(): void {
  const s = state();
  if (s.interval) return;
  s.initial = setTimeout(runPass, INITIAL_DELAY_MS);
  s.interval = setInterval(runPass, INTERVAL_MS);
  // `unref` so the timers never keep the process alive on their own.
  s.initial.unref?.();
  s.interval.unref?.();
}
