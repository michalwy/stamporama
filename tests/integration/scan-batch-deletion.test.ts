import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { getItemListItem } from "../../src/lib/items";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  deleteBatch,
  deleteBatches,
  listScans,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { discardTile, identifyTileAsNewCopy, parkTile } from "../../src/lib/scan-tiles";
import { getStorage, variantKey, sheetVariantKey } from "../../src/lib/storage";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-delete-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Deleting a worked-through card scan (#1218). The rule itself is unit-tested; what needs a database
// and a storage backend is what a deletion leaves behind:
//
//   - the sheets, the tiles and every byte of both are gone, and do not come back;
//   - every copy made from the card still exists, with the very photos it had;
//   - those copies stop naming a scan (#1188);
//   - a card with copies and a tile still open is refused, and a refusal deletes nothing;
//   - several cards go as one decision — all of them, or none.

describe("deleting a worked-through card scan (#1218)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  const BOXES: Box[] = [
    { x: 50, y: 50, w: 200, h: 300 },
    { x: 500, y: 50, w: 200, h: 300 },
  ];

  async function card(): Promise<Buffer> {
    return sharp({
      create: { width: 1200, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
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

  async function newOrder(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    await createLot(userId, purchase.id, 100);
    return purchase.id;
  }

  /** One cut batch of two tiles on the order, in reading order. */
  async function cutBatch(purchaseId: string, label?: string) {
    const sheet = await uploadSheet(userId, { purchaseId }, {
      source: await card(),
      mime: "image/png",
      side: "front",
      label,
    });
    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { frontSheetId: sheet.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return { batchNo: sheet.batchNo, sheetId: sheet.id, tileIds: tiles.map((t) => t.id) };
  }

  async function exists(backend: string, key: string, mime: string): Promise<boolean> {
    try {
      await getStorage(backend).get(key, mime, "delivery");
      return true;
    } catch {
      return false;
    }
  }

  async function sheetOriginalExists(sheet: {
    storageBackend: string;
    storageKey: string;
    mime: string;
  }): Promise<boolean> {
    return exists(
      sheet.storageBackend,
      sheetVariantKey(sheet.storageKey, "original", sheet.mime),
      sheet.mime
    );
  }

  async function photoFullExists(photo: {
    storageBackend: string;
    storageKey: string;
    mime: string;
  }): Promise<boolean> {
    return exists(
      photo.storageBackend,
      variantKey(photo.storageKey, "full", photo.mime),
      photo.mime
    );
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-scan-delete-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scan-delete-${ts}`,
        email: `test-scan-delete-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-scan-delete-${ts}`,
        name: `Collection scan-delete-${ts}`,
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

  it("deletes the card and keeps the copy it became, photos and all", async () => {
    const purchaseId = await newOrder();
    const { batchNo, sheetId, tileIds } = await cutBatch(purchaseId, "Klaser Polska 1");
    const { itemId } = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    assert.ok(itemId);
    await discardTile(userId, tileIds[1], "torn");

    const before = await getItemListItem(userId, itemId);
    assert.deepEqual(before.scan, { batchNo, label: "Klaser Polska 1" }, "names its card first");
    const copyPhotos = await prisma.photo.findMany({
      where: { itemId },
      select: { id: true, storageBackend: true, storageKey: true, mime: true },
      orderBy: { id: "asc" },
    });
    assert.ok(copyPhotos.length > 0);
    const discardPhotos = await prisma.photo.findMany({ where: { tileId: tileIds[1] } });
    assert.ok(discardPhotos.length > 0);
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheetId } });

    await deleteBatch(userId, { purchaseId }, batchNo);

    // The card is gone: rows and bytes, the discarded tile's included.
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 0);
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 0);
    assert.equal(await sheetOriginalExists(sheet), false);
    for (const p of discardPhotos) assert.equal(await photoFullExists(p), false);
    assert.equal((await listScans(userId, { purchaseId })).batches.length, 0);

    // The copy is exactly as it was, with the same photo rows and their bytes.
    const after = await prisma.photo.findMany({
      where: { itemId },
      select: { id: true, storageBackend: true, storageKey: true, mime: true },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(after, copyPhotos);
    for (const p of after) assert.equal(await photoFullExists(p), true);

    // And it reads as if it had never come from a scan.
    const row = await getItemListItem(userId, itemId);
    assert.equal(row.scan, null);
    assert.equal(row.photos.length, copyPhotos.length);
  });

  it("refuses a card with copies while a tile is still waiting, and deletes nothing", async () => {
    const purchaseId = await newOrder();
    const { batchNo, sheetId, tileIds } = await cutBatch(purchaseId);
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    await assert.rejects(
      () => deleteBatch(userId, { purchaseId }, batchNo),
      (err: unknown) =>
        err instanceof ScanValidationError && /1 tile waiting/.test(err.message)
    );
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 2);
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheetId } });
    assert.equal(await sheetOriginalExists(sheet), true, "a refusal destroys no scan");
  });

  it("refuses a card with copies while a tile is parked (#597)", async () => {
    const purchaseId = await newOrder();
    const { batchNo, tileIds } = await cutBatch(purchaseId);
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await parkTile(userId, tileIds[1], "watermark?");

    await assert.rejects(
      () => deleteBatch(userId, { purchaseId }, batchNo),
      (err: unknown) =>
        err instanceof ScanValidationError && /set aside to check/.test(err.message)
    );
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 1);
  });

  it("still deletes a card nothing has become a copy from, however unfinished", async () => {
    const purchaseId = await newOrder();
    const { batchNo } = await cutBatch(purchaseId);

    await deleteBatch(userId, { purchaseId }, batchNo);
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 0);
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 0);
  });

  it("deletes several finished cards at once, and only those asked for", async () => {
    const purchaseId = await newOrder();
    const first = await cutBatch(purchaseId);
    const second = await cutBatch(purchaseId);
    const kept = await cutBatch(purchaseId);
    const copies: string[] = [];
    for (const b of [first, second]) {
      const { itemId } = await identifyTileAsNewCopy(userId, b.tileIds[0], { stampId, conditionId });
      copies.push(itemId);
      await discardTile(userId, b.tileIds[1]);
    }

    const result = await deleteBatches(userId, { purchaseId }, [first.batchNo, second.batchNo]);
    assert.deepEqual(result, { batches: 2, copiesKept: 2 });

    const { batches } = await listScans(userId, { purchaseId });
    assert.deepEqual(
      batches.map((b) => b.batchNo),
      [kept.batchNo]
    );
    for (const id of copies) assert.equal((await getItemListItem(userId, id)).scan, null);
  });

  it("refuses the whole set when one card in it is not finished — all or nothing", async () => {
    const purchaseId = await newOrder();
    const done = await cutBatch(purchaseId);
    const open = await cutBatch(purchaseId);
    for (const b of [done, open]) {
      await identifyTileAsNewCopy(userId, b.tileIds[0], { stampId, conditionId });
    }
    await discardTile(userId, done.tileIds[1]);

    await assert.rejects(
      () => deleteBatches(userId, { purchaseId }, [done.batchNo, open.batchNo]),
      (err: unknown) =>
        err instanceof ScanValidationError && new RegExp(`^Batch ${open.batchNo} `).test(err.message)
    );
    assert.equal(await prisma.scanSheet.count({ where: { purchaseId } }), 2, "neither card went");
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 4);
  });
});
