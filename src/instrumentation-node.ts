// Node.js-only instrumentation body, split out of `instrumentation.ts`. The entry imports this
// lazily behind a positive `process.env.NEXT_RUNTIME === "nodejs"` guard, which the bundler
// statically eliminates when compiling the entry for the Edge runtime — so this module (and the
// server-only deps it reaches: Prisma, fs, and the GCS SDK, which `require`s node's `stream`) is
// never pulled into the Edge bundle. A `!== "nodejs"` early-return inside the entry did NOT
// achieve that elimination, which is why webpack failed to resolve `stream` for the Edge target.
//
// Starts the in-process orphan-GC sweep for abandoned photo staging uploads (#112) — an hourly,
// idempotent `DELETE ... WHERE createdAt < cutoff` plus best-effort byte deletion. Reuses the
// app's existing DB + storage clients, so there is no separate compose service.

import { gcStaleUploads } from "@/lib/photos";
import { logStorageStartup } from "@/lib/storage";

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
}
