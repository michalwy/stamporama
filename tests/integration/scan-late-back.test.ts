import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { deleteItem } from "../../src/lib/items";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  listScans,
  pairTilesManually,
  removeBackScan,
  setBackTurnover,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { identifyTileAsNewCopy } from "../../src/lib/scan-tiles";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-late-back-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A back scan added after the card's tiles were identified (#1995). What needs a database:
//
//   - a back that pairs with a tile that has become a copy becomes that copy's back picture, named by
//     the scan it was cut from, and *Remove back scan* takes it off again;
//   - a copy that already has a back keeps it, and the scan's back for it waits on the strip;
//   - a tile whose copy was deleted takes no back;
//   - an unpaired back can be dragged onto a copy with no back, and not onto one that has one;
//   - changing how the backs were made keeps every back already on a copy and places backs on
//     copies that have none;
//   - mismatched counts still send every back to the strip.

describe("a back scan added after identifying (#1995)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  // One row, so a card turned top to bottom pairs exactly as one turned in place.
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

  /** A card cut into two tiles, each identified as a copy before any back exists. */
  async function identifiedCard(identify: readonly number[] = [0, 1]) {
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
    const tileIds = tiles.map((t) => t.id);
    const itemIds: string[] = [];
    for (const i of identify) {
      itemIds[i] = (await identifyTileAsNewCopy(userId, tileIds[i], { stampId, conditionId })).itemId;
    }
    return { purchaseId, batchNo: front.batchNo, tileIds, itemIds };
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

  /** A back the collector gave the copy on its own screen: no scan names it. */
  async function giveOwnBack(itemId: string) {
    return prisma.photo.create({
      data: {
        itemId,
        role: "back",
        sortOrder: 1,
        storageBackend: "local",
        storageKey: `test/own-back-${itemId}`,
        mime: "image/jpeg",
        width: 10,
        height: 10,
        sizeBytes: 1,
      },
    });
  }

  const copyBack = (itemId: string) =>
    prisma.photo.findFirst({ where: { itemId, role: "back" } });

  const stripBacks = (purchaseId: string, batchNo: number) =>
    prisma.scanTile.findMany({
      where: { purchaseId, batchNo, frontSheetId: null },
      select: { id: true, state: true },
    });

  const sheets = (purchaseId: string) =>
    prisma.scanSheet.findMany({ where: { purchaseId }, select: { side: true, batchDoneAt: true } });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-scan-late-back-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scan-late-back-${ts}`,
        email: `test-scan-late-back-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-scan-late-back-${ts}`,
        name: `Collection scan-late-back-${ts}`,
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

  it("gives every copy made from the card its back, and Remove back scan takes them off again", async () => {
    const { purchaseId, batchNo, tileIds, itemIds } = await identifiedCard();
    const { backSheetId, report } = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(report.pairingMode, "positional");
    assert.equal(report.paired, 2);
    assert.equal(report.toCopies, 2);
    assert.equal(report.backOnly, 0);
    assert.equal(report.copyHadBack, 0);
    assert.equal(report.created, 0);

    for (const [i, itemId] of itemIds.entries()) {
      const back = await copyBack(itemId);
      assert.ok(back, `copy ${i} has a back picture`);
      assert.equal(back.scanSheetId, backSheetId, "named by the scan it was cut from");
      assert.equal(back.tileId, null);
      assert.equal(back.sortOrder, 1, "after the copy's front, as an identified back would be");
      const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[i] } });
      assert.equal(tile.state, "consumed");
      assert.equal(tile.backSheetId, backSheetId);
      assert.deepEqual(
        { x: tile.backX, y: tile.backY, w: tile.backW, h: tile.backH },
        FRONT[i]
      );
      assert.equal(tile.backTurn, 0, "upright, as any back is");
    }
    assert.equal((await stripBacks(purchaseId, batchNo)).length, 0);
    // Nothing is open on the card, so the new back sheet is finished with as the front was.
    for (const s of await sheets(purchaseId)) assert.ok(s.batchDoneAt, `${s.side} is finished with`);

    // The strip draws the copy's back, and the removal's confirmation names the copies by it.
    const batch = (await listScans(userId, { purchaseId })).batches[0];
    for (const t of batch.tiles) {
      assert.ok(t.item?.backPhotoId);
      assert.equal(t.item?.backPhotoSheetId, backSheetId);
    }

    // Changing how the backs were made leaves a back already on a copy where it is.
    const before = await copyBack(itemIds[0]);
    const again = await setBackTurnover(userId, { purchaseId }, batchNo, "card_top_bottom");
    assert.equal(again.kept, 2);
    assert.equal(again.toCopies, 0);
    assert.equal((await copyBack(itemIds[0]))?.id, before!.id);

    const removal = await removeBackScan(userId, { purchaseId }, batchNo);
    assert.equal(removal.copies, 2);
    for (const itemId of itemIds) assert.equal(await copyBack(itemId), null);
    assert.equal(
      await prisma.scanTile.count({ where: { purchaseId, batchNo, backSheetId: { not: null } } }),
      0
    );
  });

  it("leaves a copy's own back where it is, and sends the scan's back for it to the strip", async () => {
    const { purchaseId, batchNo, tileIds, itemIds } = await identifiedCard();
    const own = await giveOwnBack(itemIds[1]);

    const { backSheetId, report } = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(report.paired, 1);
    assert.equal(report.toCopies, 1);
    assert.equal(report.backOnly, 1);
    assert.equal(report.copyHadBack, 1);

    assert.equal((await copyBack(itemIds[0]))?.scanSheetId, backSheetId);
    assert.equal((await copyBack(itemIds[1]))?.id, own.id, "the copy keeps its own back");
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[1] } })).backSheetId,
      null
    );
    const strip = await stripBacks(purchaseId, batchNo);
    assert.equal(strip.length, 1);
    assert.equal(strip[0].state, "unidentified");
    // A back waiting on the strip is work on the card, so it is not finished with.
    for (const s of await sheets(purchaseId)) assert.equal(s.batchDoneAt, null);

    // Not draggable onto the copy that has a back, nor onto the copy that took one.
    await assert.rejects(
      () => pairTilesManually(userId, strip[0].id, tileIds[1]),
      (err: unknown) => err instanceof ScanValidationError && /already has a back/.test(err.message)
    );
    await assert.rejects(
      () => pairTilesManually(userId, strip[0].id, tileIds[0]),
      (err: unknown) => err instanceof ScanValidationError && /already has a back/.test(err.message)
    );

    // Once the copy's own back is gone, the way the backs were made can be changed and the back on
    // the strip finds its copy — turned with the card, as a back cut then would have been.
    await prisma.photo.delete({ where: { id: own.id } });
    const turned = await setBackTurnover(userId, { purchaseId }, batchNo, "card_top_bottom");
    assert.equal(turned.toCopies, 1);
    assert.equal(turned.backOnly, 0);
    assert.equal(turned.kept, 1, "the back already on the first copy stays");
    const placed = await copyBack(itemIds[1]);
    assert.equal(placed?.scanSheetId, backSheetId);
    assert.equal(placed?.tileId, null);
    const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[1] } });
    assert.equal(tile.backSheetId, backSheetId);
    assert.equal(tile.backTurn, 180);
    assert.equal((await stripBacks(purchaseId, batchNo)).length, 0);
    for (const s of await sheets(purchaseId)) assert.ok(s.batchDoneAt, `${s.side} is finished with`);
  });

  it("sends every back to the strip on mismatched counts, and a dragged one becomes the copy's back", async () => {
    const { purchaseId, batchNo, tileIds, itemIds } = await identifiedCard();
    const { backSheetId, report } = await addBack(purchaseId, batchNo, THREE);
    assert.equal(report.pairingMode, "manual");
    assert.equal(report.paired, 0);
    assert.equal(report.toCopies, 0);
    assert.equal(report.backOnly, 3);
    for (const itemId of itemIds) assert.equal(await copyBack(itemId), null);

    const strip = await stripBacks(purchaseId, batchNo);
    const marks = await pairTilesManually(userId, strip[0].id, tileIds[0]);
    assert.deepEqual(marks, { mark: null, replaced: null });
    const back = await copyBack(itemIds[0]);
    assert.equal(back?.scanSheetId, backSheetId);
    assert.equal(back?.sortOrder, 1);
    const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.backSheetId, backSheetId);
    assert.equal(tile.backPairedByHand, true);
    assert.equal(await prisma.scanTile.count({ where: { id: strip[0].id } }), 0);

    // The confirmation names the copy, and removing the scan takes the dragged back off it too.
    const batch = (await listScans(userId, { purchaseId })).batches[0];
    assert.equal(batch.tiles.find((t) => t.id === tileIds[0])?.item?.backPhotoSheetId, backSheetId);
    const removal = await removeBackScan(userId, { purchaseId }, batchNo);
    assert.equal(removal.copies, 1);
    assert.equal(removal.backOnly, 2);
    assert.equal(await copyBack(itemIds[0]), null);
  });

  it("gives no back to a tile whose copy was deleted", async () => {
    const { purchaseId, batchNo, tileIds, itemIds } = await identifiedCard();
    await deleteItem(userId, itemIds[0]);
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } })).itemId,
      null
    );

    const { report } = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(report.toCopies, 1);
    assert.equal(report.backOnly, 1);
    assert.equal(report.copyHadBack, 0);
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } })).backSheetId,
      null
    );
    const strip = await stripBacks(purchaseId, batchNo);
    assert.equal(strip.length, 1);
    await assert.rejects(
      () => pairTilesManually(userId, strip[0].id, tileIds[0]),
      (err: unknown) => err instanceof ScanValidationError && /deleted/.test(err.message)
    );
  });

  it("still pairs an open tile beside the copies as before", async () => {
    const { purchaseId, batchNo, tileIds, itemIds } = await identifiedCard([0]);
    const { report } = await addBack(purchaseId, batchNo, FRONT);
    assert.equal(report.paired, 2);
    assert.equal(report.toCopies, 1);
    assert.ok(await copyBack(itemIds[0]));
    assert.equal(
      await prisma.photo.count({ where: { tileId: tileIds[1], role: "back" } }),
      1,
      "the open tile holds its own back until it is identified"
    );
    for (const s of await sheets(purchaseId)) assert.equal(s.batchDoneAt, null);
  });
});
