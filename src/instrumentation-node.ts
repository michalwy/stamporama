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
//   - the closed-offer photo purge (#512) — an hourly pass deleting the generated images of listings
//     that have been sold or withdrawn longer than the grace period. Its own timer rather than a
//     branch of the sweep above: they answer to different TTLs, and either can be switched off
//     without the other noticing;
//   - the Allegro sold-listing sync (#467) — a quarter-hourly pass over every connected collection,
//     which is what makes the worklist a list that fills itself rather than one that has to be
//     asked for;
//   - the Allegro event poll (#481) — a two-minute poll over both of Allegro's event streams, which
//     is what makes a bid on one of your auctions, and an order landing, visible within minutes.
//     Its own timer rather than a faster sync: it reads what *changed* and so costs two requests
//     when nothing did, where a sync re-reads the whole account.

import { gcStaleUploads } from "@/lib/photos";
import { formatBytes } from "@/lib/format-bytes";
import {
  closedOfferPhotoTtlMs,
  describeClosedOfferPhotoTtl,
} from "@/lib/offer-photo-cleanup-rules";
import { purgeClosedOfferPhotos } from "@/lib/offer-photo-generation";
import { startOfferPhotoWorker } from "@/lib/offer-photo-worker";
import { logStorageStartup } from "@/lib/storage";
import { pollAllAllegroEvents, syncAllAllegroCollections } from "@/lib/allegro-sync";
import { EVENT_POLL_INTERVAL_MS, SYNC_INTERVAL_MS } from "@/lib/allegro-sync-rules";

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

  // The closed-offer photo purge (#512). Same shape and the same hourly cadence as the sweep above,
  // offset from it so a boot does not run both at once. A generated image is the one photo the app
  // can always make again, so a listing that has been over for a week keeps its plan and loses only
  // its bytes; Regenerate brings them back.
  const purge = async () => {
    try {
      const freed = await purgeClosedOfferPhotos();
      if (freed.offers > 0) {
        console.log(
          `[offer-photos] purged ${freed.photos} generated image(s) from ${freed.offers} closed ` +
            `offer(s), freeing ${formatBytes(freed.bytes)}`
        );
      }
    } catch (err) {
      console.error("[offer-photos] closed-offer purge failed", err);
    }
  };

  // Said once at boot, whatever the setting is — including `off`, which is the one an operator most
  // wants confirmed. A scheduled deletion that only announces itself the first time it deletes
  // something is a scheduled deletion nobody knew was configured.
  console.log(`[offer-photos] closed-offer purge: ${describeClosedOfferPhotoTtl(closedOfferPhotoTtlMs())}`);

  const purgeInitial = setTimeout(purge, 45_000);
  const purgeInterval = setInterval(purge, SWEEP_INTERVAL_MS);
  purgeInitial.unref?.();
  purgeInterval.unref?.();

  // The Allegro sold-listing sync (#467). Same shape as the sweep above: once shortly after boot,
  // then on its own interval, `unref`'d so it never holds the process up. A pass that throws is
  // logged and nothing more — the failure is already latched onto the collection's own sync state,
  // which is where the worklist reads it from and says so on screen.
  const allegro = async () => {
    try {
      const results = await syncAllAllegroCollections();
      const failed = results.filter((r) => r.outcome.status === "failed");
      const written = results.reduce((sum, r) => sum + r.outcome.linesWritten, 0);
      const rematched = results.reduce((sum, r) => sum + r.outcome.rematched, 0);
      if (written > 0 || rematched > 0 || failed.length > 0) {
        console.log(
          `[allegro-sync] ${results.length} collection(s), ${written} order line(s), ` +
            `${rematched} rematched, ${failed.length} failed`
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

  // The Allegro event poll (#481). Quiet by design: it logs only when something actually moved, so
  // a poll that read two empty event pages leaves no trace at all — at thirty polls an hour,
  // anything else would bury the lines that matter.
  const events = async () => {
    try {
      const results = await pollAllAllegroEvents();
      const failed = results.filter((r) => r.outcome.status === "failed");
      const flagged = results.reduce((sum, r) => sum + r.outcome.biddingFlagged, 0);
      const refreshed = results.reduce((sum, r) => sum + r.outcome.bidsRefreshed, 0);
      const written = results.reduce((sum, r) => sum + r.outcome.linesWritten, 0);
      if (flagged > 0 || refreshed > 0 || written > 0 || failed.length > 0) {
        console.log(
          `[allegro-events] ${flagged} auction(s) marked in bidding, ` +
            `${refreshed} bid(s) refreshed, ${written} order line(s), ${failed.length} failed`
        );
      }
    } catch (err) {
      console.error("[allegro-events] poll failed", err);
    }
  };

  // Offset from the sync's own first run so a boot does not fire both at once.
  const eventsInitial = setTimeout(events, 90_000);
  const eventsInterval = setInterval(events, EVENT_POLL_INTERVAL_MS);
  eventsInitial.unref?.();
  eventsInterval.unref?.();

  // Offer photo generation (#311). Starting it here is what makes Generate a background job: the
  // action only enqueues, and this worker renders. Never lets a startup failure abort boot.
  await startOfferPhotoWorker().catch((err) => {
    console.error("[offer-photos] worker failed to start", err);
  });
}
