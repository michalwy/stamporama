import "server-only";
import { activeMailProvider, attemptMail, claimNextDueMail, enqueueMail, requeueStalledMail } from "./messages";

/**
 * In-process worker sending queued mail (#1372; ADR-0018, ADR-0060).
 *
 * The same shape as the offer photo worker: the queue is a table, the worker a timer in the app
 * process started from `instrumentation-node.ts`, one message at a time. What it adds is **time**: a
 * failed attempt goes back into the queue with a later `nextAttemptAt`, so the poll is also what
 * brings a retry round when it falls due. On an instance with no provider the pass does nothing and
 * queued rows wait — `enqueueMail` writes none there in the first place.
 */

const POLL_INTERVAL_MS = 15_000;

interface WorkerState {
  draining: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// Pinned to `globalThis` so a `next dev` hot reload cannot stack a second interval.
const globalForWorker = globalThis as unknown as { mailWorker?: WorkerState };

function state(): WorkerState {
  if (!globalForWorker.mailWorker) globalForWorker.mailWorker = { draining: false };
  return globalForWorker.mailWorker;
}

async function drain(): Promise<void> {
  const s = state();
  if (s.draining) return;
  const provider = activeMailProvider();
  if (!provider) return;
  s.draining = true;
  try {
    for (;;) {
      const id = await claimNextDueMail();
      if (!id) return;
      const outcome = await attemptMail(id, provider);
      if (outcome === "failed") console.error(`[mail] message ${id} could not be delivered; giving up`);
    }
  } catch (err) {
    console.error("[mail] worker pass failed", err);
  } finally {
    s.draining = false;
  }
}

/** Nudge the worker after queuing, so a message goes now rather than on the next poll. */
export function kickMailWorker(): void {
  void drain();
}

/**
 * Queue a message to the collection owner and nudge the worker. Returns null — and queues nothing —
 * when the instance has no mail provider.
 */
export async function queueMail(
  collectionId: string,
  message: { subject: string; text: string }
): Promise<string | null> {
  const id = await enqueueMail(collectionId, message);
  if (id) kickMailWorker();
  return id;
}

/** Requeue what a previous process left mid-send, then poll. Idempotent. */
export async function startMailWorker(): Promise<void> {
  const s = state();
  if (s.timer) return;
  try {
    const requeued = await requeueStalledMail();
    if (requeued > 0) console.log(`[mail] requeued ${requeued} message(s) left mid-send by a restart`);
  } catch (err) {
    console.error("[mail] requeue of stalled messages failed", err);
  }
  s.timer = setInterval(() => void drain(), POLL_INTERVAL_MS);
  s.timer.unref?.();
  void drain();
}
