import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { MAX_UPLOAD_BYTES } from "../../src/lib/photos/process";
import { listScans, ScanValidationError, type UploadedSheet } from "../../src/lib/scan-sheets";
import {
  abortScanUpload,
  claimNextScanUpload,
  failScanUpload,
  finalizeScanUpload,
  gcStaleScanUploads,
  interruptScanUploads,
  interruptStalledScanUploads,
  keepScanUploadsAlive,
  openScanUpload,
  prepareScanUpload,
  receiveScanChunk,
  requeueStalledScanUploads,
  retryScanUpload,
  uploadChunkBytes,
} from "../../src/lib/scan-uploads";
import { getActionItems } from "../../src/lib/action-items";
import { SCAN_UPLOAD_STALL_MS } from "../../src/lib/scan-upload-status-rules";
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
 *
 * And since #1567, that **preparing the scan runs in the background**: finalizing only queues it and
 * answers at once, the worker's half prepares queued scans in order, a failure keeps the parts and
 * says why, a retry prepares them again without the scan being sent again, a restart resumes, and
 * the sweep never takes a scan whose bytes are all in.
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

  /** Send every part of a file, without finalizing. */
  async function sendParts(bytes: Buffer, opts: { side?: "front" | "back"; batchNo?: number } = {}) {
    const opened = await openScanUpload(userId, { purchaseId }, {
      mime: "image/png",
      side: opts.side ?? "front",
      batchNo: opts.batchNo,
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
    return opened;
  }

  /** What the worker does with the next scan in the queue — asserted to be the one expected, so a
   * test can never prepare a scan another test left waiting. Failures are recorded as the worker
   * records them, and rethrown. */
  async function prepareNext(expected: string): Promise<UploadedSheet> {
    const claimed = await claimNextScanUpload();
    assert.equal(claimed, expected, "the queue hands out the scan that has waited longest");
    try {
      return await prepareScanUpload(expected);
    } catch (err) {
      await failScanUpload(expected, err);
      throw err;
    }
  }

  /** Send a whole file the way the client does, then let the worker prepare it. */
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
    const queued = await finalizeScanUpload(userId, opened.id);
    assert.equal(queued.status, "queued");
    return { opened, sheet: await prepareNext(opened.id) };
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

  it("leaves no parts behind once the scan is stored, and notes the sheet it became", async () => {
    const bytes = await card();
    const { opened, sheet } = await sendAll(bytes);

    // The row stays, small, so a page still open can find the card to cut; the bytes go.
    const row = await prisma.scanUpload.findUniqueOrThrow({ where: { id: opened.id } });
    assert.equal(row.status, "done");
    assert.equal(row.sheetId, sheet.id);
    assert.equal(await stagingExists(opened.id), false);
  });

  it("finalizing queues the scan and answers without preparing it (#1567)", async () => {
    const bytes = await card();
    const opened = await sendParts(bytes);
    const sheetsBefore = await prisma.scanSheet.count({ where: { purchaseId } });

    const queued = await finalizeScanUpload(userId, opened.id);
    assert.equal(queued.status, "queued");
    assert.equal(queued.sheetId, null);
    // Nothing was prepared inside the request: no sheet, and the parts are still all there.
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), sheetsBefore);
    assert.equal(await stagingExists(opened.id), true);

    // Finalizing again — the retry of a request whose answer was lost — says where the scan is.
    const again = await finalizeScanUpload(userId, opened.id);
    assert.equal(again.status, "queued");
    // A chunk re-sent after the finalize is acknowledged and changes nothing.
    const ack = await receiveScanChunk(userId, opened.id, 0, bytes.subarray(0, opened.chunkBytes));
    assert.equal(ack.received, opened.chunks);

    // The section reads it as waiting its turn, first in line.
    const before = await listScans(userId, { purchaseId });
    const waiting = before.uploads.find((u) => u.id === opened.id);
    assert.equal(waiting?.status, "queued");
    assert.equal(waiting?.ahead, 0);

    const sheet = await prepareNext(opened.id);
    const after = await listScans(userId, { purchaseId });
    const done = after.uploads.find((u) => u.id === opened.id);
    assert.equal(done?.status, "done");
    assert.equal(done?.sheetId, sheet.id);
    assert.ok(after.batches.some((b) => b.front?.id === sheet.id && !b.front.cut));
  });

  it("prepares queued scans in the order they became ready, the next waiting its turn", async () => {
    const bytes = await card();
    const first = await sendParts(bytes);
    const second = await sendParts(bytes);
    await finalizeScanUpload(userId, first.id);
    await finalizeScanUpload(userId, second.id);

    const queue = await listScans(userId, { purchaseId });
    assert.equal(queue.uploads.find((u) => u.id === first.id)?.ahead, 0);
    assert.equal(queue.uploads.find((u) => u.id === second.id)?.ahead, 1);

    const a = await prepareNext(first.id);
    const b = await prepareNext(second.id);
    assert.ok(b.batchNo > a.batchNo, "each scan became its own card, in turn");
  });

  it("keeps a failed scan's parts, says why, and prepares it again on a retry", async () => {
    const bytes = await card();
    const opened = await sendParts(bytes);
    await finalizeScanUpload(userId, opened.id);

    // Spoil the first part on disk: the scan can no longer be read as an image.
    const part = path.join(DATA_DIR, "scan-uploads", opened.id, "part-000000");
    const good = await readFile(part);
    await writeFile(part, Buffer.alloc(good.byteLength));

    await assert.rejects(() => prepareNext(opened.id));
    const failed = await prisma.scanUpload.findUniqueOrThrow({ where: { id: opened.id } });
    assert.equal(failed.status, "failed");
    assert.ok(failed.error && failed.error.length > 0, "the card is told why");
    assert.equal(await stagingExists(opened.id), true, "the parts are kept for a retry");

    // The notification centre reports it while it waits on the collector.
    const items = await getActionItems(userId, collectionId);
    assert.ok(
      items.groups
        .find((g) => g.id === "scan-preparation-failed")
        ?.items.some((i) => i.key === opened.id)
    );

    // Put the part right — standing in for whatever went wrong having passed — and retry: nothing
    // is sent again, and the scan becomes a card.
    await writeFile(part, good);
    const retried = await retryScanUpload(userId, opened.id);
    assert.equal(retried.status, "queued");
    const sheet = await prepareNext(opened.id);
    assert.equal(sheet.width, CARD_W);

    // Only a failed scan can be retried.
    await assert.rejects(() => retryScanUpload(userId, opened.id), ScanValidationError);
  });

  it("resumes a preparation a restart interrupted, and never makes two cards of it", async () => {
    const bytes = await card();
    const opened = await sendParts(bytes);
    await finalizeScanUpload(userId, opened.id);
    assert.equal(await claimNextScanUpload(), opened.id);
    // The process stops here, mid-preparation. Being prepared, it cannot be discarded.
    await assert.rejects(() => abortScanUpload(userId, opened.id), ScanValidationError);

    assert.ok((await requeueStalledScanUploads()) >= 1);
    const sheetsBefore = await prisma.scanSheet.count({ where: { purchaseId } });
    await prepareNext(opened.id);
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), sheetsBefore + 1);
  });

  it("makes no card of a scan discarded while it was being prepared", async () => {
    const bytes = await card();
    const opened = await sendParts(bytes);
    await finalizeScanUpload(userId, opened.id);
    assert.equal(await claimNextScanUpload(), opened.id);
    const sheetsBefore = await prisma.scanSheet.count({ where: { purchaseId } });

    // The row goes from under the worker; the parts stay so the preparation gets as far as the
    // write that marks it done, which is in the sheet's own transaction.
    await prisma.scanUpload.delete({ where: { id: opened.id } });
    await assert.rejects(() => prepareScanUpload(opened.id));
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), sheetsBefore);
    await rm(path.join(DATA_DIR, "scan-uploads", opened.id), { recursive: true, force: true });
  });

  it("raises no notification for a prepared card waiting to be cut (#1675)", async () => {
    const bytes = await card();
    const { sheet } = await sendAll(bytes);
    const items = await getActionItems(userId, collectionId);
    // Nothing has been cut from it, and no group mentions it: the purchase's own card says it is
    // ready, and with scans uploaded many at a time the panel would fill with them.
    assert.equal(
      items.groups.some((g) => g.items.some((i) => i.key === sheet.id)),
      false,
      "an uncut card is not in the notification centre"
    );
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
    await finalizeScanUpload(userId, opened.id);
    const sheet = await prepareNext(opened.id);
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

  it("never sweeps a scan whose bytes are all in, however long it waits (#1567)", async () => {
    const bytes = await card();
    const queued = await sendParts(bytes);
    await finalizeScanUpload(userId, queued.id);
    const failed = await sendParts(bytes);
    await finalizeScanUpload(userId, failed.id);
    // Leave the first waiting and make the second a failure nobody retried, then age both well
    // past the TTL — as a long queue, or a server down for a weekend, would.
    await prisma.scanUpload.update({
      where: { id: failed.id },
      data: { status: "failed", error: "test" },
    });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await prisma.scanUpload.updateMany({
      where: { id: { in: [queued.id, failed.id] } },
      data: { updatedAt: old },
    });

    await gcStaleScanUploads();
    // Waiting in the queue: safe, parts and all.
    assert.equal(await prisma.scanUpload.count({ where: { id: queued.id } }), 1);
    assert.equal(await stagingExists(queued.id), true);
    // Failed and left alone: staging again, and gone the way an unfinished upload goes.
    assert.equal(await prisma.scanUpload.count({ where: { id: failed.id } }), 0);
    assert.equal(await stagingExists(failed.id), false);

    await abortScanUpload(userId, queued.id);
  });

  it("stops what a closed page had not sent, keeps nothing half-sent, and reports it (#1568)", async () => {
    const order = await newOrder();
    const bytes = await card();
    const open = (label: string) =>
      openScanUpload(userId, { purchaseId: order }, {
        mime: "image/png",
        side: "front",
        label,
        totalBytes: bytes.byteLength,
      });
    // A batch of three as the page leaves it: the first sent and queued, the second half-sent, the
    // third still waiting its turn.
    const sent = await open("Klaser 1");
    for (let i = 0; i < sent.chunks; i++) {
      const start = i * sent.chunkBytes;
      await receiveScanChunk(userId, sent.id, i, bytes.subarray(start, start + sent.chunkBytes));
    }
    await finalizeScanUpload(userId, sent.id);
    const half = await open("Klaser 2");
    await receiveScanChunk(userId, half.id, 0, bytes.subarray(0, half.chunkBytes));
    const waiting = await open("Klaser 3");
    assert.equal(await stagingExists(half.id), true);

    // Somebody else's page cannot stop them.
    assert.equal(await interruptScanUploads("someone-else", [half.id, waiting.id]), 0);

    assert.equal(await interruptScanUploads(userId, [sent.id, half.id, waiting.id]), 2);
    const rows = await prisma.scanUpload.findMany({
      where: { id: { in: [sent.id, half.id, waiting.id] } },
      select: { id: true, status: true, receivedBytes: true },
    });
    const status = new Map(rows.map((r) => [r.id, r.status]));
    // The one whose bytes were all in is safe in the queue.
    assert.equal(status.get(sent.id), "queued");
    assert.equal(status.get(half.id), "interrupted");
    assert.equal(status.get(waiting.id), "interrupted");
    assert.equal(rows.find((r) => r.id === half.id)?.receivedBytes, 0);
    assert.equal(await stagingExists(half.id), false);
    assert.equal(await stagingExists(sent.id), true);

    // A piece arriving late is refused rather than acknowledged for ever.
    await assert.rejects(
      receiveScanChunk(userId, half.id, 1, bytes.subarray(half.chunkBytes, 2 * half.chunkBytes)),
      ScanValidationError
    );
    // Finalizing one says where it is rather than queueing a scan with no bytes.
    assert.equal((await finalizeScanUpload(userId, waiting.id)).status, "interrupted");

    // The purchase reports both, by name, until they are dismissed — the sweep leaves the report.
    const reported = (await listScans(userId, { purchaseId: order })).uploads.filter(
      (u) => u.status === "interrupted"
    );
    assert.deepEqual(reported.map((u) => u.label).sort(), ["Klaser 2", "Klaser 3"]);
    await prisma.scanUpload.updateMany({
      where: { id: { in: [half.id, waiting.id] } },
      data: { updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    await gcStaleScanUploads();
    assert.equal(await prisma.scanUpload.count({ where: { id: { in: [half.id, waiting.id] } } }), 2);

    await abortScanUpload(userId, half.id);
    await abortScanUpload(userId, waiting.id);
    await abortScanUpload(userId, sent.id);
    assert.equal(await prisma.scanUpload.count({ where: { purchaseId: order } }), 0);
  });

  it("takes silence for a closed page, and spares the files a live page keeps alive (#1568)", async () => {
    const order = await newOrder();
    const bytes = await card();
    const open = () =>
      openScanUpload(userId, { purchaseId: order }, {
        mime: "image/png",
        side: "front",
        totalBytes: bytes.byteLength,
      });
    const silent = await open();
    const kept = await open();
    const recent = await open();
    const past = new Date(Date.now() - SCAN_UPLOAD_STALL_MS - 60_000);
    await prisma.scanUpload.updateMany({
      where: { id: { in: [silent.id, kept.id] } },
      data: { updatedAt: past },
    });
    // The live page says the second is still waiting its turn.
    await keepScanUploadsAlive(userId, [kept.id]);
    // Another owner's keepalive does nothing for the first.
    await keepScanUploadsAlive("someone-else", [silent.id]);

    // Nobody else's read can stop them either.
    assert.equal(await interruptStalledScanUploads("someone-else", order), 0);
    assert.equal(await interruptStalledScanUploads(userId, order), 1);
    const status = new Map(
      (
        await prisma.scanUpload.findMany({
          where: { purchaseId: order },
          select: { id: true, status: true },
        })
      ).map((r) => [r.id, r.status])
    );
    assert.equal(status.get(silent.id), "interrupted");
    assert.equal(status.get(kept.id), "uploading");
    assert.equal(status.get(recent.id), "uploading");

    for (const id of [silent.id, kept.id, recent.id]) await abortScanUpload(userId, id);
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
