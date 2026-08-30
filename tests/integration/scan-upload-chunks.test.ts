import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { MAX_UPLOAD_BYTES } from "../../src/lib/photos/process";
import { ScanValidationError } from "../../src/lib/scan-sheets";
import {
  abortScanUpload,
  finalizeScanUpload,
  gcStaleScanUploads,
  openScanUpload,
  receiveScanChunk,
  uploadChunkBytes,
} from "../../src/lib/scan-uploads";
import { getStorage, sheetVariantKey } from "../../src/lib/storage";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-chunks-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;
// Small enough that a modest test image is genuinely several parts, so the ordering, the retry and
// the assembly are exercised rather than asserted over a single chunk.
process.env.STAMPORAMA_UPLOAD_CHUNK_KB = "64";

/**
 * A card scan uploaded in **chunks** (#590).
 *
 * What is being proved is that chunking is a transport detail and nothing more: the sheet that comes
 * out the far end is byte-for-byte the file that went in, so `prepareSheet`, the retained original,
 * the `view` derivative and everything downstream meet exactly what they met before.
 *
 * Beside that, the three promises the mechanism makes:
 *
 *   - a **retry re-sends the chunk, not the file** — a part already held is acknowledged, and a gap
 *     is refused with how far the server got;
 *   - a scan over `MAX_UPLOAD_BYTES` is refused at the **open**, before a byte is sent;
 *   - an **abandoned upload leaves nothing behind**, whether it is given up on or swept.
 */
describe("chunked card scan upload (#590)", () => {
  let userId: string;
  let collectionId: string;
  let purchaseId: string;
  let nextPurchaseNo = 1;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-chunks-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User chunks-${ts}`,
        email: `test-chunks-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-chunks-${ts}`,
        name: `Collection chunks-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    purchaseId = await newOrder();
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function newOrder(): Promise<string> {
    const purchase = await prisma.purchase.create({
      data: {
        collectionId,
        purchaseNo: nextPurchaseNo++,
        purchasedAt: new Date("2026-08-01"),
        currency: "EUR",
        lots: { create: { price: 100 } },
      },
    });
    return purchase.id;
  }

  const CARD_W = 900;
  const CARD_H = 600;

  /**
   * A card big enough to need several chunks at the size configured above.
   *
   * Deliberately **noisy** rather than the flat black card the ingest tests draw: a PNG of a flat
   * colour compresses to a few kilobytes, and a fixture that fits in one chunk would let every
   * assertion below pass without the mechanism being exercised at all. The pattern is generated
   * rather than random so a failure is reproducible.
   */
  async function card(): Promise<Buffer> {
    const raw = Buffer.alloc(CARD_W * CARD_H * 3);
    let seed = 1;
    for (let i = 0; i < raw.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[i] = seed >> 16;
    }
    return sharp(raw, { raw: { width: CARD_W, height: CARD_H, channels: 3 } })
      .png()
      .toBuffer();
  }

  /** Send a whole file the way the client does. */
  async function sendAll(
    bytes: Buffer,
    opts: { side?: "front" | "back"; batchNo?: number; label?: string | null } = {}
  ) {
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: opts.side ?? "front",
      batchNo: opts.batchNo,
      label: opts.label ?? null,
      totalBytes: bytes.byteLength,
    });
    for (let i = 0; i < opened.chunks; i++) {
      const start = i * opened.chunkBytes;
      await receiveScanChunk(
        userId,
        opened.id,
        i,
        bytes.subarray(start, Math.min(start + opened.chunkBytes, bytes.byteLength))
      );
    }
    return { opened, sheet: await finalizeScanUpload(userId, opened.id) };
  }

  it("assembles the parts into exactly the file that was sent", async () => {
    const bytes = await card();
    assert.ok(bytes.byteLength > uploadChunkBytes(), "the fixture must be more than one chunk");

    const { opened, sheet } = await sendAll(bytes, { label: "Klaser Polska 1" });
    assert.ok(opened.chunks > 1);

    // The sheet is the one a single-request upload would have produced: same dimensions, same name,
    // and — the assertion that matters — the retained original is the uploaded bytes untouched.
    assert.equal(sheet.width, CARD_W);
    assert.equal(sheet.height, CARD_H);
    assert.equal(sheet.label, "Klaser Polska 1");

    const row = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    assert.equal(row.sizeBytes, bytes.byteLength);
    const object = await getStorage(row.storageBackend).get(
      sheetVariantKey(row.storageKey, "original", row.mime),
      row.mime,
      "delivery"
    );
    const stored: Buffer[] = [];
    for await (const part of object.stream) stored.push(Buffer.from(part));
    assert.ok(Buffer.concat(stored).equals(bytes), "the retained original is the uploaded bytes");
  });

  it("leaves no staging behind once the scan is stored", async () => {
    const bytes = await card();
    const { opened } = await sendAll(bytes);

    assert.equal(await prisma.scanUpload.count({ where: { id: opened.id } }), 0);
    assert.equal(await stagingExists(opened.id), false);
  });

  it("keeps the parts on local disk and out of the storage backend", async () => {
    const bytes = await card();
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await receiveScanChunk(userId, opened.id, 0, bytes.subarray(0, opened.chunkBytes));

    // The part is under the data directory in a segment of its own...
    await stat(path.join(DATA_DIR, "scan-uploads", opened.id, "part-000000"));
    // ...and nowhere inside `photos/`, which is the filesystem backend's tree. A chunk is written
    // once, read once and deleted, so putting it through the backend would send a 200 MB card up to
    // a bucket and pull it straight back down to be assembled. **This is not a cache** (#591): the
    // bytes were never remote, so there is nothing here to invalidate or evict.
    await assert.rejects(() => stat(path.join(DATA_DIR, "photos", "staging", "scan-uploads")));
    await assert.rejects(() => stat(path.join(DATA_DIR, "photos", "scan-uploads")));

    await abortScanUpload(userId, opened.id);
  });

  it("acknowledges a chunk it already holds, and refuses one that skips ahead", async () => {
    const bytes = await card();
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    const chunkAt = (i: number) =>
      bytes.subarray(
        i * opened.chunkBytes,
        Math.min((i + 1) * opened.chunkBytes, bytes.byteLength)
      );

    const first = await receiveScanChunk(userId, opened.id, 0, chunkAt(0));
    assert.equal(first.received, 1);

    // The retry of a request whose response never arrived. Answered, not refused: failing it would
    // fail an upload that is in fact intact, which is the difference between a mechanism and a
    // nuisance at 200 MB.
    const retry = await receiveScanChunk(userId, opened.id, 0, chunkAt(0));
    assert.equal(retry.received, 1, "a chunk already held is acknowledged and not double-counted");

    await assert.rejects(
      () => receiveScanChunk(userId, opened.id, 2, chunkAt(2)),
      ScanValidationError,
      "a gap is refused — nothing downstream could assemble it"
    );

    // And the whole thing still finishes from where it got to.
    for (let i = 1; i < opened.chunks; i++) {
      await receiveScanChunk(userId, opened.id, i, chunkAt(i));
    }
    const sheet = await finalizeScanUpload(userId, opened.id);
    assert.equal(sheet.width, CARD_W);
  });

  it("refuses a chunk that is not the size the upload expects", async () => {
    const bytes = await card();
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await assert.rejects(
      () => receiveScanChunk(userId, opened.id, 0, bytes.subarray(0, 10)),
      ScanValidationError
    );
    await abortScanUpload(userId, opened.id);
  });

  it("refuses an incomplete scan rather than storing a truncated card", async () => {
    const bytes = await card();
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await receiveScanChunk(userId, opened.id, 0, bytes.subarray(0, opened.chunkBytes));
    await assert.rejects(() => finalizeScanUpload(userId, opened.id), ScanValidationError);
  });

  it("refuses an oversized scan at the open, before a byte is sent", async () => {
    await assert.rejects(
      () =>
        openScanUpload(userId, { purchaseId }, {
          mime: "image/png",
          side: "front",
          totalBytes: MAX_UPLOAD_BYTES + 1,
        }),
      (err: unknown) =>
        err instanceof ScanValidationError && err.message.includes("too large")
    );
    // `MAX_UPLOAD_BYTES` is the app's own judgement about what a card may weigh and is unchanged by
    // chunking — what changes is that the deployment can now actually deliver it.
    assert.equal(MAX_UPLOAD_BYTES, 200 * 1024 * 1024);
  });

  it("leaves nothing behind when an upload is given up on", async () => {
    const bytes = await card();
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await receiveScanChunk(userId, opened.id, 0, bytes.subarray(0, opened.chunkBytes));
    assert.equal(await stagingExists(opened.id), true);

    await abortScanUpload(userId, opened.id);
    assert.equal(await prisma.scanUpload.count({ where: { id: opened.id } }), 0);
    assert.equal(await stagingExists(opened.id), false);
  });

  it("sweeps an upload that stopped arriving, and spares one still making progress", async () => {
    const bytes = await card();
    const stale = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await receiveScanChunk(userId, stale.id, 0, bytes.subarray(0, stale.chunkBytes));
    const live = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: "front",
      totalBytes: bytes.byteLength,
    });
    await receiveScanChunk(userId, live.id, 0, bytes.subarray(0, live.chunkBytes));

    // Age is measured from the last accepted chunk, not from the open: a 200 MB card over a home
    // connection can legitimately be in flight longer than the TTL, and sweeping an upload still
    // making progress would break the very case this exists for.
    await prisma.scanUpload.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const freed = await gcStaleScanUploads();
    assert.ok(freed.uploads >= 1);
    assert.ok(freed.bytes > 0);
    assert.equal(await prisma.scanUpload.count({ where: { id: stale.id } }), 0);
    assert.equal(await stagingExists(stale.id), false);
    assert.equal(await prisma.scanUpload.count({ where: { id: live.id } }), 1);
    assert.equal(await stagingExists(live.id), true);

    await abortScanUpload(userId, live.id);
  });

  /** Is anything of this upload still on the volume? One directory holds the parts and, briefly,
   * the file they assemble into — which is the thing a local staging area makes simpler than a
   * bucket: there is a real directory to look at. */
  async function stagingExists(uploadId: string): Promise<boolean> {
    try {
      await stat(path.join(DATA_DIR, "scan-uploads", uploadId));
      return true;
    } catch {
      return false;
    }
  }
});
