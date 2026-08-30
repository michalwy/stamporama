import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem, getCollectionIntakePage } from "../../src/lib/items";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanAuthError,
  ScanValidationError,
  commitCut,
  getScanCounts,
  listScans,
  setBatchLabel,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { assignTileToCopy, identifyTilesAsNewCopies } from "../../src/lib/scan-tiles";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-collection-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Scanning and identifying with **no purchase behind it** (#725) — cataloguing a stockbook already
// owned. The cut, the pairing and the three ends a tile can reach are #566/#567's and are covered
// in their own files; what is pinned here is only what the re-parenting changed, which is the set
// of things that are invisible once wrong:
//
//   - a card hangs off the **collection**, and `purchaseId: null` is what tells the two lists
//     apart — a batch on an order must not appear on the collection's screen, nor the other way;
//   - the two batch sequences are **separate**, so an order's numbering is untouched by a card
//     scanned outside one (and cards already written on keep meaning what they say);
//   - a copy identified here has **no lot and no cost basis**, and is `delivered` rather than
//     `ordered`: nothing was bought and nothing is in transit;
//   - the assign path widens to the **collection**, which is the same rule the order's version
//     states one level up;
//   - and the ownership check still runs, now against the collection rather than through a
//     purchase that may not exist.

describe("scanning into the collection, with no purchase (#725)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
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

  /** One cut batch of two tiles belonging to the collection alone, in reading order. */
  async function cardWithTiles(): Promise<{ batchNo: number; tileIds: string[] }> {
    const sheet = await uploadSheet(
      userId,
      { collectionId },
      { source: await card(), mime: "image/png", side: "front" }
    );
    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { collectionId, purchaseId: null, batchNo: sheet.batchNo },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return { batchNo: sheet.batchNo, tileIds: tiles.map((t) => t.id) };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-colscan-${ts}`;
    otherUserId = `test-other-colscan-${ts}`;
    for (const [id, label] of [
      [userId, "owner"],
      [otherUserId, "other"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${label}-${ts}`,
          email: `test-colscan-${label}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-colscan-${ts}`,
          name: `Collection colscan-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-colscan-other-${ts}`,
          name: `Collection colscan other-${ts}`,
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Shelf stamp" } })).id;
  });

  after(async () => {
    await prisma.scanTile.deleteMany({ where: { collectionId } });
    await prisma.scanSheet.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("stores a card against the collection, with no purchase", async () => {
    const sheet = await uploadSheet(
      userId,
      { collectionId },
      { source: await card(), mime: "image/png", side: "front", label: "Klaser Polska 1" }
    );

    const row = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    assert.equal(row.collectionId, collectionId);
    assert.equal(row.purchaseId, null, "a card scanned outside an order has none");
    assert.equal(row.label, "Klaser Polska 1");

    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { collectionId, batchNo: sheet.batchNo },
    });
    assert.equal(tiles.length, 2);
    assert.ok(
      tiles.every((t) => t.purchaseId === null && t.collectionId === collectionId),
      "the tiles inherit the sheet's owner, purchase and all"
    );
  });

  it("keeps the collection's batch numbers apart from an order's", async () => {
    // A purchase-less card is numbered off `Collection.nextScanBatchNo`, an order's off its own
    // counter — so an order scanned in between cannot shift either sequence. Merging them would
    // renumber batches a collector has already written on physical cards.
    const before = await uploadSheet(
      userId,
      { collectionId },
      { source: await card(), mime: "image/png", side: "front" }
    );

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    await createLot(userId, purchase.id, 100);
    const ordered = await uploadSheet(
      userId,
      { purchaseId: purchase.id },
      { source: await card(), mime: "image/png", side: "front" }
    );
    assert.equal(ordered.batchNo, 1, "a new order starts at 1 whatever the collection is up to");

    const after = await uploadSheet(
      userId,
      { collectionId },
      { source: await card(), mime: "image/png", side: "front" }
    );
    assert.equal(after.batchNo, before.batchNo + 1, "and the collection's sequence is untouched");

    // …and neither list shows the other's card.
    const collectionBatches = (await listScans(userId, { collectionId })).batches;
    const orderBatches = await listScans(userId, { purchaseId: purchase.id });
    assert.ok(
      collectionBatches.every((b) => b.batchNo !== ordered.batchNo || b.front?.id !== ordered.id),
      "the order's card is not on the collection's screen"
    );
    assert.equal(orderBatches.batches.length, 1, "and the order's screen holds only its own");
    assert.equal(orderBatches.fromAuction, false);
  });

  it("identifies a tile into a copy with no lot and no cost", async () => {
    const { tileIds } = await cardWithTiles();

    const [copy] = await identifyTilesAsNewCopies(userId, [tileIds[0]], {
      stampId,
      conditionId,
      inCollection: true,
    });

    const item = await prisma.item.findUniqueOrThrow({ where: { id: copy.itemId } });
    assert.equal(item.lotId, null, "nothing was bought, so there is no lot");
    assert.equal(item.costBasis, null, "and therefore no cost basis to freeze");
    assert.equal(
      item.deliveryState,
      "delivered",
      "the piece is on the desk under the scanner, not in transit"
    );
    assert.equal(item.stampId, stampId);
    assert.equal(item.inCollection, true);

    // The tile's own images went with it — the move #567 makes, unchanged by the re-parenting.
    const photos = await prisma.photo.findMany({ where: { itemId: item.id } });
    assert.equal(photos.length, 1);
    const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.state, "consumed");
    assert.equal(tile.itemId, item.id);
  });

  it("assigns a tile to any copy of the collection", async () => {
    // The order's rule is *a copy on this parcel*; with no parcel it is *a copy of this
    // collection*, which is what digitising a shelf needs — most pieces are already recorded and
    // want photographs rather than identification.
    const { tileIds } = await cardWithTiles();
    const existing = await createItem(userId, collectionId, { stampId, conditionId });

    const page = await getCollectionIntakePage(userId, collectionId, {
      freePhotoSlots: ["front"],
    });
    assert.ok(
      page.items.some((i) => i.id === existing.id),
      "the candidate list offers it, since its front slot is free"
    );

    const outcome = await assignTileToCopy(userId, tileIds[0], existing.id);
    assert.equal(outcome.itemId, existing.id);
    const photos = await prisma.photo.findMany({ where: { itemId: existing.id } });
    assert.equal(photos.length, 1, "the tile's front moved onto the copy");
  });

  it("refuses a tile and a copy that are not in the same collection", async () => {
    const { tileIds } = await cardWithTiles();
    const foreignCondition = await prisma.stampCondition.create({
      data: { collectionId: otherCollectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const foreignStamp = await prisma.stamp.create({
      data: { collectionId: otherCollectionId, name: "Someone else's stamp" },
    });
    const foreignCopy = await createItem(otherUserId, otherCollectionId, {
      stampId: foreignStamp.id,
      conditionId: foreignCondition.id,
    });

    await assert.rejects(
      () => assignTileToCopy(userId, tileIds[0], foreignCopy.id),
      ScanAuthError
    );
  });

  it("refuses a collection that is not the caller's", async () => {
    const bytes = await card();
    await assert.rejects(
      () =>
        uploadSheet(
          otherUserId,
          { collectionId },
          { source: bytes, mime: "image/png", side: "front" }
        ),
      ScanAuthError,
      "the check runs against the collection now, not through a purchase"
    );
    await assert.rejects(() => listScans(otherUserId, { collectionId }), ScanAuthError);
    await assert.rejects(
      () => setBatchLabel(otherUserId, { collectionId }, 1, "not yours"),
      ScanAuthError
    );
  });

  it("counts what the screen's header says, for the collection's cards alone", async () => {
    const fresh = (
      await prisma.collection.create({
        data: {
          slug: `col-colscan-counts-${Date.now()}`,
          name: "Collection colscan counts",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    try {
      const sheet = await uploadSheet(
        userId,
        { collectionId: fresh },
        { source: await card(), mime: "image/png", side: "front" }
      );
      await commitCut(userId, sheet.id, BOXES);

      const counts = await getScanCounts(userId, { collectionId: fresh });
      assert.deepEqual(counts, {
        unidentifiedTileCount: 2,
        parkedTileCount: 0,
        scanSheetCount: 1,
      });

      // A back with no front is still refused — the rule is the batch's, not the order's.
      const backBytes = await card();
      await assert.rejects(
        () =>
          uploadSheet(
            userId,
            { collectionId: fresh },
            { source: backBytes, mime: "image/png", side: "back", batchNo: 99 }
          ),
        ScanValidationError
      );
    } finally {
      await prisma.scanTile.deleteMany({ where: { collectionId: fresh } });
      await prisma.scanSheet.deleteMany({ where: { collectionId: fresh } });
      await prisma.collection.delete({ where: { id: fresh } });
    }
  });
});
