import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "../../src/lib/db";
import { promoteCopyPhotoToStamp } from "../../src/lib/photos";
import { FilesystemStorage } from "../../src/lib/storage/filesystem";
import { permanentPrefix, variantKey } from "../../src/lib/storage/keys";
import type {
  ResolveResult,
  Storage,
  StorageInput,
  StorageObject,
} from "../../src/lib/storage/types";

// Promoting a copy photo to its stamp used to stream every byte down from the backend and back up
// to it, once per photoless ancestor (#1134). The backend can copy inside itself — `GcsStorage.move`
// has always relied on that very operation — so what this file pins is the **transfer count**, not
// the rows: the rows were always right and are what made the cost invisible.
//
// The three-level case from the issue is the one measured: a copy identified to a **variant**,
// under an **umbrella**, under an **issue**, neither ancestor carrying a photo, so #347's
// propagation writes three stamp photos of two variants each.

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-promote-copy-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

const MIME = "image/jpeg";
const FULL = Buffer.from("full-bytes-of-one-stamp");
const THUMB = Buffer.from("thumb-bytes");

/**
 * A stand-in for a remote backend that counts what it is asked for, with `copy` counted **apart
 * from** `get` and `put`. That separation is the measurement: a server-side copy is the backend
 * duplicating an object inside itself, and the claim under test is that it costs neither of the
 * other two.
 */
class CountingStorage implements Storage {
  readonly backend = "gcs" as const;
  readonly objects = new Map<string, Buffer>();
  gets = 0;
  puts = 0;
  copies = 0;

  async put(key: string, input: StorageInput): Promise<void> {
    this.puts += 1;
    this.objects.set(key, Buffer.isBuffer(input) ? input : await collect(input));
  }

  async get(key: string, mime: string): Promise<StorageObject> {
    this.gets += 1;
    const held = this.objects.get(key);
    if (!held) throw new Error(`No such object: ${key}`);
    return { stream: Readable.from(held), sizeBytes: held.byteLength, mime };
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

  async copy(fromKey: string, toKey: string): Promise<void> {
    this.copies += 1;
    const held = this.objects.get(fromKey);
    if (!held) throw new Error(`No such object: ${fromKey}`);
    // A fresh Buffer, never the same reference: two photos sharing one object would pass every
    // assertion about bytes while making the independence this whole promotion rests on a fiction.
    this.objects.set(toKey, Buffer.from(held));
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
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// The GCS binding is pinned to `globalThis` so `next dev`'s HMR cannot stack a second client
// (`src/lib/storage/index.ts`), and that pin is the only seam through which a test can put a
// counting backend behind `getStorage("gcs")` / `getActiveStorage()` without adding a production
// hook that exists for tests alone. Node's test runner gives each file its own process, and the
// values are restored in `after` regardless.
const globalForStorage = globalThis as unknown as {
  gcs?: unknown;
  gcsCached?: unknown;
};

const ts = Date.now();

describe("promoting a copy photo up the variant tree", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let issueId: string;
  let umbrellaId: string;
  let variantId: string;
  let remote: CountingStorage;

  const savedBackend = process.env.STAMPORAMA_STORAGE_BACKEND;
  const savedGcs = globalForStorage.gcs;
  const savedGcsCached = globalForStorage.gcsCached;

  before(async () => {
    userId = `test-user-promote-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User promote-${ts}`,
        email: `test-promote-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-promote-${ts}`,
          name: "Promote",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    if (savedBackend === undefined) delete process.env.STAMPORAMA_STORAGE_BACKEND;
    else process.env.STAMPORAMA_STORAGE_BACKEND = savedBackend;
    globalForStorage.gcs = savedGcs;
    globalForStorage.gcsCached = savedGcsCached;
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // A fresh tree per test: the walk stops at the first ancestor that already has a photo, so a
    // tree carrying the previous test's photos would measure one target instead of three.
    issueId = (
      await prisma.stamp.create({ data: { collectionId, name: `Issue ${randomName()}` } })
    ).id;
    umbrellaId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Umbrella ${randomName()}`,
          parentId: issueId,
          actsAsVariantOverride: true,
        },
      })
    ).id;
    variantId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Variant ${randomName()}`,
          parentId: umbrellaId,
          actsAsVariantOverride: true,
        },
      })
    ).id;

    remote = new CountingStorage();
    globalForStorage.gcs = remote;
    globalForStorage.gcsCached = remote;
  });

  /** A copy of `variantId`, with a `front` photo whose bytes sit on `backend`. */
  async function copyWithFrontPhoto(backend: "gcs" | "filesystem"): Promise<{
    photoId: string;
    prefix: string;
  }> {
    const itemNo = await nextItemNo();
    const item = await prisma.item.create({
      data: { collectionId, itemNo, stampId: variantId, conditionId },
    });
    const photo = await prisma.photo.create({
      data: {
        itemId: item.id,
        role: "front",
        storageBackend: backend,
        storageKey: "placeholder",
        mime: MIME,
        width: 1200,
        height: 1600,
        originalWidth: 2400,
        originalHeight: 3200,
        sizeBytes: FULL.byteLength,
      },
    });
    const prefix = permanentPrefix(collectionId, photo.id);
    await prisma.photo.update({ where: { id: photo.id }, data: { storageKey: prefix } });

    const target: Storage = backend === "gcs" ? remote : new FilesystemStorage();
    await target.put(variantKey(prefix, "full", MIME), FULL, MIME, "work");
    await target.put(variantKey(prefix, "thumb", MIME), THUMB, MIME, "work");
    return { photoId: photo.id, prefix };
  }

  async function nextItemNo(): Promise<number> {
    const last = await prisma.item.findFirst({
      where: { collectionId },
      orderBy: { itemNo: "desc" },
      select: { itemNo: true },
    });
    return (last?.itemNo ?? 0) + 1;
  }

  function randomName(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  it("copies server-side: three targets, six objects, and not one byte through the app", async () => {
    process.env.STAMPORAMA_STORAGE_BACKEND = "gcs";
    const { photoId, prefix } = await copyWithFrontPhoto("gcs");
    remote.gets = 0;
    remote.puts = 0;
    remote.copies = 0;

    await promoteCopyPhotoToStamp(userId, photoId, { role: "main", title: null });

    // The issue's own measurement, and the whole point of the change. Before it, this same tree
    // cost 6 downloads + 6 uploads: two variants fetched and re-uploaded once per target, because
    // the variant loop sat inside the duplication and the ancestor walk sat outside it.
    // Asserted as one object rather than three equalities so that a regression reports the whole
    // measurement — a run that fails on `gets` alone tells you nothing about where the bytes went.
    assert.deepEqual(
      { gets: remote.gets, puts: remote.puts, copies: remote.copies },
      { gets: 0, puts: 0, copies: 6 },
      "three targets × two variants, every one copied inside the backend"
    );

    const stampPhotos = await prisma.photo.findMany({
      where: { stampId: { in: [variantId, umbrellaId, issueId] } },
      select: { stampId: true, role: true, storageBackend: true, storageKey: true, mime: true },
    });
    assert.equal(stampPhotos.length, 3, "#347 propagates to both photoless ancestors");
    assert.deepEqual(
      [...stampPhotos.map((p) => p.stampId)].sort(),
      [variantId, umbrellaId, issueId].sort()
    );
    assert.ok(stampPhotos.every((p) => p.role === "main"));

    // Independence (#137): a new key per photo, never a shared one, and the source untouched.
    const keys = new Set([prefix, ...stampPhotos.map((p) => p.storageKey)]);
    assert.equal(keys.size, 4, "four prefixes — nothing shares a key with anything");
    assert.equal(remote.objects.size, 8, "four prefixes × two variants, each stored once");
    for (const p of stampPhotos) {
      assert.deepEqual(remote.objects.get(variantKey(p.storageKey, "full", MIME)), FULL);
      assert.deepEqual(remote.objects.get(variantKey(p.storageKey, "thumb", MIME)), THUMB);
    }

    // …and deleting one really is only one: the bytes behind the other three stay readable.
    const doomed = stampPhotos[0];
    await remote.delete(variantKey(doomed.storageKey, "full", MIME));
    await remote.delete(variantKey(doomed.storageKey, "thumb", MIME));
    assert.equal(remote.objects.size, 6);
    assert.deepEqual(remote.objects.get(variantKey(prefix, "full", MIME)), FULL);
    for (const p of stampPhotos.filter((x) => x.storageKey !== doomed.storageKey)) {
      assert.ok(remote.objects.has(variantKey(p.storageKey, "full", MIME)));
    }
  });

  it("streams once for the whole promotion when the copy is on another backend", async () => {
    // Write-one/read-many (ADR-0011 §2): the photo's recorded backend is not the active one, so
    // there is no server-side path from it and the get-then-put fallback is what runs. What must
    // not survive is the *multiplication* — the source is read once for the promotion, and the two
    // ancestors are copied from the first duplicate, which is already on the active backend.
    process.env.STAMPORAMA_STORAGE_BACKEND = "gcs";
    const { photoId } = await copyWithFrontPhoto("filesystem");
    remote.gets = 0;
    remote.puts = 0;
    remote.copies = 0;

    await promoteCopyPhotoToStamp(userId, photoId, { role: "main", title: null });

    assert.deepEqual(
      { gets: remote.gets, puts: remote.puts, copies: remote.copies },
      { gets: 0, puts: 2, copies: 4 },
      "the cross-backend stream is paid once for the promotion; the ancestors copy from the first duplicate"
    );

    const stampPhotos = await prisma.photo.findMany({
      where: { stampId: { in: [variantId, umbrellaId, issueId] } },
      select: { storageBackend: true, storageKey: true },
    });
    assert.equal(stampPhotos.length, 3);
    assert.ok(
      stampPhotos.every((p) => p.storageBackend === "gcs"),
      "every duplicate lands on the active write backend"
    );
    for (const p of stampPhotos) {
      assert.deepEqual(remote.objects.get(variantKey(p.storageKey, "full", MIME)), FULL);
      assert.deepEqual(remote.objects.get(variantKey(p.storageKey, "thumb", MIME)), THUMB);
    }
  });
});
