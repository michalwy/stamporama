// Next.js server boot hook. Starts the in-process orphan-GC sweep for abandoned photo
// staging uploads (#112) — an hourly, idempotent `DELETE ... WHERE createdAt < cutoff` plus
// best-effort byte deletion. Reuses the app's existing DB + storage clients, so there is no
// separate compose service and docker-compose.prod.yml stays untouched. Guarded to run only
// in the Node.js server runtime (not Edge) and only once per process.

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

let started = false;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return;
  started = true;

  // Imported lazily so the Edge runtime never pulls in server-only modules (Prisma, fs).
  const { gcStaleUploads } = await import("@/lib/photos");

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
