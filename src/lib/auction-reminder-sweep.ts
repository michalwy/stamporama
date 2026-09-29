import "server-only";
import { runAuctionReminders } from "./auction-reminder";
import { kickMailWorker } from "./mail/worker";

// The periodic pass behind the morning auction reminder (#1373), started from
// `instrumentation-node.ts` — the same in-process shape as the daily value snapshots (#652), and
// nothing outside the instance. Every five minutes rather than hourly, because the reminder goes at
// an hour the collector chose and an hourly tick could land it fifty-nine minutes late. A pass that
// finds nothing due is two small reads; the once-a-day rule is the claim in `auction-reminder.ts`,
// not this timer, so a restart — or a boot after the hour — sends a missed reminder and never a
// second one.

const INITIAL_DELAY_MS = 100_000;
const INTERVAL_MS = 5 * 60 * 1000;

interface SweepState {
  initial?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  /** A pass in flight — a slow one must not be overlapped by the next tick. */
  running: boolean;
}

// Pinned to `globalThis` like the value snapshot sweep: a module-level flag resets on every
// `next dev` hot reload, which would start a second interval beside the first.
const globalForSweep = globalThis as unknown as { auctionReminderSweep?: SweepState };

function state(): SweepState {
  if (!globalForSweep.auctionReminderSweep) {
    globalForSweep.auctionReminderSweep = { running: false };
  }
  return globalForSweep.auctionReminderSweep;
}

async function runPass(): Promise<void> {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    const pass = await runAuctionReminders();
    // Quiet on the passes where nothing was due; says something when a day was done or failed.
    if (pass.sent > 0 || pass.empty > 0 || pass.failed > 0) {
      console.log(
        `[auction-reminder] ${pass.sent} reminder(s) queued, ${pass.empty} with nothing ending, ` +
          `${pass.failed} failed`
      );
    }
    if (pass.sent > 0) kickMailWorker();
  } catch (err) {
    console.error("[auction-reminder] pass failed", err);
  } finally {
    s.running = false;
  }
}

/** Start the sweep once per process; a second call — a hot reload re-running boot — is a no-op. */
export function startAuctionReminderSweep(): void {
  const s = state();
  if (s.interval) return;
  s.initial = setTimeout(runPass, INITIAL_DELAY_MS);
  s.interval = setInterval(runPass, INTERVAL_MS);
  // `unref` so the timers never keep the process alive on their own.
  s.initial.unref?.();
  s.interval.unref?.();
}
