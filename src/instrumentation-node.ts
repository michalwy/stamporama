// Node.js-only instrumentation body, split out of `instrumentation.ts`. The entry imports this
// lazily behind a positive `process.env.NEXT_RUNTIME === "nodejs"` guard, which the bundler
// statically eliminates when compiling the entry for the Edge runtime — so this module (and the
// server-only deps it reaches: Prisma, fs, and the GCS SDK, which `require`s node's `stream`) is
// never pulled into the Edge bundle. A `!== "nodejs"` early-return inside the entry did NOT
// achieve that elimination, which is why webpack failed to resolve `stream` for the Edge target.
//
// Starts the in-process background work, both reusing the app's existing DB + storage clients so
// there is no separate compose service:
//
//   - the orphan-GC sweep for abandoned photo staging uploads (#112) — an hourly, idempotent
//     `DELETE ... WHERE createdAt < cutoff` plus best-effort byte deletion;
//   - the offer photo generation worker (#311) — drains the render queue one job at a time and
//     requeues anything a previous process left mid-render;
//   - the Allegro sold-listing sync (#467) — a quarter-hourly pass over every connected collection,
//     which is what makes the worklist a list that fills itself rather than one that has to be
//     asked for.

import { gcStaleUploads } from "@/lib/photos";
import { startOfferPhotoWorker } from "@/lib/offer-photo-worker";
import { logStorageStartup } from "@/lib/storage";
import { syncAllAllegroCollections } from "@/lib/allegro-sync";
import { SYNC_INTERVAL_MS } from "@/lib/allegro-sync-rules";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

let started = false;

export async function start(): Promise<void> {
  if (started) return;
  started = true;

  // Report the configured photo-storage backend and probe it once at boot, so a misconfigured
  // volume or bucket surfaces in the logs immediately rather than on the first upload (#138).
  await logStorageStartup();

  const sweep = async () => {
    try {
      const swept = await gcStaleUploads();
      if (swept > 0) {
        console.log(`[photo-gc] swept ${swept} stale staging upload(s)`);
      }
    } catch (err) {
      console.error("[photo-gc] sweep failed", err);
    }
  };

  // Run once shortly after boot, then hourly. `unref` so the timer never keeps the process
  // alive on its own (e.g. during graceful shutdown).
  const initial = setTimeout(sweep, 30_000);
  const interval = setInterval(sweep, SWEEP_INTERVAL_MS);
  initial.unref?.();
  interval.unref?.();

  // The Allegro sold-listing sync (#467). Same shape as the sweep above: once shortly after boot,
  // then on its own interval, `unref`'d so it never holds the process up. A pass that throws is
  // logged and nothing more — the failure is already latched onto the collection's own sync state,
  // which is where the worklist reads it from and says so on screen.
  const allegro = async () => {
    try {
      const results = await syncAllAllegroCollections();
      const failed = results.filter((r) => r.outcome.status === "failed");
      const written = results.reduce((sum, r) => sum + r.outcome.linesWritten, 0);
      if (written > 0 || failed.length > 0) {
        console.log(
          `[allegro-sync] ${results.length} collection(s), ${written} order line(s), ${failed.length} failed`
        );
      }
    } catch (err) {
      console.error("[allegro-sync] pass failed", err);
    }
  };

  const allegroInitial = setTimeout(allegro, 60_000);
  const allegroInterval = setInterval(allegro, SYNC_INTERVAL_MS);
  allegroInitial.unref?.();
  allegroInterval.unref?.();

  // Offer photo generation (#311). Starting it here is what makes Generate a background job: the
  // action only enqueues, and this worker renders. Never lets a startup failure abort boot.
  await startOfferPhotoWorker().catch((err) => {
    console.error("[offer-photos] worker failed to start", err);
  });
}
