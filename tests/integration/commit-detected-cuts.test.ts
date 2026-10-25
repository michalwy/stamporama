import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { getPurchaseDetail } from "../../src/lib/lots";
import {
  commitCut,
  listScans,
  markCutReviewed,
  proposeCut,
  recutBatch,
  setCommitDetectedCuts,
  type UploadedSheet,
} from "../../src/lib/scan-sheets";
import {
  claimNextScanUpload,
  failScanUpload,
  finalizeScanUpload,
  openScanUpload,
  prepareScanUpload,
  receiveScanChunk,
  requeueStalledScanUploads,
} from "../../src/lib/scan-uploads";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-quick-cut-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

/**
 * *Commit detected cuts* (#2164): with the collection's switch on, a scan added is cut from its
 * detected boxes by the background preparation, with no editor, and the card is marked *Cut not
 * reviewed* until the collector looks at it.
 *
 * What is proved here is the wiring around detection, not detection — three coloured rectangles on a
 * black field are what `scan-sheet-ingest.test.ts` already proposes a cut on, and nothing is fitted
 * to them:
 *
 *   - the scan takes the switch as it stood **when it was added**;
 *   - fronts and backs alike are cut, and backs pair by the usual rules, a mismatch to the strip;
 *   - a scan with nothing detected, or a back whose front is not cut, waits for its cut;
 *   - the mark is counted per card, cleared by *the cut is fine*, a commit by hand and a re-cut;
 *   - a restart while the cut is being made never prepares the scan a second time.
 */
describe("commit detected cuts (#2164)", () => {
  let userId: string;
  let collectionId: string;
  let nextPurchaseNo = 1;

  const SHEET_W = 4000;
  const SHEET_H = 1600;
  const BOXES: Box[] = [
    { x: 200, y: 300, w: 600, h: 800 },
    { x: 1600, y: 300, w: 600, h: 800 },
    { x: 3000, y: 300, w: 600, h: 800 },
  ];
  const COLOURS: [number, number, number][] = [
    [220, 30, 30],
    [30, 200, 30],
    [30, 30, 220],
  ];

  before(async () => {
    const ts = Date.now();
    userId = `test-user-quick-cut-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User quick-cut-${ts}`,
        email: `test-quick-cut-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-quick-cut-${ts}`,
        name: `Collection quick-cut-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
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

  /** A black card with a coloured rectangle per box. */
  async function card(boxes: readonly Box[]): Promise<Buffer> {
    return sharp({
      create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          boxes.map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: COLOURS[i % 3][0], g: COLOURS[i % 3][1], b: COLOURS[i % 3][2] },
              },
            })
              .png()
              .toBuffer(),
            left: box.x,
            top: box.y,
          }))
        )
      )
      .png()
      .toBuffer();
  }

  /** Open an upload and send its bytes, as the client does — not yet finalized. */
  async function send(
    purchaseId: string,
    bytes: Buffer,
    opts: { side?: "front" | "back"; batchNo?: number } = {}
  ) {
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

  /** Finalize and prepare it, as the worker would. */
  async function prepare(uploadId: string): Promise<UploadedSheet> {
    await finalizeScanUpload(userId, uploadId);
    assert.equal(await claimNextScanUpload(), uploadId);
    try {
      return await prepareScanUpload(uploadId);
    } catch (err) {
      await failScanUpload(uploadId, err);
      throw err;
    }
  }

  async function add(
    purchaseId: string,
    boxes: readonly Box[],
    opts: { side?: "front" | "back"; batchNo?: number } = {}
  ) {
    const opened = await send(purchaseId, await card(boxes), opts);
    return { uploadId: opened.id, sheet: await prepare(opened.id) };
  }

  const tilesOn = (purchaseId: string) =>
    prisma.scanTile.findMany({ where: { purchaseId }, orderBy: { position: "asc" } });
  const sheetRow = (id: string) => prisma.scanSheet.findUniqueOrThrow({ where: { id } });
  const uploadRow = (id: string) => prisma.scanUpload.findUniqueOrThrow({ where: { id } });

  it("leaves a scan for the editor while the switch is off", async () => {
    await setCommitDetectedCuts(userId, collectionId, false);
    const purchaseId = await newOrder();
    const { uploadId, sheet } = await add(purchaseId, BOXES);

    assert.equal((await uploadRow(uploadId)).status, "done");
    assert.equal((await uploadRow(uploadId)).commitDetectedCut, false);
    assert.equal((await tilesOn(purchaseId)).length, 0);
    assert.equal((await sheetRow(sheet.id)).cutUnreviewed, false);
  });

  it("cuts front and back from their detected boxes, pairs them, and marks the card", async () => {
    await setCommitDetectedCuts(userId, collectionId, true);
    const purchaseId = await newOrder();

    const front = await add(purchaseId, BOXES);
    const upload = await uploadRow(front.uploadId);
    assert.equal(upload.status, "done");
    assert.equal(upload.sheetId, front.sheet.id);
    assert.equal(upload.commitDetectedCut, true);
    assert.equal((await tilesOn(purchaseId)).length, BOXES.length);
    assert.equal((await sheetRow(front.sheet.id)).cutUnreviewed, true);

    // The back is turned over in place, so its pieces sit where the fronts did.
    const back = await add(purchaseId, BOXES, { side: "back", batchNo: front.sheet.batchNo });
    const tiles = await tilesOn(purchaseId);
    assert.equal(tiles.length, BOXES.length, "every back found its front");
    assert.ok(tiles.every((t) => t.frontSheetId === front.sheet.id && t.backSheetId === back.sheet.id));
    assert.equal((await sheetRow(back.sheet.id)).cutUnreviewed, true);

    // Read as one card: the batch and every tile on it say so, and the order counts one card.
    const scans = await listScans(userId, { purchaseId });
    assert.equal(scans.batches.length, 1);
    assert.equal(scans.batches[0].cutUnreviewed, true);
    assert.ok(scans.batches[0].tiles.every((t) => t.cutUnreviewed));
    assert.equal(scans.uploads.find((u) => u.id === front.uploadId)?.commitDetectedCut, true);
    const detail = await getPurchaseDetail(userId, purchaseId);
    assert.equal(detail?.unreviewedCutCount, 1);
    assert.equal(detail?.commitDetectedCuts, true);
  });

  it("sends every back to the strip when the counts differ, as a cut by hand does", async () => {
    await setCommitDetectedCuts(userId, collectionId, true);
    const purchaseId = await newOrder();
    const front = await add(purchaseId, BOXES);
    await add(purchaseId, BOXES.slice(0, 2), { side: "back", batchNo: front.sheet.batchNo });

    const tiles = await tilesOn(purchaseId);
    assert.equal(tiles.filter((t) => t.frontSheetId != null && t.backSheetId == null).length, 3);
    assert.equal(tiles.filter((t) => t.frontSheetId == null && t.backSheetId != null).length, 2);
  });

  it("keeps the switch a scan was added with, however it moves before the scan is ready", async () => {
    const purchaseId = await newOrder();
    await setCommitDetectedCuts(userId, collectionId, true);
    const on = await send(purchaseId, await card(BOXES));
    await setCommitDetectedCuts(userId, collectionId, false);
    await prepare(on.id);
    assert.equal((await tilesOn(purchaseId)).length, BOXES.length);

    const other = await newOrder();
    const off = await send(other, await card(BOXES));
    await setCommitDetectedCuts(userId, collectionId, true);
    await prepare(off.id);
    assert.equal((await tilesOn(other)).length, 0);
  });

  it("leaves a scan with nothing detected, and a back whose front is not cut, waiting", async () => {
    await setCommitDetectedCuts(userId, collectionId, true);
    const purchaseId = await newOrder();
    const blank = await add(purchaseId, []);
    assert.equal((await uploadRow(blank.uploadId)).status, "done");
    assert.equal((await tilesOn(purchaseId)).length, 0);
    assert.equal((await sheetRow(blank.sheet.id)).cutUnreviewed, false);

    const back = await add(purchaseId, BOXES, { side: "back", batchNo: blank.sheet.batchNo });
    assert.equal((await uploadRow(back.uploadId)).status, "done");
    assert.equal((await tilesOn(purchaseId)).length, 0, "no back is cut against no fronts");
    assert.equal((await getPurchaseDetail(userId, purchaseId))?.unreviewedCutCount, 0);
  });

  it("clears the mark by saying the cut is fine, by a commit by hand and by a re-cut", async () => {
    await setCommitDetectedCuts(userId, collectionId, true);

    // The cut is fine: the mark goes from both sheets, the tiles stay.
    const fine = await newOrder();
    const f = await add(fine, BOXES);
    const fb = await add(fine, BOXES, { side: "back", batchNo: f.sheet.batchNo });
    const before = (await tilesOn(fine)).map((t) => t.id);
    await markCutReviewed(userId, { purchaseId: fine }, f.sheet.batchNo);
    assert.equal((await sheetRow(f.sheet.id)).cutUnreviewed, false);
    assert.equal((await sheetRow(fb.sheet.id)).cutUnreviewed, false);
    assert.deepEqual((await tilesOn(fine)).map((t) => t.id), before);
    assert.equal((await getPurchaseDetail(userId, fine))?.unreviewedCutCount, 0);

    // Reviewed in the editor: the re-cut takes the mark off the card, and the commit by hand that
    // follows does not put it back.
    const reviewed = await newOrder();
    const r = await add(reviewed, BOXES);
    await recutBatch(userId, { purchaseId: reviewed }, r.sheet.batchNo);
    assert.equal((await sheetRow(r.sheet.id)).cutUnreviewed, false);
    await commitCut(userId, r.sheet.id, await proposeCut(userId, r.sheet.id));
    assert.equal((await sheetRow(r.sheet.id)).cutUnreviewed, false);
    assert.equal((await tilesOn(reviewed)).length, BOXES.length);
  });

  it("never prepares a scan twice when the process stops while it is being cut", async () => {
    await setCommitDetectedCuts(userId, collectionId, true);
    const purchaseId = await newOrder();
    const { uploadId, sheet } = await add(purchaseId, BOXES);
    // Stand in for a stop between the sheet and the cut: the row is still `preparing`, naming it.
    await prisma.scanUpload.update({ where: { id: uploadId }, data: { status: "preparing" } });

    await requeueStalledScanUploads();
    const row = await uploadRow(uploadId);
    assert.equal(row.status, "done");
    assert.equal(row.sheetId, sheet.id);
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 1);
  });
});
