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
  listLotScans,
  recutBatch,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import {
  assignTileToCopy,
  discardTile,
  identifyTileAsNewCopy,
  noteDiscardedTile,
  undiscardTile,
} from "../../src/lib/scan-tiles";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-tiles-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Identifying scan tiles into copies (#567, ADR-0033). The cut itself is #566's and is covered in
// `scan-sheet-ingest.test.ts`; what is pinned here is the three ends a tile can reach, and the two
// facts that are invisible once wrong:
//
//   - **the images move, they are never copied** — the copy gets the tile's very `Photo` rows, so
//     a byte-copying regression would show up as two rows with two storage keys;
//   - **the re-cut guard now fires in anger** — #566 wrote it before the state existed, and this is
//     the first test where a real identification is what makes it refuse;
//
// plus the batch stamp #578 will read, the discard that survives as evidence, and a tile whose
// stamp is on none of a settled auction lot's lines.

describe("identifying scan tiles into copies (#567)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let describedStampId: string;

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

  async function newLot(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    return createLot(userId, purchase.id, 100);
  }

  /** A lot with one cut batch of two tiles, in reading order. */
  async function lotWithTiles(): Promise<{ lotId: string; tileIds: string[] }> {
    const lotId = await newLot();
    const sheet = await uploadSheet(userId, lotId, {
      bytes: await card(),
      mime: "image/png",
      side: "front",
    });
    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { lotId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return { lotId, tileIds: tiles.map((t) => t.id) };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-tiles-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User tiles-${ts}`,
        email: `test-tiles-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-tiles-${ts}`,
        name: `Collection tiles-${ts}`,
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
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Tile stamp" } })).id;
    describedStampId = (
      await prisma.stamp.create({ data: { collectionId, name: "Described stamp" } })
    ).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so a line still describing a stamp
    // blocks the collection delete that would cascade that stamp away.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("moves the tile's own photo rows onto the copy it creates, without copying bytes", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    const before = await prisma.photo.findMany({
      where: { tileId: tileIds[0] },
      select: { id: true, storageKey: true },
    });
    assert.equal(before.length, 1, "the front crop is one photo row");

    const outcome = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    // The same row, under a new owner — not a second row and not a second set of bytes. This is
    // what ADR-0033 §2 bought by making a tile's crops `Photo` rows in the first place.
    const after = await prisma.photo.findMany({
      where: { itemId: outcome.itemId },
      select: { id: true, storageKey: true, tileId: true, role: true, sortOrder: true },
    });
    assert.equal(after.length, 1);
    assert.equal(after[0].id, before[0].id);
    assert.equal(after[0].storageKey, before[0].storageKey);
    assert.equal(after[0].tileId, null);
    assert.equal(after[0].role, "front");
    assert.equal(after[0].sortOrder, 0);
    assert.equal(await prisma.photo.count({ where: { tileId: tileIds[0] } }), 0);

    const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.state, "consumed");
    assert.equal(tile.itemId, outcome.itemId);

    // …and the card's strip can still draw the tile, because the read points it at the photo's new
    // owner. A consumed tile used to render an empty square while a discarded one kept its image —
    // the tile that went well looking more broken than the one that became nothing.
    const { batches } = await listLotScans(userId, lotId);
    const consumed = batches[0].tiles.find((t) => t.id === tileIds[0]);
    assert.equal(consumed?.frontPhotoId, null, "the tile itself no longer owns a photo");
    assert.equal(
      consumed?.item?.frontPhotoId,
      before[0].id,
      "the same row, under its new owner — nothing was copied and nothing was lost"
    );

    // The copy is an ordinary intake copy: linked to the lot, not yet in the collection.
    const item = await prisma.item.findUniqueOrThrow({ where: { id: outcome.itemId } });
    assert.equal(item.lotId, lotId);
    assert.equal(item.stampId, stampId);
    assert.equal(item.deliveryState, "ordered");
    assert.equal(item.inCollection, false);
  });

  it("refuses a re-cut once a tile has become a copy — for real, this time", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    // #566 wrote this guard before the state that triggers it existed. Here it is a genuine
    // identification that arms it, and what it protects is a copy's front image: re-cutting
    // deletes the tiles, and the copy's `Photo` row would go with the tile that no longer owns it.
    await assert.rejects(() => recutBatch(userId, lotId, 1), ScanValidationError);
    assert.equal(await prisma.scanTile.count({ where: { lotId } }), 2);
  });

  it("gives a tile's images to a copy that already exists, and refuses an occupied slot", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    // The auction path: a copy identified at settlement, wanting photographs rather than a stamp.
    const settledCopy = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    // The second tile onto the same copy: its front slot is taken, so this is refused by name
    // rather than filed somewhere the front is not looked for.
    await assert.rejects(
      () => assignTileToCopy(userId, tileIds[1], settledCopy.itemId),
      ScanValidationError
    );

    // A copy with no photos takes it.
    const bare = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 90_001,
        stampId,
        conditionId,
        lotId,
        deliveryState: "ordered",
      },
      select: { id: true },
    });
    const photoId = (
      await prisma.photo.findFirstOrThrow({ where: { tileId: tileIds[1] } })
    ).id;
    const outcome = await assignTileToCopy(userId, tileIds[1], bare.id);
    assert.equal(outcome.itemId, bare.id);
    const moved = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(moved.itemId, bare.id);
    assert.equal(moved.tileId, null);
  });

  it("has nothing to show only when the copy itself was deleted", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    const outcome = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await prisma.item.delete({ where: { id: outcome.itemId } });

    const { batches } = await listLotScans(userId, lotId);
    const orphan = batches[0].tiles.find((t) => t.id === tileIds[0]);
    // `SetNull`, so the tile survives the copy — and stays `consumed`, because its images left with
    // the copy and there is nothing to go back to. This is the one square the card draws empty, and
    // it says why in words rather than looking like a failed image.
    assert.equal(orphan?.state, "consumed");
    assert.equal(orphan?.item, null);
    assert.equal(orphan?.frontPhotoId, null);
    // The tiles never renumber: position is how a tile is matched to the piece on the card.
    assert.deepEqual(
      batches[0].tiles.map((t) => t.position),
      [0, 1]
    );
  });

  it("refuses a copy that is not on this lot", async () => {
    const { tileIds } = await lotWithTiles();
    const elsewhere = await newLot();
    const stranger = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 90_002,
        stampId,
        conditionId,
        lotId: elsewhere,
        deliveryState: "ordered",
      },
      select: { id: true },
    });
    await assert.rejects(
      () => assignTileToCopy(userId, tileIds[0], stranger.id),
      ScanValidationError
    );
  });

  it("discards a tile in one click, keeping its image and dropping it from the unidentified count", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    // What the screen sends: no note at all. Discard is the frequent answer on a parcel full of
    // junk, so it asks for nothing — safe because it is reversible and the note can follow.
    await discardTile(userId, tileIds[0], "");

    let tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.state, "discarded");
    assert.equal(tile.note, null, "an empty note is no note, not an empty string");

    // The note is written afterwards, from the settled view, on the tile that earns one.
    await noteDiscardedTile(userId, tileIds[0], "  thinned, not worth keeping  ");
    tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.note, "thinned, not worth keeping");
    // The image stays: a discarded tile is evidence of what the parcel held, not a queue item.
    assert.equal(await prisma.photo.count({ where: { tileId: tileIds[0] } }), 1);
    assert.equal(
      await prisma.scanTile.count({ where: { lotId, state: "unidentified" } }),
      1,
      "a discarded tile stops counting as unidentified"
    );

    // And it can be put back, because a mis-click on a card of forty should not need a re-cut —
    // which is exactly what makes the one-click discard safe.
    await undiscardTile(userId, tileIds[0]);
    const back = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(back.state, "unidentified");
    assert.equal(back.note, null);

    // A note belongs to a discard. A tile back in the queue has nothing to carry one about.
    await assert.rejects(
      () => noteDiscardedTile(userId, tileIds[0], "late thought"),
      ScanValidationError
    );
  });

  it("stamps the batch when its last tile leaves the queue, and unstamps it if one comes back", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    const midway = await prisma.scanSheet.findFirstOrThrow({ where: { lotId } });
    assert.equal(midway.batchDoneAt, null, "one tile is still waiting");

    await discardTile(userId, tileIds[1], "junk");
    const done = await prisma.scanSheet.findFirstOrThrow({ where: { lotId } });
    assert.ok(done.batchDoneAt, "the batch is finished with, and the retained scan can do nothing");

    // Nothing here reads the stamp — #578's retention sweep will — but a tile coming back means
    // the batch is being worked again, so the sweep must not still be counting down on it.
    await undiscardTile(userId, tileIds[1]);
    const reopened = await prisma.scanSheet.findFirstOrThrow({ where: { lotId } });
    assert.equal(reopened.batchDoneAt, null);
  });

  it("refuses to work a tile twice", async () => {
    const { tileIds } = await lotWithTiles();
    await discardTile(userId, tileIds[0], null);
    await assert.rejects(
      () => identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId }),
      ScanValidationError
    );
    await identifyTileAsNewCopy(userId, tileIds[1], { stampId, conditionId });
    await assert.rejects(
      () => discardTile(userId, tileIds[1], "changed my mind"),
      ScanValidationError
    );
  });

  it("surfaces a tile whose stamp is on none of a settled auction lot's lines", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    const seller = await prisma.contact.create({
      data: { collectionId, name: "Seller", seller: true },
      select: { id: true },
    });
    const platform = await prisma.contact.create({
      data: { collectionId, name: "House", platform: true },
      select: { id: true },
    });
    const sale = await prisma.auctionSale.create({
      data: {
        collectionId,
        sellerId: seller.id,
        platformId: platform.id,
        name: "Spring sale",
        currency: "EUR",
      },
      select: { id: true },
    });
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: sale.id,
        auctionLotNo: 1,
        endsAt: new Date("2026-02-01"),
        purchaseLotId: lotId,
        // What was described, and therefore what was bid on.
        lines: { create: [{ stampId: describedStampId, conditionId }] },
      },
    });

    // One tile turns out to be a stamp the description listed; the other does not.
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId: describedStampId, conditionId });
    await identifyTileAsNewCopy(userId, tileIds[1], { stampId, conditionId });

    const { batches, fromAuction } = await listLotScans(userId, lotId);
    assert.equal(fromAuction, true);
    const tiles = batches[0].tiles;
    assert.equal(tiles.find((t) => t.id === tileIds[0])?.outsideDescription, false);
    assert.equal(
      tiles.find((t) => t.id === tileIds[1])?.outsideDescription,
      true,
      "a stamp nobody announced is a signal, not something to hide"
    );
    assert.ok(tiles.find((t) => t.id === tileIds[0])?.item?.itemNo);
  });

  it("says nothing about a lot that came from no auction", async () => {
    const { lotId, tileIds } = await lotWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    const { batches, fromAuction } = await listLotScans(userId, lotId);
    assert.equal(fromAuction, false);
    // No description exists, so no tile can disagree with one — the absence of lines must not read
    // as "every stamp here was undescribed".
    assert.ok(batches[0].tiles.every((t) => !t.outsideDescription));
  });
});
