import "server-only";
import {
  claimNextScanUpload,
  failScanUpload,
  prepareScanUpload,
  requeueStalledScanUploads,
} from "./scan-uploads";

/**
 * In-process worker preparing uploaded card scans (#1567; ADR-0018).
 *
 * The offer photo worker's shape: the queue is `scan_upload`, the worker a timer in the app process
 * started from `instrumentation-node.ts`, and nothing else to deploy — a separate worker container
 * was considered and rejected with the collector. **One scan at a time**: a card is a ~140 Mpx
 * decode through `sharp`, and two at once would only make the web requests sharing this process
 * slower for longer. The app may slow briefly while a large scan is prepared; that was accepted.
 *
 * Crash safety comes from the queue, not from the worker: a scan left `preparing` by a restart is
 * requeued at boot, and a preparation is all-or-nothing, so repeating one never makes a second card.
 *
 * `kick` exists so a scan starts being prepared the moment its last piece is in rather than on the
 * next poll. It is best-effort and unawaited — the poll is what guarantees the scan is prepared.
 */

const POLL_INTERVAL_MS = 5_000;

interface WorkerState {
  /** A drain pass is in flight; the queue is processed one scan at a time. */
  draining: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// Pinned to `globalThis` like the other workers: a plain module-level object resets on every
// `next dev` hot reload, which would leave the old interval running and stack a second worker.
const globalForWorker = globalThis as unknown as { scanUploadWorker?: WorkerState };

function state(): WorkerState {
  if (!globalForWorker.scanUploadWorker) {
    globalForWorker.scanUploadWorker = { draining: false };
  }
  return globalForWorker.scanUploadWorker;
}

/** Claim and prepare queued scans until the queue is empty. Never throws: a failing scan is recorded
 * on its row, with the reason the card shows, and the next one is picked up. */
async function drain(): Promise<void> {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  try {
    for (;;) {
      const uploadId = await claimNextScanUpload();
      if (!uploadId) return;
      try {
        await prepareScanUpload(uploadId);
      } catch (err) {
        console.error(`[scan-uploads] preparing scan ${uploadId} failed`, err);
        await failScanUpload(uploadId, err);
      }
    }
  } catch (err) {
    // Claiming itself failed (a DB hiccup) — the next poll retries.
    console.error("[scan-uploads] worker pass failed", err);
  } finally {
    s.draining = false;
  }
}

/** Nudge the worker after a scan joins the queue. Fire-and-forget; failures are logged in `drain`. */
export function kickScanUploadWorker(): void {
  void drain();
}

/** Start the worker: requeue what a previous process left mid-preparation, then poll. Idempotent. */
export async function startScanUploadWorker(): Promise<void> {
  const s = state();
  if (s.timer) return;

  try {
    const requeued = await requeueStalledScanUploads();
    if (requeued > 0) {
      console.log(`[scan-uploads] requeued ${requeued} scan(s) left mid-preparation by a restart`);
    }
  } catch (err) {
    console.error("[scan-uploads] requeue of stalled preparations failed", err);
  }

  // `unref` so the timer never keeps the process alive on its own (e.g. graceful shutdown).
  s.timer = setInterval(() => void drain(), POLL_INTERVAL_MS);
  s.timer.unref?.();
  void drain();
}
