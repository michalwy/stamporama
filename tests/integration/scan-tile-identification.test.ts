import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { freePhotoSlotsWhere, getPurchaseIntakePage } from "../../src/lib/items";
import {
  canTakeTileRoles,
  photoRolesPresent,
  type TilePhotoRole,
} from "../../src/lib/tile-photo-roles";
import { createLot, getPurchaseDetail } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  countParkedTiles,
  listScans,
  recutBatch,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { sharedVariantParent } from "../../src/lib/tile-candidates";
import {
  addTileCandidate,
  assignTileToCopy,
  discardTile,
  discardTiles,
  identifyTileAsNewCopy,
  identifyTilesAsNewCopies,
  noteTile,
  parkTile,
  parkTiles,
  reidentifyTileCopy,
  removeTileCandidate,
  returnTilesToQueue,
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
// stamp is on none of a settled auction sale's lines.
//
// Since #586 a tile belongs to the **order**, which is what the assign candidates are drawn from
// and what makes *which lot* a question identification has to answer — silently on a purchase with
// one lot, by being told on a purchase with several, and never by guessing.

describe("identifying scan tiles into copies (#567)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let mintConditionId: string;
  let certificateStatusId: string;
  let formatId: string;
  let stampId: string;
  let describedStampId: string;
  /** A base stamp with two watermark variants under it, and a stamp in another collection — the
   * three a parked tile's shortlist (#607) is tested against: what the correction fires on, and
   * what a candidate may not be. */
  let baseStampId: string;
  let variantAId: string;
  let variantBId: string;
  let foreignStampId: string;

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

  /** A parcel with one lot on it — the stockbook case, which must keep asking nothing. */
  async function newOrder(): Promise<{ purchaseId: string; lotId: string }> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    return { purchaseId: purchase.id, lotId: await createLot(userId, purchase.id, 100) };
  }

  /** An order with one cut batch of two tiles, in reading order. */
  async function orderWithTiles(): Promise<{
    purchaseId: string;
    lotId: string;
    tileIds: string[];
  }> {
    const { purchaseId, lotId } = await newOrder();
    const sheet = await uploadSheet(userId, { purchaseId }, {
      source: await card(),
      mime: "image/png",
      side: "front",
    });
    await commitCut(userId, sheet.id, BOXES);
    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return { purchaseId, lotId, tileIds: tiles.map((t) => t.id) };
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
    // The dictionaries a **re-identification** re-answers (the condition step asks all of them, so
    // the correction has to be able to say all of them): a second condition to move to, a
    // certificate to put on and take off again, and a format that says the piece is not a single.
    mintConditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "**", sortOrder: 1 },
      })
    ).id;
    certificateStatusId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Certified", abbreviation: "cert", sortOrder: 0 },
      })
    ).id;
    formatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "pair", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Tile stamp" } })).id;
    describedStampId = (
      await prisma.stamp.create({ data: { collectionId, name: "Described stamp" } })
    ).id;

    // *It is Mi 200, but watermark A or B?* — the case #607's correction is about. The subtype is
    // what makes the children **effective** variants (ADR-0010), which is the whole condition.
    const vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const watermark = await prisma.stampSubtype.create({
      data: { collectionId, name: "Watermark", actsAsVariant: true, sortOrder: 0 },
    });
    baseStampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Birds",
          catalogNumbers: { create: { catalogVendorId: vendorId, number: "200" } },
        },
      })
    ).id;
    const variant = async (number: string) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            parentId: baseStampId,
            subtypeId: watermark.id,
            catalogNumbers: { create: { catalogVendorId: vendorId, number } },
          },
        })
      ).id;
    variantAId = await variant("200a");
    variantBId = await variant("200b");

    const otherCollection = await prisma.collection.create({
      data: {
        slug: `col-tiles-other-${ts}`,
        name: `Other collection tiles-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    foreignStampId = (
      await prisma.stamp.create({
        data: { collectionId: otherCollection.id, name: "Another collection's stamp" },
      })
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
    const { purchaseId, lotId, tileIds } = await orderWithTiles();
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
    const { batches } = await listScans(userId, { purchaseId });
    const consumed = batches[0].tiles.find((t) => t.id === tileIds[0]);
    assert.equal(consumed?.frontPhotoId, null, "the tile itself no longer owns a photo");
    assert.equal(
      consumed?.item?.frontPhotoId,
      before[0].id,
      "the same row, under its new owner — nothing was copied and nothing was lost"
    );
    // …and enough of the copy to recognise it (#584), since the tile's own dialog is where a
    // consumed tile is inspected now that clicking one no longer leaves for the copy.
    assert.equal(consumed?.item?.stampName, "Tile stamp");
    assert.equal(consumed?.item?.conditionAbbreviation, "U");
    assert.deepEqual(consumed?.item?.catalogNumbers, []);
    assert.equal(consumed?.item?.backPhotoId, null, "this card was never turned over");

    // The copy is an ordinary intake copy: linked to the lot, not yet in the collection.
    const item = await prisma.item.findUniqueOrThrow({ where: { id: outcome.itemId } });
    assert.equal(item.lotId, lotId);
    assert.equal(item.stampId, stampId);
    assert.equal(item.deliveryState, "ordered");
    assert.equal(item.inCollection, false);
  });

  it("identifies several tiles as one stamp, and every copy keeps its own pictures (#596)", async () => {
    const { purchaseId, lotId, tileIds } = await orderWithTiles();
    // The photo row each tile owns *before* the pass, so the pairing can be checked afterwards
    // rather than merely the count of rows that moved.
    const frontBefore = new Map<string, string>();
    for (const tileId of tileIds) {
      const photo = await prisma.photo.findFirstOrThrow({
        where: { tileId, role: "front" },
        select: { id: true },
      });
      frontBefore.set(tileId, photo.id);
    }

    const outcomes = await identifyTilesAsNewCopies(userId, tileIds, { stampId, conditionId });
    assert.equal(outcomes.length, 2, "one copy per tile, and not one copy for the run");

    // **The thing a naive implementation gets wrong.** These are two photographs of two pieces of
    // paper: tile *i*'s own crop is on copy *i*, and no copy points at another tile's picture.
    for (const [i, tileId] of tileIds.entries()) {
      const photos = await prisma.photo.findMany({
        where: { itemId: outcomes[i].itemId },
        select: { id: true },
      });
      assert.deepEqual(
        photos.map((p) => p.id),
        [frontBefore.get(tileId)],
        `copy ${i} carries tile ${i}'s own photo row`
      );
      const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileId } });
      assert.equal(tile.state, "consumed");
      assert.equal(tile.itemId, outcomes[i].itemId);
    }

    // One intake, so the internal numbers are one consecutive range in card order — the copies read
    // in the same order as the strip they came from.
    assert.equal(outcomes[1].itemNo, outcomes[0].itemNo + 1);

    // Ordinary intake copies of the one stamp, on the one lot.
    const items = await prisma.item.findMany({
      where: { id: { in: outcomes.map((o) => o.itemId) } },
      select: { lotId: true, stampId: true, conditionId: true, deliveryState: true },
    });
    assert.equal(items.length, 2);
    assert.ok(items.every((it) => it.lotId === lotId && it.stampId === stampId));
    assert.ok(items.every((it) => it.conditionId === conditionId));

    // The batch's last tile left the queue, so #578's retention sweep has its stamp.
    const sheets = await prisma.scanSheet.findMany({ where: { purchaseId }, select: { batchDoneAt: true } });
    assert.ok(sheets.every((s) => s.batchDoneAt != null));
  });

  it("refuses the whole pass before creating anything when one tile cannot be worked (#596)", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await discardTile(userId, tileIds[1]);
    const copiesBefore = await prisma.item.count({ where: { lot: { purchaseId } } });

    // A stale strip in a second tab costs a sentence, never a half-done identification: the tiles
    // are all checked before a copy exists, so the tile that *could* have been worked is untouched.
    await assert.rejects(
      () => identifyTilesAsNewCopies(userId, tileIds, { stampId, conditionId }),
      ScanValidationError
    );
    assert.equal(await prisma.item.count({ where: { lot: { purchaseId } } }), copiesBefore);
    const first = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(first.state, "unidentified");

    // The same tile named twice would give the second copy no images at all — the first having
    // taken them — so it is refused rather than resolved.
    await assert.rejects(
      () => identifyTilesAsNewCopies(userId, [tileIds[0], tileIds[0]], { stampId, conditionId }),
      ScanValidationError
    );
    assert.equal(await prisma.item.count({ where: { lot: { purchaseId } } }), copiesBefore);
  });

  it("refuses a re-cut once a tile has become a copy — for real, this time", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    // #566 wrote this guard before the state that triggers it existed. Here it is a genuine
    // identification that arms it, and what it protects is a copy's front image: re-cutting
    // deletes the tiles, and the copy's `Photo` row would go with the tile that no longer owns it.
    await assert.rejects(() => recutBatch(userId, { purchaseId }, 1), ScanValidationError);
    assert.equal(await prisma.scanTile.count({ where: { purchaseId } }), 2);
  });

  it("gives a tile's images to a copy that already exists, and refuses an occupied slot", async () => {
    const { lotId, tileIds } = await orderWithTiles();
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
    const { purchaseId, tileIds } = await orderWithTiles();
    const outcome = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await prisma.item.delete({ where: { id: outcome.itemId } });

    const { batches } = await listScans(userId, { purchaseId });
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

  it("identifies a consumed tile's copy again — the whole answer, not just the stamp", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    const outcome = await identifyTileAsNewCopy(userId, tileIds[0], {
      stampId: baseStampId,
      conditionId,
      certificateStatusId,
    });
    const photoId = (await prisma.photo.findFirstOrThrow({ where: { itemId: outcome.itemId } })).id;

    // The mistake caught on the card: it is the watermark variant, it is mint rather than used, it
    // is a pair, and the certificate belonged to the piece it was confused with. Being wrong about
    // which stamp this is is usually being wrong about what was read off it, which is why the
    // correction takes the identification's whole answer and not only its first field.
    const corrected = await reidentifyTileCopy(userId, tileIds[0], {
      stampId: variantAId,
      conditionId: mintConditionId,
      formatId,
      forSale: true,
    });
    assert.equal(corrected.itemId, outcome.itemId, "the same copy, corrected — never a second one");
    assert.equal(corrected.itemNo, outcome.itemNo);

    const item = await prisma.item.findUniqueOrThrow({
      where: { id: outcome.itemId },
      select: {
        stampId: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
        inCollection: true,
        forSale: true,
        lotId: true,
        itemNo: true,
      },
    });
    assert.equal(item.stampId, variantAId);
    assert.equal(item.conditionId, mintConditionId);
    assert.equal(item.formatId, formatId);
    assert.equal(item.forSale, true);
    assert.equal(item.inCollection, false);
    // A field left empty is the collector **clearing** it, not declining to answer: the step opens
    // on what the copy is, so the certificate that is no longer ticked has to come off.
    assert.equal(item.certificateStatusId, null);
    // What the identification never asked stays exactly as it was — the copy's number and the lot
    // its money comes from.
    assert.equal(item.itemNo, outcome.itemNo);
    assert.notEqual(item.lotId, null);

    // The images stay where they went — a correction is not a re-identification of the pictures.
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(photo.itemId, outcome.itemId);

    // And the changed stamp is in the copy's refinement history, the same record the identical
    // correction made from the copies list leaves.
    const history = await prisma.itemVariantHistory.findMany({
      where: { itemId: outcome.itemId },
      select: { fromStampId: true, toStampId: true },
    });
    assert.deepEqual(history, [{ fromStampId: baseStampId, toStampId: variantAId }]);

    // The tile still says what it became, now naming the stamp it actually is.
    const { batches } = await listScans(userId, { purchaseId });
    const tile = batches[0].tiles.find((t) => t.id === tileIds[0]);
    assert.equal(tile?.state, "consumed");
    assert.equal(tile?.item?.stampId, variantAId);
    // …and carries what the correction's own condition step opens on next time.
    assert.equal(tile?.item?.conditionId, mintConditionId);
    assert.equal(tile?.item?.formatId, formatId);
  });

  it("corrects only what the piece is, never which lot the money came from", async () => {
    const { tileIds } = await orderWithTiles();
    const outcome = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    const before = await prisma.item.findUniqueOrThrow({
      where: { id: outcome.itemId },
      select: { lotId: true, deliveryState: true },
    });

    await reidentifyTileCopy(userId, tileIds[0], { stampId: variantBId, conditionId });

    const after = await prisma.item.findUniqueOrThrow({
      where: { id: outcome.itemId },
      select: { lotId: true, deliveryState: true },
    });
    // A copy takes its cost basis from a lot (ADR-0009 §3), so moving one between lots is a decision
    // about money and not about what the piece is. The correction asks no lot and moves none — nor
    // does it touch the delivery axis, which is about the parcel rather than the stamp.
    assert.equal(after.lotId, before.lotId);
    assert.equal(after.deliveryState, before.deliveryState);
  });

  it("refuses a correction on a tile that became no copy, or one whose copy is gone", async () => {
    const { tileIds } = await orderWithTiles();
    // Still waiting: there is nothing to correct, and identifying is the move.
    await assert.rejects(
      () => reidentifyTileCopy(userId, tileIds[0], { stampId, conditionId }),
      ScanValidationError
    );

    const outcome = await identifyTileAsNewCopy(userId, tileIds[1], { stampId, conditionId });
    // The condition step's own requirement, restated at the door: a copy always has a condition, so
    // a correction that dropped it would be a blank where an answer is.
    await assert.rejects(
      () => reidentifyTileCopy(userId, tileIds[1], { stampId: variantAId, conditionId: "" }),
      ScanValidationError
    );
    // A stamp from another collection is refused by the copy write itself, so the tile path cannot
    // be a way around collection scoping.
    await assert.rejects(() =>
      reidentifyTileCopy(userId, tileIds[1], { stampId: foreignStampId, conditionId })
    );

    await prisma.item.delete({ where: { id: outcome.itemId } });
    // `SetNull` leaves the tile consumed with nothing behind it: there is no copy to re-answer and
    // no images to re-answer it with.
    await assert.rejects(
      () => reidentifyTileCopy(userId, tileIds[1], { stampId: variantBId, conditionId }),
      ScanValidationError
    );
  });

  it("offers only copies with a free front or back slot as assign candidates", async () => {
    const { purchaseId, lotId } = await newOrder();
    const photo = (role: "front" | "back") => ({
      role,
      storageBackend: "filesystem",
      storageKey: `test/${role}-${Math.random().toString(36).slice(2)}`,
      mime: "image/png",
      width: 10,
      height: 10,
      sizeBytes: 100,
    });
    const copy = async (itemNo: number, roles: ("front" | "back")[]) =>
      prisma.item.create({
        data: {
          collectionId,
          itemNo,
          stampId,
          conditionId,
          lotId,
          deliveryState: "ordered",
          photos: { create: roles.map(photo) },
        },
        select: { id: true },
      });

    const bare = await copy(91_001, []);
    const frontOnly = await copy(91_002, ["front"]);
    const backOnly = await copy(91_003, ["back"]);
    const complete = await copy(91_004, ["front", "back"]);

    // Read at the **order** level since #586: a card holds pieces of every lot in the parcel, so
    // narrowing the candidates to one lot's copies is what made most of a settlement unreachable
    // from the tile in front of the collector.
    const candidates = async (roles: TilePhotoRole[]) => {
      const { items } = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
        freePhotoSlots: roles,
        pageSize: 100,
      });
      return new Set(items.map((i) => i.id));
    };

    // The rule is about the slots *this tile* needs, not about having any free slot. A front-only
    // tile cannot go onto a copy that merely lacks its back — the front is taken — and the looser
    // question offered exactly those, then the write refused them.
    assert.deepEqual(await candidates(["front"]), new Set([bare.id, backOnly.id]));
    assert.deepEqual(await candidates(["back"]), new Set([bare.id, frontOnly.id]));
    assert.deepEqual(await candidates(["front", "back"]), new Set([bare.id]));
    assert.ok(complete.id, "a fully photographed copy is never a candidate for anything");

    // Two expressions of one rule — the query fragment and the predicate the write refuses by — so
    // the test that matters is that they agree, over every role set and every copy.
    const rows = await prisma.item.findMany({
      where: { lotId },
      select: { id: true, photos: { select: { role: true } } },
    });
    for (const roles of [["front"], ["back"], ["front", "back"]] as TilePhotoRole[][]) {
      const viaSql = await prisma.item.findMany({
        where: { lotId, ...freePhotoSlotsWhere(roles) },
        select: { id: true },
      });
      assert.deepEqual(
        new Set(viaSql.map((i) => i.id)),
        new Set(rows.filter((r) => canTakeTileRoles(roles, r.photos)).map((r) => r.id)),
        `the query fragment and canTakeTileRoles agree for [${roles.join(",")}]`
      );
      assert.deepEqual(new Set(viaSql.map((i) => i.id)), await candidates(roles));
    }

    // And the distinction from `no-photos`, which is a different set: it would hide the copy whose
    // free slot is exactly the one a tile needs.
    const { items: noPhotos } = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
      filter: "no-photos",
      pageSize: 100,
    });
    assert.deepEqual(noPhotos.map((i) => i.id), [bare.id]);
  });

  it("never offers a candidate the write would refuse", async () => {
    // The invariant behind the filter, asserted end to end rather than trusted: everything the list
    // returns for a real tile is something `assignTileToCopy` accepts.
    const { purchaseId, lotId, tileIds } = await orderWithTiles();
    const photo = (role: "front" | "back") => ({
      role,
      storageBackend: "filesystem",
      storageKey: `test/${role}-${Math.random().toString(36).slice(2)}`,
      mime: "image/png",
      width: 10,
      height: 10,
      sizeBytes: 100,
    });
    for (const [i, roles] of [[], ["front"], ["back"], ["front", "back"]].entries()) {
      await prisma.item.create({
        data: {
          collectionId,
          itemNo: 92_001 + i,
          stampId,
          conditionId,
          lotId,
          deliveryState: "ordered",
          photos: { create: (roles as ("front" | "back")[]).map(photo) },
        },
      });
    }

    // A front-only tile, which is what an unturned card produces.
    const tile = await prisma.scanTile.findUniqueOrThrow({
      where: { id: tileIds[0] },
      select: { photos: { select: { role: true } } },
    });
    const roles = photoRolesPresent(tile.photos);
    assert.deepEqual(roles, ["front"]);

    const { items } = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
      freePhotoSlots: roles,
      pageSize: 100,
    });
    assert.ok(items.length > 0, "there is something to prove");
    // Every one of them accepts the tile. Assigning consumes it, so each candidate is checked
    // against its own tile-shaped copy of the question rather than by assigning four times.
    for (const candidate of items) {
      assert.equal(
        canTakeTileRoles(roles, candidate.photos),
        true,
        `copy ${candidate.itemNo} was offered, so the write must accept it`
      );
    }
    // …and the first one really does go through, which is what ties the predicate to the write.
    await assignTileToCopy(userId, tileIds[0], items[0].id);
  });

  it("takes a copy on any lot of the order, and refuses one from another order", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();

    // The settlement case, and the whole reason for #586: a second lot on the *same* parcel, whose
    // copy is on the same card. The old same-lot rule refused exactly this.
    const sibling = await createLot(userId, purchaseId, 40);
    const onSibling = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 90_003,
        stampId,
        conditionId,
        lotId: sibling,
        deliveryState: "ordered",
      },
      select: { id: true },
    });
    const outcome = await assignTileToCopy(userId, tileIds[0], onSibling.id);
    assert.equal(outcome.itemId, onSibling.id);

    // A different parcel is still a refusal: the copy never came out of this envelope.
    const elsewhere = await newOrder();
    const stranger = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 90_002,
        stampId,
        conditionId,
        lotId: elsewhere.lotId,
        deliveryState: "ordered",
      },
      select: { id: true },
    });
    await assert.rejects(
      () => assignTileToCopy(userId, tileIds[1], stranger.id),
      ScanValidationError
    );
  });

  it("asks for a lot only when the order has more than one", async () => {
    // One lot answers it silently — the stockbook case, which had no such question before the
    // re-parenting and must not gain one.
    const single = await orderWithTiles();
    const copy = await identifyTileAsNewCopy(userId, single.tileIds[0], { stampId, conditionId });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: copy.itemId } });
    assert.equal(item.lotId, single.lotId);

    // A second lot makes it unanswerable from the card, so it is refused rather than guessed: a
    // guess here files a stamp against the wrong money, which is why a default lot on the batch
    // was rejected too.
    const second = await createLot(userId, single.purchaseId, 40);
    await assert.rejects(
      () => identifyTileAsNewCopy(userId, single.tileIds[1], { stampId, conditionId }),
      ScanValidationError
    );

    // Told which, it lands there.
    const onSecond = await identifyTileAsNewCopy(userId, single.tileIds[1], {
      lotId: second,
      stampId,
      conditionId,
    });
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: onSecond.itemId } })).lotId,
      second
    );
  });

  it("refuses a lot from another order, which is what a stale remembered answer looks like", async () => {
    const { tileIds } = await orderWithTiles();
    const elsewhere = await newOrder();
    await assert.rejects(
      () =>
        identifyTileAsNewCopy(userId, tileIds[0], {
          lotId: elsewhere.lotId,
          stampId,
          conditionId,
        }),
      ScanValidationError
    );
  });

  it("discards a tile in one click, keeping its image and dropping it from the unidentified count", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    // What the screen sends: no note at all. Discard is the frequent answer on a parcel full of
    // junk, so it asks for nothing — safe because it is reversible and the note can follow.
    await discardTile(userId, tileIds[0], "");

    let tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.state, "discarded");
    assert.equal(tile.note, null, "an empty note is no note, not an empty string");

    // The note is written afterwards, from the settled view, on the tile that earns one.
    await noteTile(userId, tileIds[0], "  thinned, not worth keeping  ");
    tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.note, "thinned, not worth keeping");
    // The image stays: a discarded tile is evidence of what the parcel held, not a queue item.
    assert.equal(await prisma.photo.count({ where: { tileId: tileIds[0] } }), 1);
    assert.equal(
      await prisma.scanTile.count({ where: { purchaseId, state: "unidentified" } }),
      1,
      "a discarded tile stops counting as unidentified"
    );

    // And it can be put back, because a mis-click on a card of forty should not need a re-cut —
    // which is exactly what makes the one-click discard safe.
    await returnTilesToQueue(userId, [tileIds[0]]);
    const back = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(back.state, "unidentified");
    assert.equal(back.note, null);

    // A note belongs to a discard. A tile back in the queue has nothing to carry one about.
    await assert.rejects(
      () => noteTile(userId, tileIds[0], "late thought"),
      ScanValidationError
    );
  });

  it("parks a tile with the doubt written on it, and identifies it when the answer is known (#597)", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    // Parking is one press with nothing asked for, exactly as a discard is: the screen sends a
    // blank note and the sentence follows while the doubt is fresh.
    await parkTile(userId, tileIds[0], "");
    let tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.state, "parked");
    assert.equal(tile.note, null, "an empty note is no note");

    await noteTile(userId, tileIds[0], "  watermark? dark or light blue  ");
    tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(tile.note, "watermark? dark or light blue");

    // It leaves the sweep — which is the interruption parking exists to stop — without leaving the
    // work: it is counted apart, not counted out.
    assert.equal(
      await prisma.scanTile.count({ where: { purchaseId, state: "unidentified" } }),
      1,
      "a parked tile stops being re-offered as waiting"
    );
    assert.equal(await countParkedTiles({ collectionId, purchaseId }), 1);
    assert.equal(
      (await getPurchaseDetail(userId, purchaseId))?.parkedTileCount,
      1,
      "and the order header can say so"
    );

    // The image never went anywhere, and the tile is identified straight from `parked` — the return
    // sitting is exactly when several settle at once, so there is no un-parking step in front of it.
    assert.equal(await prisma.photo.count({ where: { tileId: tileIds[0] } }), 1);
    const copy = await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    const consumed = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(consumed.state, "consumed");
    assert.equal(consumed.itemId, copy.itemId);
    assert.equal(
      await prisma.photo.count({ where: { itemId: copy.itemId } }),
      1,
      "the parked tile's own picture is what the copy got"
    );
  });

  it("puts a parked tile back, and refuses a note once it is in the queue again (#597)", async () => {
    const { tileIds } = await orderWithTiles();
    await parkTile(userId, tileIds[0], "check perf against Mi 200");
    await returnTilesToQueue(userId, [tileIds[0]]);
    const back = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(back.state, "unidentified");
    assert.equal(back.note, null, "the doubt was spent when the answer arrived");
    await assert.rejects(
      () => noteTile(userId, tileIds[0], "late thought"),
      ScanValidationError
    );
  });

  it("keeps the parked doubt as the record when the piece turns out to be nothing (#597)", async () => {
    // Discarding sends a blank note, and the sentence already on the tile is a fair account of why
    // it went — clearing it here would throw away the only thing written about the piece.
    const { tileIds } = await orderWithTiles();
    await parkTile(userId, tileIds[0], "watermark?");
    await discardTile(userId, tileIds[0], "");
    const gone = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileIds[0] } });
    assert.equal(gone.state, "discarded");
    assert.equal(gone.note, "watermark?");
  });

  it("keeps the narrowing on a parked tile, and nothing of it survives the identification (#607)", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    // Listed **while the piece is on screen**, before the collector concludes it cannot be settled
    // here: the narrowing is what discovers that, so a shortlist that could only be written after
    // parking meant setting the tile aside and opening it again to say what was already in mind.
    await addTileCandidate(userId, [tileIds[0]], variantAId);
    await parkTile(userId, tileIds[0], "watermark?");
    await addTileCandidate(userId, [tileIds[0]], variantBId);
    // The same stamp twice is what a second press of it in the picker means — the pair is the row.
    await addTileCandidate(userId, [tileIds[0]], variantAId);

    const { batches } = await listScans(userId, { purchaseId });
    const parked = batches[0].tiles.find((t) => t.id === tileIds[0])!;
    assert.deepEqual(
      parked.candidates.map((c) => c.stampId),
      [variantAId, variantBId],
      "in the order the shortlist was built, with no duplicate"
    );
    assert.deepEqual(parked.candidates[0].catalogNumbers, ["200a"]);
    // …and enough of the tree for the correction to decide itself: both are effective variants of
    // one node, so the app can say the parent is available instead of a parked tile at all.
    assert.deepEqual(sharedVariantParent(parked.candidates), {
      stampId: baseStampId,
      stampName: "Birds",
      catalogNumbers: ["200"],
    });

    // A possibility ruled out costs what adding it did, and one that was never there is not an
    // error — the end state is what was asked for either way.
    await removeTileCandidate(userId, [tileIds[0]], variantBId);
    await removeTileCandidate(userId, [tileIds[0]], variantBId);
    assert.equal(
      await prisma.scanTileCandidate.count({ where: { tileId: tileIds[0] } }),
      1
    );

    // **Nothing survives the identification.** What the copy became is the record, and refinement
    // history is where a later change of mind is written.
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId: variantAId, conditionId });
    assert.equal(await prisma.scanTileCandidate.count({ where: { tileId: tileIds[0] } }), 0);
  });

  it("spends the shortlist with the doubt, and keeps it where the note is kept (#607)", async () => {
    const { tileIds } = await orderWithTiles();

    // Put back: the answer is known (or it was a mis-click), so the doubt and everything written
    // about it are spent — the note's own rule.
    await parkTile(userId, tileIds[0], "dark or light blue?");
    await addTileCandidate(userId, [tileIds[0]], variantAId);
    await returnTilesToQueue(userId, [tileIds[0]]);
    assert.equal(await prisma.scanTileCandidate.count({ where: { tileId: tileIds[0] } }), 0);

    // Discarded: the tile is the only record of what a sight-unseen parcel held, so what it might
    // have been is kept beside the note saying why it went.
    await parkTile(userId, tileIds[1], "watermark?");
    await addTileCandidate(userId, [tileIds[1]], variantBId);
    await discardTile(userId, tileIds[1], "");
    assert.equal(await prisma.scanTileCandidate.count({ where: { tileId: tileIds[1] } }), 1);
  });

  it("refuses a candidate from another collection, or on a tile already worked through (#607)", async () => {
    const { tileIds } = await orderWithTiles();
    await parkTile(userId, tileIds[0], "");
    // A shortlist that could name another collection's stamp would offer to identify this piece as
    // something the order cannot hold.
    await assert.rejects(
      () => addTileCandidate(userId, [tileIds[0]], foreignStampId),
      ScanValidationError
    );
    await identifyTileAsNewCopy(userId, tileIds[1], { stampId, conditionId });
    await assert.rejects(
      () => addTileCandidate(userId, [tileIds[1]], variantAId),
      ScanValidationError
    );
  });

  it("does not let a parked tile finish a batch (#597)", async () => {
    // The whole reason parking is a state rather than a note: #578 sweeps a finished batch's scan,
    // and the parked piece is the one the collector is coming back to that scan for.
    const { purchaseId, tileIds } = await orderWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await parkTile(userId, tileIds[1], "two shades of blue");

    let sheet = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.equal(sheet.batchDoneAt, null, "a parked tile is still to be identified");

    await identifyTileAsNewCopy(userId, tileIds[1], { stampId, conditionId });
    sheet = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.ok(sheet.batchDoneAt, "settled, and the batch is finished with as usual");
  });

  it("stamps the batch when its last tile leaves the queue, and unstamps it if one comes back", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });

    const midway = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.equal(midway.batchDoneAt, null, "one tile is still waiting");

    await discardTile(userId, tileIds[1], "junk");
    const done = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.ok(done.batchDoneAt, "the batch is finished with, and the retained scan can do nothing");

    // Nothing here reads the stamp — #578's retention sweep will — but a tile coming back means
    // the batch is being worked again, so the sweep must not still be counting down on it.
    await returnTilesToQueue(userId, [tileIds[1]]);
    const reopened = await prisma.scanSheet.findFirstOrThrow({ where: { purchaseId } });
    assert.equal(reopened.batchDoneAt, null);
  });

  // A selection of tiles reaches every outcome, not only identification: the strip's bar opens the
  // tile's own dialog, so discarding, parking and the shortlist all take the list the ticking made.
  it("discards and parks a run of tiles under one answer", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();

    await parkTiles(userId, tileIds, "  dark or light blue?  ");
    let tiles = await prisma.scanTile.findMany({ where: { purchaseId } });
    assert.deepEqual(
      tiles.map((t) => [t.state, t.note]).sort(),
      [
        ["parked", "dark or light blue?"],
        ["parked", "dark or light blue?"],
      ],
      "the sentence is written onto every piece, since it is read off whichever one is opened"
    );
    // Parked pieces keep the batch outstanding, however many were set aside at once (#597).
    assert.equal(
      await prisma.scanSheet.count({ where: { purchaseId, batchDoneAt: { not: null } } }),
      0
    );

    // A mixed run — one piece parked last week, one still waiting — keeps the sentence that was
    // already written and fills only the blank one: the press is aimed at the pieces beside it, and
    // a doubt overwritten by it would be gone with nothing saying so.
    await noteTile(userId, tileIds[0], "check perf against Mi 200");
    await returnTilesToQueue(userId, [tileIds[1]]);
    await parkTiles(userId, tileIds, "watermark?");
    tiles = await prisma.scanTile.findMany({ where: { purchaseId }, orderBy: { position: "asc" } });
    assert.deepEqual(tiles.map((t) => t.note), ["check perf against Mi 200", "watermark?"]);

    // Put back is one move for the run, and spends the doubt with it.
    await returnTilesToQueue(userId, tileIds);
    tiles = await prisma.scanTile.findMany({ where: { purchaseId } });
    assert.deepEqual(tiles.map((t) => t.state).sort(), ["unidentified", "unidentified"]);
    assert.deepEqual(tiles.map((t) => t.note), [null, null]);

    // And a run of junk goes in one act — the images stay, as they do for one tile.
    await discardTiles(userId, tileIds, "");
    tiles = await prisma.scanTile.findMany({ where: { purchaseId } });
    assert.deepEqual(tiles.map((t) => t.state).sort(), ["discarded", "discarded"]);
    assert.equal(await prisma.photo.count({ where: { tileId: { in: tileIds } } }), 2);
  });

  it("refuses a whole selection before writing any of it", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    // One tile of the run has been worked through in another tab. The pass is refused rather than
    // half-run: a stale strip costs a sentence, not a card discarded in part with nothing saying
    // which part.
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    await assert.rejects(() => discardTiles(userId, tileIds, ""), ScanValidationError);
    assert.equal(
      await prisma.scanTile.count({ where: { purchaseId, state: "unidentified" } }),
      1,
      "the still-waiting tile was not discarded"
    );

    // A tile named twice would be counted once on the bar and written to once here — refused, since
    // the two numbers disagreeing is the kind of thing nobody notices.
    await assert.rejects(
      () => parkTiles(userId, [tileIds[1], tileIds[1]], "watermark?"),
      ScanValidationError
    );
    // …as is a selection spanning two orders: the pass is about one card on the desk.
    const elsewhere = await orderWithTiles();
    await assert.rejects(
      () => parkTiles(userId, [tileIds[1], elsewhere.tileIds[0]], ""),
      ScanValidationError
    );
  });

  it("writes and rules out a shortlist across the whole run (#607)", async () => {
    const { tileIds } = await orderWithTiles();
    await addTileCandidate(userId, tileIds, variantAId);
    assert.equal(
      await prisma.scanTileCandidate.count({ where: { tileId: { in: tileIds } } }),
      2,
      "a possibility listed for the run is listed on each of its pieces"
    );
    // Pressed again over a run one piece already carries it on: an upsert, so it means what the
    // first press did.
    await addTileCandidate(userId, [tileIds[0]], variantAId);
    await addTileCandidate(userId, tileIds, variantBId);
    assert.equal(await prisma.scanTileCandidate.count({ where: { tileId: { in: tileIds } } }), 4);

    // Ruling one out is the mirror: off all of them, or the shortlist would disagree with itself.
    await removeTileCandidate(userId, tileIds, variantBId);
    const left = await prisma.scanTileCandidate.findMany({ where: { tileId: { in: tileIds } } });
    assert.deepEqual([...new Set(left.map((c) => c.stampId))], [variantAId]);
  });

  it("refuses to work a tile twice", async () => {
    const { tileIds } = await orderWithTiles();
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

  it("surfaces a tile whose stamp is on none of the settled sale's lines", async () => {
    const { purchaseId, lotId, tileIds } = await orderWithTiles();
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
        // The settlement link (#28), which since #586 is what answers `fromAuction`: the card
        // belongs to the parcel, so what it is read against is the whole sale's description rather
        // than one won lot's.
        purchaseId,
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

    const { batches, fromAuction } = await listScans(userId, { purchaseId });
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

  it("says nothing about an order that came from no auction", async () => {
    const { purchaseId, tileIds } = await orderWithTiles();
    await identifyTileAsNewCopy(userId, tileIds[0], { stampId, conditionId });
    const { batches, fromAuction } = await listScans(userId, { purchaseId });
    assert.equal(fromAuction, false);
    // No description exists, so no tile can disagree with one — the absence of lines must not read
    // as "every stamp here was undescribed".
    assert.ok(batches[0].tiles.every((t) => !t.outsideDescription));
  });
});
