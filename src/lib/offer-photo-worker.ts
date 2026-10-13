import "server-only";
import {
  claimNextOfferPhotoGeneration,
  failOfferPhotoGeneration,
  requeueStalledOfferPhotoGenerations,
  runOfferPhotoGeneration,
} from "./offer-photo-generation";
import {
  claimNextFacebookLotPhoto,
  failFacebookLotPhoto,
  refreshFacebookLotPhotosForOffer,
  requeueStalledFacebookLotPhotos,
  runFacebookLotPhoto,
} from "./facebook-lot-photos";
import { settleReadyAfterPhotos } from "./offers";

/**
 * In-process worker draining the offer photo generation queue (#311).
 *
 * Why in-process
 * --------------
 * Same reasoning as the photo orphan-GC sweep: a self-hosted single-container deployment should not
 * grow a second compose service (or a broker) to render a few collages. The queue is a table, the
 * worker is a timer inside the app process, and both are started from `instrumentation.ts`
 * `register()`. Concurrency is deliberately **one job at a time** — rendering is CPU-bound through
 * `sharp`, so running several in parallel would only make the web requests sharing this process slower.
 *
 * Crash safety comes from the queue, not from the worker: a run left `running` by a restart is
 * requeued at boot, and a render is a full replacement, so repeating one is always safe.
 *
 * `kick` exists so pressing Generate feels immediate rather than waiting out the poll interval. It is
 * best-effort and unawaited — the poll is what guarantees the job runs.
 *
 * It drains a second queue behind the first (#1861): the captioned Facebook lot photos, each drawn
 * from its offer's images. The offer queue always goes first, since a lot photo drawn from images
 * about to be replaced would only be drawn again — and an offer run that succeeds brings its post's
 * lot photos in line, which queues them.
 */

const POLL_INTERVAL_MS = 5_000;

interface WorkerState {
  /** A drain pass is in flight; the queue is processed one job at a time. */
  draining: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// Pinned to `globalThis` like the Prisma and GCS clients (`db.ts`, `storage/index.ts`): a plain
// module-level object resets on every `next dev` hot reload, which would leave the old interval
// running and stack a second worker on each recompile.
const globalForWorker = globalThis as unknown as { offerPhotoWorker?: WorkerState };

function state(): WorkerState {
  if (!globalForWorker.offerPhotoWorker) {
    globalForWorker.offerPhotoWorker = { draining: false };
  }
  return globalForWorker.offerPhotoWorker;
}

/** Claim and run queued jobs until both queues are empty, the offers' first. Never throws: a failing
 * job is recorded on its row and the next one is picked up. */
async function drain(): Promise<void> {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  try {
    for (;;) {
      const offerId = await claimNextOfferPhotoGeneration();
      if (offerId) {
        try {
          await runOfferPhotoGeneration(offerId);
        } catch (err) {
          console.error(`[offer-photos] generation failed for offer ${offerId}`, err);
          await failOfferPhotoGeneration(offerId, err);
          await settleReady(offerId, err instanceof Error ? err.message : String(err));
          continue;
        }
        await settleReady(offerId, null);
        try {
          await refreshFacebookLotPhotosForOffer(offerId);
        } catch (err) {
          console.error(`[offer-photos] queueing the lot photo of offer ${offerId} failed`, err);
        }
        continue;
      }
      const lotOfferId = await claimNextFacebookLotPhoto();
      if (!lotOfferId) return;
      try {
        await runFacebookLotPhoto(lotOfferId);
      } catch (err) {
        console.error(`[offer-photos] the Facebook lot photo of offer ${lotOfferId} failed`, err);
        await failFacebookLotPhoto(lotOfferId, err);
      }
    }
  } catch (err) {
    // Claiming itself failed (a DB hiccup) — the next poll retries.
    console.error("[offer-photos] worker pass failed", err);
  } finally {
    s.draining = false;
  }
}

/** End an offer's wait for Ready on this run (#1893) — a no-op for an offer that is not waiting.
 * Never throws: the run's own outcome is already recorded, and the queue must keep draining. */
async function settleReady(offerId: string, failure: string | null): Promise<void> {
  try {
    await settleReadyAfterPhotos(offerId, failure);
  } catch (err) {
    console.error(`[offer-photos] settling the ready wait of offer ${offerId} failed`, err);
  }
}

/** Nudge the worker after enqueuing, so Generate starts rendering now instead of on the next poll.
 * Fire-and-forget by design; failures are logged inside `drain`. */
export function kickOfferPhotoWorker(): void {
  void drain();
}

/** Start the worker: requeue anything a previous process left mid-render, then poll. Idempotent. */
export async function startOfferPhotoWorker(): Promise<void> {
  const s = state();
  if (s.timer) return;

  try {
    const requeued = await requeueStalledOfferPhotoGenerations();
    if (requeued > 0) {
      console.log(`[offer-photos] requeued ${requeued} generation(s) left running by a restart`);
    }
    const lots = await requeueStalledFacebookLotPhotos();
    if (lots > 0) {
      console.log(`[offer-photos] requeued ${lots} Facebook lot photo(s) left running by a restart`);
    }
  } catch (err) {
    console.error("[offer-photos] requeue of stalled generations failed", err);
  }

  // `unref` so the timer never keeps the process alive on its own (e.g. graceful shutdown).
  s.timer = setInterval(() => void drain(), POLL_INTERVAL_MS);
  s.timer.unref?.();
  void drain();
}
