import type { ApplyHandoffReport, ApplyItem } from "../core/colnect-apply-handoff";

// The **record of a run in flight** (#689), so an interrupted one continues rather than restarts.
//
// A first Swap pass is thousands of items at one write every 1.6 seconds — an hour and a half of
// wall clock (ADR-0042). Over that span an MV3 service worker is unloaded and woken many times, the
// collector closes tabs, the machine sleeps, and Colnect asks for a slower pace. None of that may
// cost the run its place: a restart would re-apply everything already applied, which is harmless on
// Colnect (`val=+` twice is once) and wasteful on somebody else's server for an hour.
//
// So the worklist and a **cursor** are written down, in `chrome.storage.local` and for the same
// reason `pending-listings.ts` is: a worker variable does not survive the worker.
//
// Only one run at a time, deliberately. Two runs would be two paces on one site, and the measured
// safe rate is a rate for the *account*, not per run.

const STORAGE_KEY = "colnectApplyRun";

/**
 * How long a paused run is still worth resuming. Long enough to leave overnight and pick up in the
 * morning — the pause a `429` produces is measured in minutes, and one produced by closing the
 * laptop is measured in hours — and finite, so a worklist built from an export that is now three
 * weeks old cannot quietly wake up and start removing things.
 */
export const RUN_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApplyRun {
  requestId: string;
  collectionId: string;
  /** Where to report progress and post the done marks — the instance origin the handoff came from. */
  instanceOrigin: string | null;
  /** The tab holding the report screen, so progress lands back on the node it came from. */
  instanceTabId: number | null;
  lt: number;
  label: string;
  items: ApplyItem[];
  /** How far through {@link items} the run has got. Everything before it is settled, one way or
   *  another; everything from it on has not been attempted. */
  cursor: number;
  applied: number;
  changed: number;
  failed: number;
  /** Consecutive `429`s, for the back-off ladder. Reset by any write that lands. */
  consecutive429s: number;
  /** When the run was started, epoch ms. Only ever compared against {@link RUN_TTL_MS}. */
  startedAt: number;
}

// ── Pure operations ──────────────────────────────────────────────────────────
// Separate from the storage calls so they can be asserted without a chrome double, exactly as the
// pending-listing list is.

/** Whether a stored run is still worth continuing. */
export function runIsLive(run: ApplyRun | null, now: number): run is ApplyRun {
  return !!run && now - run.startedAt < RUN_TTL_MS && run.cursor < run.items.length;
}

/** The counts as the handoff reports them. */
export function runReport(run: ApplyRun): ApplyHandoffReport {
  return {
    total: run.items.length,
    applied: run.applied,
    changed: run.changed,
    failed: run.failed,
  };
}

/** One item settled: the cursor moves, the tally moves, and a landed write clears the back-off
 *  ladder — the pace is only too fast while Colnect is still saying so. */
export function runAdvanced(
  run: ApplyRun,
  outcome: "applied" | "changed" | "failed"
): ApplyRun {
  return {
    ...run,
    cursor: run.cursor + 1,
    applied: run.applied + (outcome === "applied" ? 1 : 0),
    changed: run.changed + (outcome === "changed" ? 1 : 0),
    failed: run.failed + (outcome === "failed" ? 1 : 0),
    consecutive429s: 0,
  };
}

/** A `429`: the cursor stays exactly where it is — the item was refused, not attempted-and-failed —
 *  and the ladder climbs a rung. */
export function runThrottled(run: ApplyRun): ApplyRun {
  return { ...run, consecutive429s: run.consecutive429s + 1 };
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function readApplyRun(): Promise<ApplyRun | null> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY];
    return stored && typeof stored === "object" ? (stored as ApplyRun) : null;
  } catch {
    return null;
  }
}

export async function writeApplyRun(run: ApplyRun | null): Promise<void> {
  try {
    if (run) await chrome.storage.local.set({ [STORAGE_KEY]: run });
    else await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // A run whose place could not be written down still runs; it just restarts from the top if the
    // worker dies. Losing the record is not worth losing the run over.
  }
}
