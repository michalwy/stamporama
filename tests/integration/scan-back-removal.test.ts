import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  listScans,
  removeBackScan,
  setTileMarks,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { discardTile, identifyTileAsNewCopy } from "../../src/lib/scan-tiles";
import { getStorage, variantKey, sheetVariantKey } from "../../src/lib/storage";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-back-removal-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Removing or replacing a batch's back scan (#1915). What needs a database and a storage backend:
//
//   - the back sheet and every back cut from it go, rows and bytes, and the front, its cut and its
//     tiles stay — with their state, identification and marks;
//   - a copy loses exactly the back picture the scan gave it, found by provenance, never a back the
//     collector gave it themselves;
//   - backs on no tile go with the scan;
//   - a new back can be added afterwards and pairs as any back does.

describe("removing a batch's back scan (#1915)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  const FRONT: Box[] = [
    { x: 50, y: 50, w: 200, h: 300 },
    { x: 500, y: 50, w: 200, h: 300 },
  ];
  const THREE: Box[] = [...FRONT, { x: 900, y: 50, w: 200, h: 300 }];

  async function card(boxes: readonly Box[]): Promise<Buffer> {
    return sharp({
      create: { width: 1200, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          boxes.map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: 200 - i * 60, g: 40, b: 40 + i * 60 },
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

  async function cutBatch() {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    await createLot(userId, purchase.id, 100);
    const purchaseId = purchase.id;
    const front = await uploadSheet(userId, { purchaseId }, {
      source: await card(FRONT),
      mime: "image/png",
      side: "front",
    });
    await commitCut(userId, front.id, FRONT);
    const tiles = await prisma.scanTile.findMany({
      where: { frontSheetId: front.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return {
      purchaseId,
      batchNo: front.batchNo,
      frontSheetId: front.id,
      tileIds: tiles.map((t) => t.id),
    };
  }

  async function addBack(purchaseId: string, batchNo: number, boxes: readonly Box[]) {
    const back = await uploadSheet(userId, { purchaseId }, {
      source: await card(boxes),
      mime: "image/png",
      side: "back",
      batchNo,
      turnover: "in_place",
    });
    const report = await commitCut(userId, back.id, boxes);
    return { backSheetId: back.id, report };
  }

  async function exists(backend: string, key: string, mime: string): Promise<boolean> {
    try {
      await getStorage(backend).get(key, mime, "delivery");
      return true;
    } catch {
      return false;
    }
  }

  const photoExists = (p: { storageBackend: string; storageKey: string; mime: string }) =>
    exists(p.storageBackend, variantKey(p.storageKey, "full", p.mime), p.mime);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-scan-back-removal-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scan-back-removal-${ts}`,
        email: `test-scan-back-removal-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-scan-back-removal-${ts}`,
        name: `Collection scan-back-removal-${ts}`,
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

  it("takes the back off every tile and the copy, and leaves the front, its cut and its tiles", async () => {
    const { purchaseId, batchNo, frontSheetId, tileIds } = await cutBatch();
    const { backSheetId, report } = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(report.paired, 2);

    await setTileMarks(userId, [tileIds[1]], { conditionId });
    const { itemId } = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    // Provenance is written with the crop and travels with it onto the copy.
    const copyPhotos = await prisma.photo.findMany({
      where: { itemId },
      select: { role: true, scanSheetId: true, storageBackend: true, storageKey: true, mime: true },
    });
    const copyFront = copyPhotos.find((p) => p.role === "front")!;
    const copyBack = copyPhotos.find((p) => p.role === "back")!;
    assert.equal(copyFront.scanSheetId, frontSheetId);
    assert.equal(copyBack.scanSheetId, backSheetId);
    const tileBack = await prisma.photo.findFirstOrThrow({
      where: { tileId: tileIds[1], role: "back" },
    });
    assert.equal(tileBack.scanSheetId, backSheetId);
    const backSheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: backSheetId } });

    const removal = await removeBackScan(userId, { purchaseId }, batchNo);
    assert.deepEqual(removal, { unpaired: 2, backOnly: 0, copies: 1 });

    // The back is gone: the sheet, its bytes, and every crop of it.
    assert.equal(await prisma.scanSheet.count({ where: { id: backSheetId } }), 0);
    assert.equal(
      await exists(
        backSheet.storageBackend,
        sheetVariantKey(backSheet.storageKey, "original", backSheet.mime),
        backSheet.mime
      ),
      false
    );
    assert.equal(await prisma.photo.count({ where: { scanSheetId: backSheetId } }), 0);
    assert.equal(await photoExists(copyBack), false);
    assert.equal(await photoExists(tileBack), false);

    // The front, its cut and its tiles stand, with what was known about them.
    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId, batchNo },
      orderBy: { position: "asc" },
    });
    assert.deepEqual(
      tiles.map((t) => t.id),
      tileIds
    );
    for (const t of tiles) {
      assert.equal(t.frontSheetId, frontSheetId);
      assert.equal(t.backSheetId, null);
      assert.equal(t.backX, null);
      assert.equal(t.backPairedByHand, false);
    }
    assert.equal(tiles[0].state, "consumed");
    assert.equal(tiles[0].itemId, itemId);
    assert.equal(tiles[1].markConditionId, conditionId, "the mark stays with the tile");
    assert.equal(await prisma.photo.count({ where: { tileId: tileIds[1], role: "front" } }), 1);

    // The copy keeps its front, bytes and all.
    const after = await prisma.photo.findMany({ where: { itemId }, select: { role: true } });
    assert.deepEqual(
      after.map((p) => p.role),
      ["front"]
    );
    assert.equal(await photoExists(copyFront), true);

    const batch = (await listScans(userId, { purchaseId })).batches[0];
    assert.equal(batch.back, null);
    assert.ok(batch.front?.cut);

    // Replacing is the ordinary back added again: it is cut and pairs with the open tile.
    const again = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[1] } })).backSheetId,
      again.backSheetId
    );
  });

  it("never takes a back the collector gave the copy themselves", async () => {
    const { purchaseId, batchNo, tileIds } = await cutBatch();
    await addBack(purchaseId, batchNo, FRONT);
    const { itemId } = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    // A back photographed on the copy afterwards names no scan.
    const own = await prisma.photo.findFirstOrThrow({ where: { itemId, role: "back" } });
    await prisma.photo.update({ where: { id: own.id }, data: { scanSheetId: null } });

    const removal = await removeBackScan(userId, { purchaseId }, batchNo);
    assert.equal(removal.copies, 0);
    assert.equal(await prisma.photo.count({ where: { id: own.id } }), 1);
    assert.equal(await photoExists(own), true);
  });

  it("takes backs on no tile with the scan, and finishes a card nothing else is open on", async () => {
    const { purchaseId, batchNo, tileIds } = await cutBatch();
    for (const id of tileIds) await discardTile(userId, id, "torn");
    // Three backs for two fronts: the counts differ, so every back waits on no tile (#647).
    const { report } = await addBack(purchaseId, batchNo, THREE);
    assert.equal(report.backOnly, 3);
    const backOnly = await prisma.photo.findMany({
      where: { tile: { purchaseId, batchNo, frontSheetId: null } },
    });
    assert.equal(backOnly.length, 3);
    await prisma.scanSheet.updateMany({ where: { purchaseId }, data: { batchDoneAt: null } });

    const removal = await removeBackScan(userId, { purchaseId }, batchNo);
    assert.deepEqual(removal, { unpaired: 0, backOnly: 3, copies: 0 });

    assert.equal(await prisma.scanTile.count({ where: { purchaseId, batchNo } }), 2);
    for (const p of backOnly) assert.equal(await photoExists(p), false);
    const front = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId, side: "front" } });
    assert.ok(front.batchDoneAt, "nothing is left open, so the card is finished with");
  });

  it("refuses a batch with no back scan", async () => {
    const { purchaseId, batchNo } = await cutBatch();
    await assert.rejects(
      () => removeBackScan(userId, { purchaseId }, batchNo),
      (err: unknown) => err instanceof ScanValidationError && /no back scan/.test(err.message)
    );
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 2);
  });
});
