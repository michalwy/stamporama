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
//     `DELETE ... WHERE createdAt < cutoff` plus best-effort byte deletion. Since #590 it takes the
//     chunked card-scan uploads that never finished in the same pass, on the same TTL: they are the
//     same class of bytes and answering for them separately would be a second mechanism;
//   - the offer photo generation worker (#311) — drains the render queue one job at a time and
//     requeues anything a previous process left mid-render;
//   - the closed-offer photo purge (#512) — an hourly pass deleting the generated images of listings
//     that have been sold or withdrawn longer than the grace period. Its own timer rather than a
//     branch of the sweep above: they answer to different TTLs, and either can be switched off
//     without the other noticing;
//   - the retained-scan sweep (#578) — an hourly pass deleting the card scans of batches finished
//     with longer than the collection's own period. Ships **off**: a scan is a source, not output,
//     so nothing is swept until a collector asks for it;
//   - the Allegro sold-listing sync (#467) — a quarter-hourly pass over every connected collection,
//     which is what makes the worklist a list that fills itself rather than one that has to be
//     asked for;
//   - the Allegro event poll (#481) — a two-minute poll over both of Allegro's event streams, which
//     is what makes a bid on one of your auctions, and an order landing, visible within minutes.
//     Its own timer rather than a faster sync: it reads what *changed* and so costs two requests
//     when nothing did, where a sync re-reads the whole account.

import { gcStaleUploads } from "@/lib/photos";
import { gcStaleScanUploads } from "@/lib/scan-uploads";
import { formatBytes } from "@/lib/format-bytes";
import { describeClosedOfferPhotoTtl } from "@/lib/offer-photo-cleanup-rules";
import { instanceClosedOfferPhotoTtlMs } from "@/lib/offer-photo-retention";
import { purgeClosedOfferPhotos } from "@/lib/offer-photo-generation";
import { describeScanSheetTtl } from "@/lib/scan-sheet-cleanup-rules";
import { instanceScanSheetTtlMs } from "@/lib/scan-sheet-retention";
import { purgeFinishedScanSheets } from "@/lib/scan-sheets";
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

  // Abandoned staging, both kinds, in one pass on one TTL: a dropped-but-unsaved photo (#112) and a
  // card scan that stopped arriving halfway through (#590) are the same class of thing — bytes the
  // collector has not committed to anything — so `STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS` answers for
  // both rather than a second variable saying the same thing about the same bytes.
  const sweep = async () => {
    try {
      const swept = await gcStaleUploads();
      if (swept > 0) {
        console.log(`[photo-gc] swept ${swept} stale staging upload(s)`);
      }
    } catch (err) {
      console.error("[photo-gc] sweep failed", err);
    }
    try {
      const scans = await gcStaleScanUploads();
      if (scans.uploads > 0) {
        console.log(
          `[photo-gc] swept ${scans.uploads} abandoned card scan upload(s), ` +
            `freeing ${formatBytes(scans.bytes)}`
        );
      }
    } catch (err) {
      console.error("[photo-gc] scan upload sweep failed", err);
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
  //
  // Since #577 this can only honestly state the **instance default**, because a collection may set
  // its own period and the sweep resolves one per collection. So it says exactly that, rather than
  // printing a line per collection at boot: the collections are read on every pass and the log
  // would go stale the moment one was added or changed, while what an operator is checking here is
  // the answer their own environment variable gives.
  console.log(
    `[offer-photos] closed-offer purge, instance default: ` +
      `${describeClosedOfferPhotoTtl(instanceClosedOfferPhotoTtlMs())} — ` +
      `collections may set their own period in Settings`
  );

  const purgeInitial = setTimeout(purge, 45_000);
  const purgeInterval = setInterval(purge, SWEEP_INTERVAL_MS);
  purgeInitial.unref?.();
  purgeInterval.unref?.();

  // The retained-scan sweep (#578). The same shape again, offset once more so a boot does not run
  // three sweeps at once. Unlike the two above it deletes a **source**: a stockbook cannot be
  // re-scanned once it has been broken up, which is why it does nothing at all unless a collection
  // or this instance has asked for it, and why the sheet's row survives with its bytes gone so a
  // re-cut refuses in words rather than failing on a missing file.
  const sweepScans = async () => {
    try {
      const freed = await purgeFinishedScanSheets();
      if (freed.sheets > 0) {
        console.log(
          `[scan-sheets] purged ${freed.sheets} retained scan(s) from finished batches, ` +
            `freeing ${formatBytes(freed.bytes)}`
        );
      }
    } catch (err) {
      console.error("[scan-sheets] retention sweep failed", err);
    }
  };

  // Said at boot like the purge above, and for a stronger reason: this is the one sweep that can
  // delete bytes nothing could ever make again, so an operator must be able to read off the logs
  // that it is switched off — or, if it is not, after how long.
  console.log(
    `[scan-sheets] retained-scan sweep, instance default: ` +
      `${describeScanSheetTtl(instanceScanSheetTtlMs())} — ` +
      `collections may set their own period in Settings`
  );

  const scanInitial = setTimeout(sweepScans, 90_000);
  const scanInterval = setInterval(sweepScans, SWEEP_INTERVAL_MS);
  scanInitial.unref?.();
  scanInterval.unref?.();

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
