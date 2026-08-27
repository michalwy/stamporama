import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "../db";
import { dataDir } from "./filesystem";
import { bytesToEvict, cacheLowWaterBytes, cacheMaxBytes } from "./cache-rules";
import { scheduleEviction, type EvictionSchedule } from "./cache-eviction-queue";
import type {
  ResolveResult,
  Storage,
  StorageAccess,
  StorageInput,
  StorageObject,
} from "./types";

/**
 * A size-bounded local cache in front of a **remote** storage backend (#591).
 *
 * With a remote backend the app fetches back bytes it wrote seconds earlier: a card scan goes up to
 * the bucket and the very next thing that happens is detection reading it to propose the cut — 200
 * MB up and 200 MB down — and an offer's collages re-read the same copy scans on every
 * regeneration while the collector tunes the parameters. Nothing there is a correctness problem; it
 * is bandwidth, latency and per-operation cost paid over and over for bytes that were on this
 * machine a moment earlier.
 *
 * ## Not the chunk staging
 *
 * `scan-uploads.ts` also writes bytes to local disk, and the two must not be merged by anyone who
 * sees local copies and assumes one mechanism. An upload chunk (#590) **was never remote**: it is
 * written once, read once and deleted, its lifecycle is explicit (finalize, abort, or the sweep),
 * and it never reaches a storage backend at all. Every object here is a *copy of something that
 * still exists remotely*, held on the chance it is wanted again and discardable at any moment
 * without losing anything — which is what makes eviction, a cap and an LRU meaningful here and
 * meaningless there.
 *
 * ## What it is, and what it deliberately is not
 *
 * A **read-through, write-through LRU with a size cap**, not a TTL. The objects are immutable under
 * their key — a photo variant, a sheet's `original` and `view`, written once and never modified —
 * so staleness, the usual job of a TTL, does not exist and there is nothing to invalidate. What is
 * left to protect is disk, and a TTL cannot bound that; a size cap can. The access pattern is
 * *written a moment ago* or *read a moment ago*, which is exactly what least-recently-used keeps.
 *
 * **One cap for the instance**, never one per collection: the resource is a single disk, and a cap
 * per collection makes the total *N* × cap, which an operator cannot bound without knowing how many
 * collections there will be. Several collections worked at once is the case *for* a global LRU —
 * what matters then is the combined working set, which is what the LRU keeps whichever collection
 * each object belongs to. Clearing is per collection all the same and needs no partitioning to be:
 * keys are collection-scoped (ADR-0011), so it is a delete by prefix.
 *
 * **Work, not delivery.** Only reads and writes that pass {@link StorageAccess} `"work"` populate.
 * A read serving bytes to a browser must not: the photo route runs once per thumbnail per list
 * view, and letting it populate would evict the handful of large objects the cache exists for.
 * `resolveUrl` never populates either, arrived at from the other side — the bytes bypass the app
 * entirely, so nothing server-side ever wanted them.
 *
 * **No-op on the filesystem backend.** Those bytes are already local; a copy would be a second one
 * of every object on the same disk, doubling the storage figure the collector reads. `withCache`
 * below never wraps it.
 *
 * ## Drift is expected
 *
 * The row and the file may disagree, and neither trusts the other. A row whose file is gone is a
 * **miss** and the object is fetched; a file with no row is garbage the sweep collects. A cache
 * that throws when its own bookkeeping is stale is worse than no cache, because every caller then
 * has to handle a failure unrelated to what it asked for. The same rule governs every failure in
 * here: a cache that cannot write returns the backend's bytes rather than an error.
 */
export class CachingStorage implements Storage {
  constructor(private readonly inner: Storage) {}

  /** The **inner** binding's identifier — that is what is persisted in `storageBackend`, and a
   * cache is not somewhere bytes live. */
  get backend() {
    return this.inner.backend;
  }

  async put(
    key: string,
    input: StorageInput,
    mime: string,
    access: StorageAccess
  ): Promise<void> {
    if (access !== "work" || !cacheEnabled()) {
      await this.inner.put(key, input, mime, access);
      return;
    }

    // A buffer is already in memory, so the backend write is unchanged and the local copy is a
    // best-effort afterthought — a failed copy costs a later fetch and nothing else.
    if (Buffer.isBuffer(input)) {
      await this.inner.put(key, input, mime, access);
      await this.store(key, async (file) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(file, input);
      });
      return;
    }

    // A stream is written to the cache **first** and uploaded from there. Not an optimisation: a
    // retained card scan arrives as a stream precisely because nothing may hold it whole (#590),
    // so the alternatives are buffering 200 MB to tee it or reading it twice from a source that
    // may not be re-readable. Landing it on disk once and uploading from the file does neither,
    // and the copy the operation is about to read is already there.
    const file = cachePath(this.backend, key);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await pipeline(input, createWriteStream(file));
    } catch (err) {
      await rm(file, { force: true }).catch(() => {});
      throw err;
    }
    try {
      await this.inner.put(key, createReadStream(file), mime, access);
    } catch (err) {
      // The remote write is the one that mattered; a local copy of an object that is not there
      // would be a lie the next reader believes.
      await this.forget(key);
      throw err;
    }
    await this.record(key).catch(() => {});
  }

  async get(
    key: string,
    mime: string,
    access: StorageAccess
  ): Promise<StorageObject> {
    if (access !== "work" || !cacheEnabled()) {
      return this.inner.get(key, mime, access);
    }

    const file = cachePath(this.backend, key);
    const hit = await stat(file).catch(() => null);
    if (hit?.isFile()) {
      // Touch and serve. The row is updated without awaiting the read: an LRU that made every
      // reader wait on a write would be paying for the bookkeeping twice.
      await touch(this.backend, key, hit.size).catch(() => {});
      return { stream: createReadStream(file), sizeBytes: hit.size, mime };
    }
    // A row whose file has gone is a miss, not an error — so clear it and fetch.
    if (hit === null) await dropRow(this.backend, key).catch(() => {});

    const object = await this.inner.get(key, mime, access);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await pipeline(object.stream, createWriteStream(file));
    } catch {
      // Populating failed and the backend's stream is spent, so ask for it again rather than fail
      // a caller over a cache. Rare, and one extra fetch is the whole cost.
      await rm(file, { force: true }).catch(() => {});
      return this.inner.get(key, mime, access);
    }
    await this.record(key).catch(() => {});
    const info = await stat(file).catch(() => null);
    return {
      stream: createReadStream(file),
      sizeBytes: info?.size ?? object.sizeBytes,
      mime,
    };
  }

  /** Delete-through: a cached copy must not outlive the object it copies, or a retention sweep
   * would leave the bytes it deleted readable from here. */
  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
    await this.forget(key);
  }

  /** A move is a delete at the source, so the copy there is dropped rather than renamed. The
   * destination's copy is dropped too — anything held under a key being written is now stale. */
  async move(fromKey: string, toKey: string): Promise<void> {
    await this.inner.move(fromKey, toKey);
    await this.forget(fromKey);
    await this.forget(toKey);
  }

  /** Never populates: on a redirect the bytes bypass the app entirely, and on a stream this is the
   * serving route handing them to a browser. Neither is work. */
  async resolveUrl(key: string, mime: string): Promise<ResolveResult> {
    return this.inner.resolveUrl(key, mime);
  }

  describe(): string {
    const max = cacheMaxBytes();
    return (
      this.inner.describe() +
      (max > 0
        ? ` + local cache (${Math.round(max / (1024 * 1024))} MB cap)`
        : " + local cache disabled")
    );
  }

  async healthCheck(): Promise<void> {
    await this.inner.healthCheck();
  }

  /** Write the local copy through `write`, then index it. Best-effort throughout: this is the
   * path where a full disk must cost a later fetch and nothing more. */
  private async store(
    key: string,
    write: (file: string) => Promise<void>
  ): Promise<void> {
    const file = cachePath(this.backend, key);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await write(file);
      await this.record(key);
    } catch {
      await rm(file, { force: true }).catch(() => {});
    }
  }

  /** Index a file already on disk, and let the pass that keeps the cap run if this pushed it over. */
  private async record(key: string): Promise<void> {
    const file = cachePath(this.backend, key);
    const info = await stat(file);
    const sizeBytes = Math.min(info.size, 2_147_483_647);
    await prisma.storageCacheEntry.upsert({
      where: { backend_key: { backend: this.backend, key } },
      create: { backend: this.backend, key, sizeBytes },
      update: { sizeBytes, lastUsedAt: new Date() },
    });
    // Not awaited: the writer must not wait on the bookkeeping. Caught all the same, because an
    // unhandled rejection from a cache is a process-level failure over scratch bytes.
    void evictIfOverCap().catch(() => {});
  }

  /** Drop a cached copy and its row, in that order and best-effort. */
  private async forget(key: string): Promise<void> {
    await rm(cachePath(this.backend, key), { force: true }).catch(() => {});
    await dropRow(this.backend, key).catch(() => {});
  }
}

/**
 * Wrap a binding in the cache — unless it is the filesystem, which is a no-op by design: those
 * bytes are already local, and a second copy on the same disk would double the storage figure the
 * collector reads in Settings. The default deployment must not pay for a problem it does not have.
 */
export function withCache(storage: Storage): Storage {
  if (storage.backend === "filesystem") return storage;
  return new CachingStorage(storage);
}

function cacheEnabled(): boolean {
  return cacheMaxBytes() > 0;
}

/** Where the copies live: `<dataDir>/cache/<backend>/<key>`. Beside the photos root rather than
 * inside it, so nothing measuring the collection's stored bytes on disk can mistake scratch for
 * data. */
export function cacheRoot(): string {
  return path.join(dataDir(), "cache");
}

/** Resolve a cached object's path, with the same traversal guard the filesystem binding uses.
 * Keys are app-generated, so this is belt and braces. */
function cachePath(backend: string, key: string): string {
  const root = path.join(cacheRoot(), backend);
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Storage key escapes cache root: ${key}`);
  }
  return resolved;
}

async function touch(
  backend: string,
  key: string,
  sizeBytes: number
): Promise<void> {
  // `upsert`, not `update`: the file may be here with no row (a sweep that lost a race, a restore
  // of the volume), and a hit is the right moment to adopt it rather than leave it as garbage.
  await prisma.storageCacheEntry.upsert({
    where: { backend_key: { backend, key } },
    create: { backend, key, sizeBytes },
    update: { lastUsedAt: new Date(), sizeBytes },
  });
}

async function dropRow(backend: string, key: string): Promise<void> {
  await prisma.storageCacheEntry.deleteMany({ where: { backend, key } });
}

/** What one eviction or sweep pass freed. */
export interface StorageCacheSweep {
  /** Cached copies deleted. */
  files: number;
  /** What their rows said they held. */
  bytes: number;
}

/** Instance-wide usage, against the cap it is bounded by. */
export interface StorageCacheUsage {
  bytes: number;
  entries: number;
  maxBytes: number;
}

export async function storageCacheUsage(): Promise<StorageCacheUsage> {
  const agg = await prisma.storageCacheEntry.aggregate({
    _sum: { sizeBytes: true },
    _count: true,
  });
  return {
    bytes: agg._sum.sizeBytes ?? 0,
    entries: agg._count,
    maxBytes: cacheMaxBytes(),
  };
}

/** This collection's share of the figure above. The cap stays whole — only the breakdown is per
 * collection — and it is a prefix sum because keys are collection-scoped. */
export async function collectionStorageCacheBytes(
  collectionId: string
): Promise<number> {
  const agg = await prisma.storageCacheEntry.aggregate({
    where: { key: { startsWith: `${collectionId}/` } },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

/**
 * Empty one collection's share of the cache. Safe by construction — every object in it is
 * re-fetchable, that being what makes it a cache — so an operator who needs the disk back now does
 * not have to wait for eviction to arrive at it.
 */
export async function clearStorageCacheForCollection(
  collectionId: string
): Promise<StorageCacheSweep> {
  const rows = await prisma.storageCacheEntry.findMany({
    where: { key: { startsWith: `${collectionId}/` } },
    select: { backend: true, key: true, sizeBytes: true },
  });
  return removeEntries(rows);
}

// Eviction is scheduled rather than merely serialized, and `cache-eviction-queue.ts` carries the
// reasoning: a caller reaches it because it has just added bytes, so joining a pass whose total
// predates them would answer "bring the cache back under the cap" with a pass that cannot see the
// object which pushed it over. Pinned to `globalThis` for the reason `db.ts` and the GCS binding
// are — a module-level `let` resets on every `next dev` hot reload, which would let a second pass
// start beside the one already running.
const globalForCache = globalThis as unknown as {
  storageCacheEviction?: EvictionSchedule<StorageCacheSweep>;
};

/**
 * Bring the cache back inside its cap if it has grown past it, freeing down to the low-water mark
 * so a run of writes pays for one pass rather than one per write.
 *
 * Called after every populate rather than only on a timer: an hourly pass alone would leave disk
 * bounded by *how much was written in an hour*, which for card scans is the whole problem. The cap
 * check is one `SUM`, and the pass itself does nothing at all while the cache is inside it.
 *
 * Awaiting what this returns means *the cache has been measured since I called*.
 */
export function evictIfOverCap(): Promise<StorageCacheSweep> {
  return scheduleEviction((globalForCache.storageCacheEviction ??= {}), evictOnce);
}

async function evictOnce(): Promise<StorageCacheSweep> {
  const maxBytes = cacheMaxBytes();
  const agg = await prisma.storageCacheEntry.aggregate({ _sum: { sizeBytes: true } });
  const used = agg._sum.sizeBytes ?? 0;
  const target = bytesToEvict(used, maxBytes);
  if (target <= 0) return { files: 0, bytes: 0 };

  // Oldest-used first, taken in batches so a cache holding thousands of small objects is never
  // read whole into memory to free a few hundred megabytes.
  const doomed: { backend: string; key: string; sizeBytes: number }[] = [];
  let freed = 0;
  let skip = 0;
  while (freed < target) {
    const batch = await prisma.storageCacheEntry.findMany({
      orderBy: [{ lastUsedAt: "asc" }, { key: "asc" }],
      take: 200,
      skip,
      select: { backend: true, key: true, sizeBytes: true },
    });
    if (batch.length === 0) break;
    skip += batch.length;
    for (const row of batch) {
      doomed.push(row);
      freed += row.sizeBytes;
      if (freed >= target) break;
    }
  }
  const swept = await removeEntries(doomed);
  if (swept.files > 0) {
    console.log(
      `[storage-cache] evicted ${swept.files} cached object(s), freeing ${swept.bytes} B ` +
        `(cap ${maxBytes} B, low-water ${cacheLowWaterBytes(maxBytes)} B)`
    );
  }
  return swept;
}

/** Delete the copies these rows describe, then the rows. Bytes first, so a failure leaves a file
 * the orphan pass collects rather than a row pointing at nothing. */
async function removeEntries(
  rows: readonly { backend: string; key: string; sizeBytes: number }[]
): Promise<StorageCacheSweep> {
  if (rows.length === 0) return { files: 0, bytes: 0 };
  await Promise.all(
    rows.map((row) =>
      rm(cachePath(row.backend, row.key), { force: true }).catch(() => {})
    )
  );
  await prisma.$transaction(
    rows.map((row) =>
      prisma.storageCacheEntry.deleteMany({
        where: { backend: row.backend, key: row.key },
      })
    )
  );
  return {
    files: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
  };
}

/**
 * The hourly pass (#591): evict to the cap, then collect what drift has left behind — files with
 * no row, and rows with no file. The cap itself is kept by {@link evictIfOverCap} on every
 * populate; this exists for the two halves of the bookkeeping getting out of step, which they are
 * allowed to do.
 */
export async function sweepStorageCache(): Promise<StorageCacheSweep> {
  if (cacheMaxBytes() <= 0) {
    // Switched off after having been on: hold nothing rather than leave the last cap's worth of
    // scratch on the disk of the operator who just said they had none to spare.
    const rows = await prisma.storageCacheEntry.findMany({
      select: { backend: true, key: true, sizeBytes: true },
    });
    const cleared = await removeEntries(rows);
    await rm(cacheRoot(), { recursive: true, force: true }).catch(() => {});
    return cleared;
  }

  const evicted = await evictIfOverCap();

  // Rows whose file has gone: cheap to check and they otherwise inflate the figure the cap is
  // measured against, which would make the cache evict live objects to make room for nothing.
  const rows = await prisma.storageCacheEntry.findMany({
    select: { backend: true, key: true, sizeBytes: true },
  });
  const missing: typeof rows = [];
  for (const row of rows) {
    const info = await stat(cachePath(row.backend, row.key)).catch(() => null);
    if (!info) missing.push(row);
  }
  if (missing.length > 0) {
    await prisma.$transaction(
      missing.map((row) =>
        prisma.storageCacheEntry.deleteMany({
          where: { backend: row.backend, key: row.key },
        })
      )
    );
  }

  // Files with no row: garbage, by the same rule read the other way round.
  const held = new Set(
    rows
      .filter((row) => !missing.some((m) => m.backend === row.backend && m.key === row.key))
      .map((row) => cachePath(row.backend, row.key))
  );
  const orphans = await collectOrphanFiles(cacheRoot(), held);

  return {
    files: evicted.files + orphans.files,
    bytes: evicted.bytes + orphans.bytes,
  };
}

/** Walk the cache directory and delete every file no row claims. */
async function collectOrphanFiles(
  dir: string,
  held: ReadonlySet<string>
): Promise<StorageCacheSweep> {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return { files, bytes };
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectOrphanFiles(full, held);
      files += nested.files;
      bytes += nested.bytes;
      // An empty directory left by an eviction is noise, not garbage worth counting.
      await rm(full, { recursive: false }).catch(() => {});
      continue;
    }
    if (held.has(full)) continue;
    const info = await stat(full).catch(() => null);
    await rm(full, { force: true }).catch(() => {});
    files += 1;
    bytes += info?.size ?? 0;
  }
  return { files, bytes };
}
