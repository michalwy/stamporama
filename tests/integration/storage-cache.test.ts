import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, mkdtempSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "../../src/lib/db";
import {
  CachingStorage,
  cacheRoot,
  clearStorageCacheForCollection,
  storageCacheUsage,
  sweepStorageCache,
  withCache,
} from "../../src/lib/storage/cache";
import { FilesystemStorage } from "../../src/lib/storage/filesystem";
import type {
  ResolveResult,
  Storage,
  StorageInput,
  StorageObject,
} from "../../src/lib/storage/types";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-storage-cache-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The size-bounded local cache in front of a remote backend (#591). Its arithmetic is unit-tested;
// what needs a database and a real disk is the contract the issue is written against:
//
//   - with a remote backend, detection reads a scan the app has just written **without fetching it
//     back**, and regenerating an offer's collages twice fetches its sources **once**;
//   - the filesystem backend stores **nothing twice**;
//   - disk is bounded by the **cap**, not by how much was written in an hour;
//   - a read that delivers bytes to a client populates nothing;
//   - row and file may drift, and neither is allowed to turn that into an error.

/** A stand-in for a remote backend that counts what it is asked for. Every `get` it records is a
 * fetch the cache failed to save, which is the whole measurement here. */
class CountingStorage implements Storage {
  readonly backend = "gcs" as const;
  readonly objects = new Map<string, { bytes: Buffer; mime: string }>();
  gets = 0;
  puts = 0;

  async put(key: string, input: StorageInput, mime: string): Promise<void> {
    this.puts += 1;
    const bytes = Buffer.isBuffer(input) ? input : await collect(input);
    this.objects.set(key, { bytes, mime });
  }

  async get(key: string, mime: string): Promise<StorageObject> {
    this.gets += 1;
    const held = this.objects.get(key);
    if (!held) throw new Error(`No such object: ${key}`);
    return { stream: Readable.from(held.bytes), sizeBytes: held.bytes.byteLength, mime };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const held = this.objects.get(fromKey);
    if (held) {
      this.objects.set(toKey, held);
      this.objects.delete(fromKey);
    }
  }

  async resolveUrl(key: string): Promise<ResolveResult> {
    return { kind: "redirect", url: `https://example.invalid/${key}` };
  }

  describe(): string {
    return "counting (test)";
  }

  async healthCheck(): Promise<void> {}
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readAll(object: StorageObject): Promise<Buffer> {
  return collect(object.stream);
}

/** Every file currently held in the cache directory, however the index feels about it. */
async function cachedFiles(dir = cacheRoot()): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return [];
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await cachedFiles(full)));
    else found.push(full);
  }
  return found;
}

const COLLECTION = "col-one";
const OTHER = "col-two";
const MIME = "image/jpeg";
const MB = 1024 * 1024;

/** A stand-in for a card scan: large enough that the cap is a real constraint in the test. */
function blob(size: number, fill = 7): Buffer {
  return Buffer.alloc(size, fill);
}

describe("local storage cache (#591)", () => {
  before(() => {
    process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB = "8";
  });

  beforeEach(async () => {
    await prisma.storageCacheEntry.deleteMany({});
    await rm(cacheRoot(), { recursive: true, force: true });
    process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB = "8";
  });

  after(async () => {
    await prisma.storageCacheEntry.deleteMany({});
    delete process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB;
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("detection reads the scan the app just wrote without fetching it back", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/sheets/sheet-1/original.jpg`;
    const bytes = blob(64 * 1024, 3);

    // The sheet's own write path: a stream, because nothing may hold a 200 MB card whole (#590).
    await storage.put(key, Readable.from(bytes), MIME, "work");
    assert.equal(remote.puts, 1);

    const read = await storage.get(key, MIME, "work");
    assert.deepEqual(await readAll(read), bytes);
    assert.equal(remote.gets, 0, "the detection read must not go back to the backend");
  });

  it("regenerating an offer's collages twice fetches its sources once", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/photo-1/full.jpg`;
    const bytes = blob(32 * 1024, 5);
    // Written by the copy-photo path as `delivery`, so the cache holds nothing yet.
    await storage.put(key, bytes, MIME, "delivery");

    const first = await storage.get(key, MIME, "work");
    assert.deepEqual(await readAll(first), bytes);
    const second = await storage.get(key, MIME, "work");
    assert.deepEqual(await readAll(second), bytes);

    assert.equal(remote.gets, 1, "the second regeneration must be served locally");
  });

  it("a delivery read populates nothing, whatever the object is", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/photo-2/thumb.jpg`;
    await storage.put(key, blob(4096), MIME, "delivery");

    await readAll(await storage.get(key, MIME, "delivery"));
    await readAll(await storage.get(key, MIME, "delivery"));

    assert.equal(remote.gets, 2);
    assert.equal(await prisma.storageCacheEntry.count(), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("resolveUrl never populates — the bytes bypass the app entirely", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/photo-3/full.jpg`;
    await storage.put(key, blob(4096), MIME, "delivery");

    const resolved = await storage.resolveUrl(key, MIME);
    assert.equal(resolved.kind, "redirect");
    assert.equal(await prisma.storageCacheEntry.count(), 0);
  });

  it("stores nothing twice on the filesystem backend", async () => {
    // `withCache` hands the binding straight back: those bytes are already local, and a copy would
    // double the storage figure the collector reads in Settings.
    const filesystem: Storage = new FilesystemStorage();
    assert.equal(withCache(filesystem), filesystem);

    const key = `${COLLECTION}/photo-4/full.jpg`;
    await filesystem.put(key, blob(2048), MIME, "work");
    await readAll(await filesystem.get(key, MIME, "work"));

    assert.equal(await prisma.storageCacheEntry.count(), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("bounds disk by the cap, not by how much was written", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);

    // Twelve 1 MB objects against an 8 MB cap — the shape of a working session that writes far more
    // than the cache may hold. Written one at a time so their `lastUsedAt` order is the write order.
    for (let i = 0; i < 12; i += 1) {
      await storage.put(`${COLLECTION}/big-${i}/full.jpg`, blob(MB, i), MIME, "work");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await sweepStorageCache();

    const usage = await storageCacheUsage();
    assert.ok(
      usage.bytes <= usage.maxBytes,
      `held ${usage.bytes} B against a ${usage.maxBytes} B cap`
    );
    // And what survived is the most recently used, which is what least-recently-used means.
    const held = await prisma.storageCacheEntry.findMany({ select: { key: true } });
    const keys = held.map((row) => row.key);
    assert.ok(keys.includes(`${COLLECTION}/big-11/full.jpg`));
    assert.ok(!keys.includes(`${COLLECTION}/big-0/full.jpg`));

    // The disk agrees with the index: an eviction takes the file, not only the row.
    const files = await cachedFiles();
    assert.equal(files.length, keys.length);
  });

  it("bounds disk when the populates overlap, not only when they are one at a time", async () => {
    // A collage run populates several sources at once, and that is where the cap used to slip: an
    // eviction pass takes its total at the start, so a populate arriving mid-pass was answered by a
    // pass that could not see the object it had just added. The bound is over the cache once every
    // populate has returned and a sweep has run — no window, whatever the order.
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        storage.put(`${COLLECTION}/burst-${i}/full.jpg`, blob(MB, i), MIME, "work")
      )
    );
    await sweepStorageCache();

    const usage = await storageCacheUsage();
    assert.ok(
      usage.bytes <= usage.maxBytes,
      `held ${usage.bytes} B against a ${usage.maxBytes} B cap`
    );
  });

  it("keeps the object that was used most recently, not the one written most recently", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const oldest = `${COLLECTION}/lru-0/full.jpg`;
    for (let i = 0; i < 6; i += 1) {
      await storage.put(`${COLLECTION}/lru-${i}/full.jpg`, blob(MB, i), MIME, "work");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    // Touch the oldest, then write past the cap — by enough for a pass to run, and not by so much
    // that everything written before the touch would have gone anyway.
    await readAll(await storage.get(oldest, MIME, "work"));
    for (let i = 6; i < 10; i += 1) {
      await storage.put(`${COLLECTION}/lru-${i}/full.jpg`, blob(MB, i), MIME, "work");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await sweepStorageCache();

    const held = await prisma.storageCacheEntry.findMany({ select: { key: true } });
    assert.ok(
      held.some((row) => row.key === oldest),
      "the touched object must outlive the ones written before the touch"
    );
    assert.ok(!held.some((row) => row.key === `${COLLECTION}/lru-1/full.jpg`));
  });

  it("treats a row whose file has gone as a miss, not an error", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/drift-1/full.jpg`;
    const bytes = blob(8192, 9);
    await storage.put(key, bytes, MIME, "work");

    // The volume was restored, or someone tidied up. The row still says the copy is here.
    for (const file of await cachedFiles()) await rm(file, { force: true });

    const read = await storage.get(key, MIME, "work");
    assert.deepEqual(await readAll(read), bytes);
    assert.equal(remote.gets, 1, "a stale row is a miss, and the object is fetched");
  });

  it("collects a file no row claims, and drops a row no file backs", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    await storage.put(`${COLLECTION}/kept/full.jpg`, blob(4096), MIME, "work");

    // Garbage: a copy whose row never landed, or whose row has been evicted already.
    const orphan = path.join(cacheRoot(), "gcs", COLLECTION, "orphan", "full.jpg");
    await mkdir(path.dirname(orphan), { recursive: true });
    await writeFile(orphan, blob(2048));
    // And the other half of the drift: a row whose file is gone.
    await prisma.storageCacheEntry.create({
      data: { backend: "gcs", key: `${COLLECTION}/ghost/full.jpg`, sizeBytes: 1234 },
    });

    const swept = await sweepStorageCache();
    assert.ok(swept.files >= 1);
    assert.equal(await stat(orphan).catch(() => null), null);
    assert.equal(
      await prisma.storageCacheEntry.count({ where: { key: `${COLLECTION}/ghost/full.jpg` } }),
      0
    );
    // The live entry is untouched by either half.
    assert.equal(
      await prisma.storageCacheEntry.count({ where: { key: `${COLLECTION}/kept/full.jpg` } }),
      1
    );
  });

  it("deletes through, so a cached copy cannot outlive its object", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/swept/original.jpg`;
    await storage.put(key, blob(4096), MIME, "work");
    assert.equal(await prisma.storageCacheEntry.count({ where: { key } }), 1);

    // What a retention sweep does (#578).
    await storage.delete(key);

    assert.equal(await prisma.storageCacheEntry.count({ where: { key } }), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("clears one collection's entries and leaves the rest alone", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    await storage.put(`${COLLECTION}/a/full.jpg`, blob(4096), MIME, "work");
    await storage.put(`${COLLECTION}/b/full.jpg`, blob(4096), MIME, "work");
    await storage.put(`${OTHER}/c/full.jpg`, blob(4096), MIME, "work");

    const cleared = await clearStorageCacheForCollection(COLLECTION);
    assert.equal(cleared.files, 2);

    const left = await prisma.storageCacheEntry.findMany({ select: { key: true } });
    assert.deepEqual(
      left.map((row) => row.key),
      [`${OTHER}/c/full.jpg`]
    );
    assert.equal((await cachedFiles()).length, 1);
  });

  it("holds nothing at all when the operator has switched it off", async () => {
    process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB = "off";
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/disabled/original.jpg`;
    const bytes = blob(4096, 1);

    await storage.put(key, Readable.from(bytes), MIME, "work");
    assert.deepEqual(await readAll(await storage.get(key, MIME, "work")), bytes);

    assert.equal(remote.gets, 1, "with no cache, a work read is a fetch");
    assert.equal(await prisma.storageCacheEntry.count(), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("gives the disk back when the cache is switched off after having been on", async () => {
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    await storage.put(`${COLLECTION}/leftover/full.jpg`, blob(4096), MIME, "work");
    assert.equal((await cachedFiles()).length, 1);

    process.env.STAMPORAMA_STORAGE_CACHE_MAX_MB = "0";
    await sweepStorageCache();

    assert.equal(await prisma.storageCacheEntry.count(), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("does not let a failed remote write leave a local copy behind", async () => {
    const remote = new CountingStorage();
    const failing: Storage = {
      ...remote,
      backend: "gcs",
      put: async () => {
        throw new Error("bucket unreachable");
      },
      get: (key: string, mime: string) => remote.get(key, mime),
      delete: (key: string) => remote.delete(key),
      move: (from: string, to: string) => remote.move(from, to),
      resolveUrl: (key: string) => remote.resolveUrl(key),
      describe: () => remote.describe(),
      healthCheck: () => remote.healthCheck(),
    };
    const storage = new CachingStorage(failing);

    await assert.rejects(
      storage.put(`${COLLECTION}/failed/original.jpg`, Readable.from(blob(4096)), MIME, "work"),
      /bucket unreachable/
    );
    // A copy of an object that is not there would be a lie the next reader believes.
    assert.equal(await prisma.storageCacheEntry.count(), 0);
    assert.deepEqual(await cachedFiles(), []);
  });

  it("serves a cached copy from a real file, not from memory", async () => {
    // Not an implementation detail: the point of the cache is that a 200 MB card is never resident,
    // so a hit has to be a stream off the disk.
    const remote = new CountingStorage();
    const storage = new CachingStorage(remote);
    const key = `${COLLECTION}/streamed/original.jpg`;
    const bytes = blob(128 * 1024, 4);
    await storage.put(key, Readable.from(bytes), MIME, "work");

    const files = await cachedFiles();
    assert.equal(files.length, 1);
    assert.deepEqual(await collect(createReadStream(files[0]!)), bytes);

    const hit = await storage.get(key, MIME, "work");
    assert.equal(hit.sizeBytes, bytes.byteLength);
    assert.deepEqual(await readAll(hit), bytes);
  });
});
