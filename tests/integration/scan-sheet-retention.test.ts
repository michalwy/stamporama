import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { setCollectionScanSheetTtl } from "../../src/lib/collections";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getCollectionPhotoStorageBytes } from "../../src/lib/photos";
import {
  ScanValidationError,
  commitCut,
  deleteBatch,
  listScans,
  proposeCut,
  purgeFinishedScanSheets,
  recutBatch,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import {
  discardTile,
  identifyTileAsNewCopy,
  parkTile,
  returnTilesToQueue,
} from "../../src/lib/scan-tiles";
import { getStorage, sheetVariantKey } from "../../src/lib/storage";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-retention-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The retained-scan retention sweep (#578). The period's own grammar is unit-tested; what needs a
// database and a storage backend is the sweep's contract:
//
//   - it does **nothing at all** by default — a card scan is a source, and the sweep ships off;
//   - a batch is only eligible once its **last** tile has left `unidentified` (#567's stamp), and
//     stops being eligible again the moment one comes back;
//   - the bytes go and the **row stays**, so a re-cut refuses with *the scan has been deleted*
//     rather than failing later on a file that is not there;
//   - the collection's storage total moves when it happens.

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retained-scan retention (#578)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  const SHEET_W = 1200;
  const SHEET_H = 600;
  const BOXES: Box[] = [
    { x: 50, y: 50, w: 200, h: 300 },
    { x: 500, y: 50, w: 200, h: 300 },
  ];

  /** A black card with two coloured rectangles on it — the shape of every card scan. */
  async function card(): Promise<Buffer> {
    return sharp({
      create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          BOXES.map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: 200 - i * 100, g: 40, b: 40 + i * 100 },
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

  /** An order with one cut batch of two tiles, in reading order. Since #586 the card belongs to
   * the purchase, so the sweep is scoped to one too. */
  async function orderWithTiles(): Promise<{
    purchaseId: string;
    sheetId: string;
    tileIds: string[];
  }> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    await createLot(userId, purchase.id, 100);
    const sheet = await uploadSheet(userId, { purchaseId: purchase.id }, {
      source: await card(),
      mime: "image/png",
      side: "front",
    });
    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId: purchase.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return { purchaseId: purchase.id, sheetId: sheet.id, tileIds: tiles.map((t) => t.id) };
  }

  /** Does the storage backend still hold this sheet's retained original? */
  async function originalExists(sheetId: string): Promise<boolean> {
    const sheet = await prisma.scanSheet.findUniqueOrThrow({
      where: { id: sheetId },
      select: { storageBackend: true, storageKey: true, mime: true },
    });
    try {
      await getStorage(sheet.storageBackend).get(
        sheetVariantKey(sheet.storageKey, "original", sheet.mime),
        sheet.mime,
        "delivery"
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The instant a sweep is run at.
   *
   * A second **ahead**, not `new Date()`, because a zero-day period puts the cutoff exactly at the
   * pass's own clock and `batchDoneAt` is stamped a moment earlier in the same test — at a coarse
   * timer resolution the two land on the same millisecond and the strict `<` reads a just-finished
   * batch as not yet due, which is a flake rather than a fault. Choosing the instant is what the
   * parameter is for; the sweep's rule is unchanged.
   */
  function aMomentFromNow(): Date {
    return new Date(Date.now() + 1000);
  }

  /** Wind a batch's stamp back, so a sweep run "now" sees it as finished with days ago. */
  async function finishedDaysAgo(purchaseId: string, days: number): Promise<void> {
    await prisma.scanSheet.updateMany({
      where: { purchaseId, batchDoneAt: { not: null } },
      data: { batchDoneAt: new Date(Date.now() - days * DAY_MS) },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-scan-ttl-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scan-ttl-${ts}`,
        email: `test-scan-ttl-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-scan-ttl-${ts}`,
        name: `Collection scan-ttl-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Scan stamp" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("does nothing at all while nobody has asked for it — the sweep ships off", async () => {
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, null);
    for (const id of tileIds) await discardTile(userId, id);
    await finishedDaysAgo(purchaseId, 400);

    const freed = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(freed.sheets, 0, "a card scan is a source; nothing is swept unless it is asked for");
    assert.equal(await originalExists(sheetId), true);
  });

  it("keeps a batch that still has a tile waiting, however old the lot is", async () => {
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    // One tile settled, one still waiting: the batch is not finished with, so it is never stamped
    // and there is no clock to run down.
    await discardTile(userId, tileIds[0]);
    assert.equal(
      (await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheetId } })).batchDoneAt,
      null
    );

    const freed = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(freed.sheets, 0);
    assert.equal(await originalExists(sheetId), true);
  });

  it("keeps a finished batch inside the period and sweeps it after", async () => {
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "30");
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await discardTile(userId, tileIds[1]);

    await finishedDaysAgo(purchaseId, 5);
    assert.equal((await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId })).sheets, 0);
    assert.equal(await originalExists(sheetId), true);

    await finishedDaysAgo(purchaseId, 45);
    const freed = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(freed.sheets, 1);
    assert.ok(freed.bytes > 0, "the sweep reports what it freed, for the boot log to state");
    assert.equal(await originalExists(sheetId), false);
  });

  it("keeps the row, and the batch still lists what the card held", async () => {
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);
    await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });

    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheetId } });
    assert.ok(sheet.purgedAt, "the row survives the purge, saying it was purged");
    assert.equal(sheet.sizeBytes, 0, "and stops counting bytes it no longer holds");

    const { batches } = await listScans(userId, { purchaseId });
    assert.equal(batches[0].tiles.length, 2, "the record of what the card held is untouched");
    assert.equal(batches[0].front?.purged, true);
  });

  it("refuses a re-cut with the scan being gone, rather than failing on a missing file", async () => {
    // The all-discarded batch is the case that matters: consumed tiles refuse a re-cut on their own,
    // so this is the only batch that would otherwise still be re-cuttable after the sweep.
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);
    await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });

    await assert.rejects(
      () => recutBatch(userId, { purchaseId }, 1),
      (err: unknown) =>
        err instanceof ScanValidationError && /scan has been deleted/i.test(err.message)
    );
    // The tiles are still there afterwards — a refused re-cut destroys nothing.
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 2);

    // Everything else that would have read the bytes says the same thing rather than throwing a
    // storage error, and detection swallows it into "no boxes" exactly as it does any other failure.
    await assert.rejects(
      () => commitCut(userId, sheetId, BOXES),
      (err: unknown) => err instanceof ScanValidationError
    );
    await assert.rejects(() => proposeCut(userId, sheetId));
  });

  it("still lets the batch be deleted — what is left is a record, not a scan", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);
    await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });

    await deleteBatch(userId, { purchaseId }, 1);
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 0);
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 0);
  });

  it("stops counting down when a discard is put back", async () => {
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);
    await returnTilesToQueue(userId, [tileIds[0]]);

    const freed = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(freed.sheets, 0, "the batch is being worked again; the clock was cleared");
    assert.equal(await originalExists(sheetId), true);

    // And a re-cut is available again, since nothing was swept.
    await recutBatch(userId, { purchaseId }, 1);
  });

  it("never sweeps a batch with a tile parked on it (#597)", async () => {
    // The failure this guards against is the quiet one: the collector parks the doubtful piece,
    // comes back a month later with the colour key, and finds the card scan gone — which is
    // precisely the picture they came back for. So a parked tile keeps the batch unfinished, at a
    // TTL of zero and with every other tile settled.
    const { purchaseId, sheetId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    await discardTile(userId, tileIds[0]);
    await parkTile(userId, tileIds[1], "watermark?");

    const untouched = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(untouched.sheets, 0, "one piece is still to be identified, so nothing is finished");
    assert.equal(await originalExists(sheetId), true);
    const sheet = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.equal(sheet.batchDoneAt, null);

    // Settle it, and the batch finishes normally — the guarantee is about *while* it is parked.
    await discardTile(userId, tileIds[1]);
    const swept = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    assert.equal(swept.sheets, 1);
  });

  it("drops the collection's storage total by what it freed", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);

    const before = await getCollectionPhotoStorageBytes(userId, collectionId);
    const freed = await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId });
    const after = await getCollectionPhotoStorageBytes(userId, collectionId);
    assert.ok(freed.bytes > 0);
    assert.equal(after, before - freed.bytes, "retained originals are the largest thing stored");
  });

  it("is idempotent — a second pass finds nothing left to sweep", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await setCollectionScanSheetTtl(userId, collectionId, "0");
    for (const id of tileIds) await discardTile(userId, id);

    assert.equal((await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId })).sheets, 1);
    assert.equal((await purgeFinishedScanSheets(aMomentFromNow(), { purchaseId })).sheets, 0);
  });
});
