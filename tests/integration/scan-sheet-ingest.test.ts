import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { deleteLot } from "../../src/lib/lots";
import { getCollectionPhotoStorageBytes, getPhotoForServing } from "../../src/lib/photos";
import { FULL_MAX_EDGE } from "../../src/lib/photos/process";
import {
  ScanValidationError,
  commitCut,
  deleteBatch,
  getSheetForServing,
  listLotScans,
  pairTilesManually,
  recutBatch,
  renderSheetRegion,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import type { Box } from "../../src/lib/scan-boxes";
import { getStorage, sheetVariantKey, variantKey } from "../../src/lib/storage";

// Bytes go through the filesystem backend, so point it at a throwaway directory rather than the
// repo's `.data`. `dataDir()` reads the env var on every call, so setting it here — before any test
// body runs — is enough; nothing touches storage at import time.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-sheets-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Scan sheet ingest (#566, ADR-0033). The geometry — reading order, split/merge, mutual-nearest
// pairing — is unit-tested in `scan-boxes.test.ts`; what needs a database and a storage backend is
// exercised here:
//
//   - the cut happens on the **original**, so a tile comes out at its box's own size even when the
//     sheet is far larger than `FULL_MAX_EDGE`, and carries the pixels its box was drawn over;
//   - the sheet is **retained**, and a batch can be re-cut from it;
//   - a back scan pairs **by position** onto the batch's front tiles, with the leftovers on both
//     sides reported rather than forced;
//   - an unmatched back becomes a back-only tile that can be dragged onto a front by hand;
//   - re-cutting is refused once a tile has become a copy;
//   - nothing leaks bytes.
//
// The images here are synthetic on purpose and that is not the thing #574 forbids: nothing below
// *detects* anything. Every box is supplied by the test exactly as a collector's hand supplies one,
// which is the whole point of #566 shipping the editor first. Fitting detection constants to
// generated images is what stays out until there are real scans.

/**
 * A card scan: a black stockbook card with coloured rectangles laid on it, one per stamp. Black
 * background because that is the constant of the routine, and distinct colours so a crop can be
 * asked which stamp it actually contains.
 */
async function card(
  width: number,
  height: number,
  stamps: { box: Box; colour: [number, number, number] }[]
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite(
      await Promise.all(
        stamps.map(async (s) => ({
          input: await sharp({
            create: {
              width: s.box.w,
              height: s.box.h,
              channels: 3,
              background: { r: s.colour[0], g: s.colour[1], b: s.colour[2] },
            },
          })
            .png()
            .toBuffer(),
          left: s.box.x,
          top: s.box.y,
        }))
      )
    )
    .png()
    .toBuffer();
}

/** The colour at the centre of a stored tile variant — which stamp did this crop actually take? */
async function centreColour(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<[number, number, number]> {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  const { data, info } = await sharp(Buffer.concat(chunks))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cx = info.width >> 1;
  const cy = info.height >> 1;
  const at = (cy * info.width + cx) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

async function photoBytesExist(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<boolean> {
  const storage = getStorage(photo.storageBackend);
  try {
    for (const v of ["full", "thumb"] as const) {
      await storage.get(variantKey(photo.storageKey, v, photo.mime), photo.mime);
    }
    return true;
  } catch {
    return false;
  }
}

async function sheetBytesExist(sheet: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<boolean> {
  const storage = getStorage(sheet.storageBackend);
  try {
    for (const v of ["original", "view"] as const) {
      await storage.get(sheetVariantKey(sheet.storageKey, v, sheet.mime), sheet.mime);
    }
    return true;
  } catch {
    return false;
  }
}

const RED: [number, number, number] = [220, 30, 30];
const GREEN: [number, number, number] = [30, 200, 30];
const BLUE: [number, number, number] = [30, 30, 220];

describe("scan sheet ingest (#566)", () => {
  let userId: string;
  let collectionId: string;
  let purchaseId: string;

  // A card deliberately wider than FULL_MAX_EDGE, so "the cut happens before the pipeline" is
  // something the assertions can actually tell apart from the opposite ordering.
  const SHEET_W = 4000;
  const SHEET_H = 1600;
  const FRONT_BOXES: Box[] = [
    { x: 200, y: 300, w: 600, h: 800 },
    { x: 1600, y: 300, w: 600, h: 800 },
    { x: 3000, y: 300, w: 600, h: 800 },
  ];
  const COLOURS = [RED, GREEN, BLUE];

  before(async () => {
    assert.ok(SHEET_W > FULL_MAX_EDGE, "the sheet must exceed the pipeline's cap to prove the order");
    const ts = Date.now();
    userId = `test-user-scans-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User scans-${ts}`,
        email: `test-scans-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-scans-${ts}`,
        name: `Collection scans-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    purchaseId = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 1,
          purchasedAt: new Date("2026-08-01"),
          currency: "EUR",
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function newLot(): Promise<string> {
    return (
      await prisma.purchaseLot.create({ data: { purchaseId, price: 100 } })
    ).id;
  }

  async function uploadFront(lotId: string) {
    const bytes = await card(
      SHEET_W,
      SHEET_H,
      FRONT_BOXES.map((box, i) => ({ box, colour: COLOURS[i] }))
    );
    return uploadSheet(userId, lotId, { bytes, mime: "image/png", side: "front" });
  }

  it("retains the scan at full size and derives a view for the editor", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);

    assert.equal(sheet.width, SHEET_W);
    assert.equal(sheet.height, SHEET_H);
    // The view is capped for the browser; the original is not capped at all.
    assert.equal(sheet.viewWidth, FULL_MAX_EDGE);
    assert.equal(sheet.viewHeight, Math.round((SHEET_H * FULL_MAX_EDGE) / SHEET_W));

    const row = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    assert.equal(row.batchNo, 1);
    assert.equal(row.side, "front");
    assert.ok(await sheetBytesExist(row));

    await deleteLot(userId, lotId);
  });

  it("cuts on the original, so a tile is its box's own size and holds its box's pixels", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    const report = await commitCut(userId, sheet.id, FRONT_BOXES);

    assert.equal(report.created, 3);
    assert.equal(report.frontCount, 3);
    assert.equal(report.backCount, 0);

    const tiles = await prisma.scanTile.findMany({
      where: { lotId },
      orderBy: { position: "asc" },
      include: { photos: true },
    });
    assert.equal(tiles.length, 3);

    for (const [i, tile] of tiles.entries()) {
      assert.equal(tile.position, i);
      assert.equal(tile.state, "unidentified");
      assert.equal(tile.frontSheetId, sheet.id);
      assert.deepEqual(
        { x: tile.frontX, y: tile.frontY, w: tile.frontW, h: tile.frontH },
        FRONT_BOXES[i]
      );

      const front = tile.photos.find((p) => p.role === "front");
      assert.ok(front, "every front tile carries a front photo");
      // The whole point of the ordering: 600×800 out of a 4000-wide sheet. Had the sheet gone
      // through `processImage` first it would have been 2500 wide and this crop 375×500.
      assert.equal(front.width, FRONT_BOXES[i].w);
      assert.equal(front.height, FRONT_BOXES[i].h);
      assert.ok(await photoBytesExist(front));
      // And it is the *right* 600×800 — reading order maps tile i to the i-th stamp left to right.
      assert.deepEqual(await centreColour(front), COLOURS[i]);
    }

    await deleteLot(userId, lotId);
  });

  it("refuses a second cut of the same scan, and a box outside it", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    await commitCut(userId, sheet.id, FRONT_BOXES);
    await assert.rejects(
      () => commitCut(userId, sheet.id, FRONT_BOXES),
      ScanValidationError
    );

    const other = await newLot();
    const fresh = await uploadFront(other);
    await assert.rejects(
      () => commitCut(userId, fresh.id, [{ x: SHEET_W - 100, y: 0, w: 400, h: 400 }]),
      ScanValidationError
    );
    await assert.rejects(() => commitCut(userId, fresh.id, []), ScanValidationError);

    await deleteLot(userId, lotId);
    await deleteLot(userId, other);
  });

  it("pairs a back scan by position, not by index, and does not mirror it", async () => {
    const lotId = await newLot();
    const front = await uploadFront(lotId);
    await commitCut(userId, front.id, FRONT_BOXES);

    // The card turned over stamp by stamp **in place**: same layout, and the back of the leftmost
    // stamp is still leftmost. The boxes are handed over right-to-left to make the point that
    // neither array order nor a mirror decides the pairing — position does.
    const backBytes = await card(
      SHEET_W,
      SHEET_H,
      FRONT_BOXES.map((box, i) => ({ box, colour: COLOURS[i] }))
    );
    const back = await uploadSheet(userId, lotId, {
      bytes: backBytes,
      mime: "image/png",
      side: "back",
      batchNo: front.batchNo,
    });
    const report = await commitCut(userId, back.id, [...FRONT_BOXES].reverse());

    assert.equal(report.paired, 3);
    assert.equal(report.created, 0, "a fully paired back creates no new tiles");
    assert.equal(report.backOnly, 0);
    assert.deepEqual(report.frontWithoutBack, []);

    const tiles = await prisma.scanTile.findMany({
      where: { lotId },
      orderBy: { position: "asc" },
      include: { photos: true },
    });
    assert.equal(tiles.length, 3, "pairing attaches to existing tiles rather than adding any");
    for (const [i, tile] of tiles.entries()) {
      const backPhoto = tile.photos.find((p) => p.role === "back");
      assert.ok(backPhoto, `tile ${i} has a back`);
      // Each back sits where its front sat: tile 0 is the leftmost stamp on both sides. A mirror
      // would have given tile 0 the blue stamp's back.
      assert.deepEqual(await centreColour(backPhoto), COLOURS[i]);
      assert.equal(tile.backSheetId, back.id);
    }

    await deleteLot(userId, lotId);
  });

  it("reports a count mismatch instead of forcing a pairing", async () => {
    const lotId = await newLot();
    const front = await uploadFront(lotId);
    await commitCut(userId, front.id, FRONT_BOXES);

    // A back scan of the first stamp only — the sparse case — plus one region in a spot no front
    // box occupies, which is what a stamp that fell out of the front scan looks like.
    const strayBox: Box = { x: 200, y: 1200, w: 300, h: 300 };
    const backBytes = await card(SHEET_W, SHEET_H, [
      { box: FRONT_BOXES[0], colour: RED },
      { box: strayBox, colour: GREEN },
    ]);
    const back = await uploadSheet(userId, lotId, {
      bytes: backBytes,
      mime: "image/png",
      side: "back",
      batchNo: front.batchNo,
    });
    const report = await commitCut(userId, back.id, [FRONT_BOXES[0], strayBox]);

    assert.equal(report.frontCount, 3);
    assert.equal(report.backCount, 2);
    assert.equal(report.paired, 1);
    // The two middle/right fronts are named, so the collector is told which ones to look at.
    assert.deepEqual(report.frontWithoutBack, [1, 2]);
    assert.equal(report.backOnly, 1);
    assert.equal(report.created, 1, "the unmatched back becomes a back-only tile");

    const backOnly = await prisma.scanTile.findFirstOrThrow({
      where: { lotId, frontSheetId: null },
      include: { photos: true },
    });
    assert.equal(backOnly.position, 3, "appended, so no existing tile's position shifts");
    assert.equal(backOnly.photos.length, 1);
    assert.equal(backOnly.photos[0].role, "back");

    await deleteLot(userId, lotId);
  });

  it("pairs a leftover back onto a front tile by hand", async () => {
    const lotId = await newLot();
    const front = await uploadFront(lotId);
    await commitCut(userId, front.id, FRONT_BOXES);

    // A sparse back scan: the leftmost stamp turned over in place, plus one region low on the card
    // that sits under no front box. The first pairs; the second is nobody's mutual nearest and so
    // arrives as a back-only tile — which is the thing manual pairing exists to place.
    const strayBox: Box = { x: 200, y: 1200, w: 300, h: 300 };
    const backBytes = await card(SHEET_W, SHEET_H, [
      { box: FRONT_BOXES[0], colour: RED },
      { box: strayBox, colour: GREEN },
    ]);
    const back = await uploadSheet(userId, lotId, {
      bytes: backBytes,
      mime: "image/png",
      side: "back",
      batchNo: front.batchNo,
    });
    await commitCut(userId, back.id, [FRONT_BOXES[0], strayBox]);

    const tiles = await prisma.scanTile.findMany({ where: { lotId }, orderBy: { position: "asc" } });
    const paired = tiles.find((t) => t.position === 0)!;
    const target = tiles.find((t) => t.position === 1)!;
    const backOnly = tiles.filter((t) => t.frontSheetId == null);
    assert.equal(backOnly.length, 1);

    await pairTilesManually(userId, backOnly[0].id, target.id);

    const merged = await prisma.scanTile.findUniqueOrThrow({
      where: { id: target.id },
      include: { photos: true },
    });
    assert.equal(merged.photos.length, 2);
    assert.equal(merged.backSheetId, back.id);
    // The image the collector dragged is the one that landed — re-owned, not re-cut.
    assert.deepEqual(await centreColour(merged.photos.find((p) => p.role === "back")!), GREEN);
    assert.deepEqual(merged.backX, strayBox.x);
    // The emptied tile is gone rather than lingering as a tile of nothing.
    assert.equal(await prisma.scanTile.count({ where: { id: backOnly[0].id } }), 0);
    assert.ok(await photoBytesExist(merged.photos.find((p) => p.role === "back")!));

    // A tile that already has a back does not take a second, and a tile with a front of its own is
    // not something that can be dragged onto another.
    await assert.rejects(
      () => pairTilesManually(userId, target.id, paired.id),
      ScanValidationError
    );

    await deleteLot(userId, lotId);
  });

  it("re-cuts from the retained scan: tiles go, the sheet stays", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    await commitCut(userId, sheet.id, FRONT_BOXES);

    const photos = await prisma.photo.findMany({ where: { tile: { lotId } } });
    assert.equal(photos.length, 3);

    const { discarded } = await recutBatch(userId, lotId, 1);
    assert.equal(discarded, 3);

    assert.equal(await prisma.scanTile.count({ where: { lotId } }), 0);
    assert.equal(await prisma.photo.count({ where: { tile: { lotId } } }), 0);
    for (const p of photos) assert.equal(await photoBytesExist(p), false);

    // The scan itself survives — that is the whole point — and can be cut again, differently.
    const row = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    assert.ok(await sheetBytesExist(row));
    const again = await commitCut(userId, sheet.id, [FRONT_BOXES[0], FRONT_BOXES[2]]);
    assert.equal(again.created, 2);

    await deleteLot(userId, lotId);
  });

  it("refuses to re-cut past a tile that has become a copy", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    await commitCut(userId, sheet.id, FRONT_BOXES);

    // #567 is what sets this; forced here so the guard it exists for is tested before it can fire
    // in anger, since by then a copy's images would be what is at stake.
    const tile = await prisma.scanTile.findFirstOrThrow({ where: { lotId } });
    await prisma.scanTile.update({ where: { id: tile.id }, data: { state: "consumed" } });

    await assert.rejects(() => recutBatch(userId, lotId, 1), ScanValidationError);
    await assert.rejects(() => deleteBatch(userId, lotId, 1), ScanValidationError);
    assert.equal(await prisma.scanTile.count({ where: { lotId } }), 3);

    await prisma.scanTile.update({ where: { id: tile.id }, data: { state: "unidentified" } });
    await deleteLot(userId, lotId);
  });

  it("serves a tile's crop through the photo route", async () => {
    // The fourth owner has to be added to `getPhotoForServing` as well as to the schema, or the
    // rows look perfectly correct and every thumbnail 404s — which is exactly how this shipped
    // broken the first time. Asserting the resolution, not the bytes: the route above it is the
    // same one the other three owners already use.
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    await commitCut(userId, sheet.id, FRONT_BOXES);

    const photo = await prisma.photo.findFirstOrThrow({ where: { tile: { lotId } } });
    const served = await getPhotoForServing(photo.id);
    assert.ok(served, "a tile's photo resolves an owner");
    assert.equal(served.collectionId, collectionId);
    assert.equal(served.ownerId, userId);
    assert.equal(served.storageKey, photo.storageKey);

    await deleteLot(userId, lotId);
  });

  it("serves a zoomed region from the original, not from the display copy (#579)", async () => {
    // The reason the editor can be trusted to catch a box clipping a perforation: past the `view`
    // derivative's own scale the visible region comes from the retained original. `view` is capped
    // at FULL_MAX_EDGE, so on this 4000 px card it holds a 600 px box at 375 px — a region that
    // comes back at the box's full 600 could not have been taken from it.
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    const serving = await getSheetForServing(sheet.id);
    assert.ok(serving);
    assert.equal(serving.width, SHEET_W);

    const box = FRONT_BOXES[1];
    const region = await renderSheetRegion(serving, box, box.w);
    const { data, info } = await sharp(region.buffer).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, box.w);
    assert.equal(info.height, box.h);
    const at = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
    assert.deepEqual([data[at], data[at + 1], data[at + 2]], GREEN);

    // The same guard the cut has: a region outside the card is named rather than left to `extract`.
    await assert.rejects(
      () => renderSheetRegion(serving, { x: SHEET_W - 10, y: 0, w: 100, h: 100 }, 100),
      ScanValidationError
    );

    await deleteLot(userId, lotId);
  });

  it("lists a lot's batches with their sheets, tiles and boxes", async () => {
    const lotId = await newLot();
    const front = await uploadFront(lotId);
    await commitCut(userId, front.id, FRONT_BOXES);

    const { batches } = await listLotScans(userId, lotId);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].batchNo, 1);
    assert.equal(batches[0].back, null);
    assert.equal(batches[0].front?.cut, true);
    assert.equal(batches[0].front?.width, SHEET_W);
    assert.equal(batches[0].tiles.length, 3);
    assert.deepEqual(batches[0].tiles[0].frontBox, FRONT_BOXES[0]);
    assert.equal(batches[0].tiles[0].backBox, null);
    assert.ok(batches[0].tiles[0].frontPhotoId);

    await deleteLot(userId, lotId);
  });

  it("counts retained scans and tiles in the collection's storage total", async () => {
    const before = await getCollectionPhotoStorageBytes(userId, collectionId);
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    const afterUpload = await getCollectionPhotoStorageBytes(userId, collectionId);
    const row = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    // The retained original is the largest object the app stores; a total that left it out would
    // be the one number an operator sizing a volume must not be given.
    assert.equal(afterUpload - before, row.sizeBytes);

    await commitCut(userId, sheet.id, FRONT_BOXES);
    const afterCut = await getCollectionPhotoStorageBytes(userId, collectionId);
    assert.ok(afterCut > afterUpload, "the tiles' own bytes count too");

    await deleteLot(userId, lotId);
    assert.equal(await getCollectionPhotoStorageBytes(userId, collectionId), before);
  });

  it("deleting the batch, and deleting the lot, leave no bytes behind", async () => {
    const lotId = await newLot();
    const sheet = await uploadFront(lotId);
    await commitCut(userId, sheet.id, FRONT_BOXES);

    const sheetRow = await prisma.scanSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    const photos = await prisma.photo.findMany({ where: { tile: { lotId } } });

    await deleteBatch(userId, lotId, 1);
    assert.equal(await prisma.scanSheet.count({ where: { lotId } }), 0);
    assert.equal(await sheetBytesExist(sheetRow), false);
    for (const p of photos) assert.equal(await photoBytesExist(p), false);

    // And again through the lot, which is the path that has to survive a cascade.
    const second = await uploadFront(lotId);
    await commitCut(userId, second.id, FRONT_BOXES);
    const secondRow = await prisma.scanSheet.findUniqueOrThrow({ where: { id: second.id } });
    const secondPhotos = await prisma.photo.findMany({ where: { tile: { lotId } } });

    await deleteLot(userId, lotId);
    assert.equal(await sheetBytesExist(secondRow), false);
    for (const p of secondPhotos) assert.equal(await photoBytesExist(p), false);
  });

  it("replaces an uncut scan but refuses to replace a cut one", async () => {
    const lotId = await newLot();
    const first = await uploadFront(lotId);
    const firstRow = await prisma.scanSheet.findUniqueOrThrow({ where: { id: first.id } });

    // Nothing has been cut yet, so the wrong file can simply be uploaded again.
    const second = await uploadSheet(userId, lotId, {
      bytes: await card(SHEET_W, SHEET_H, [{ box: FRONT_BOXES[0], colour: BLUE }]),
      mime: "image/png",
      side: "front",
      batchNo: first.batchNo,
    });
    assert.notEqual(second.id, first.id);
    assert.equal(await prisma.scanSheet.count({ where: { lotId, batchNo: 1 } }), 1);
    assert.equal(await sheetBytesExist(firstRow), false, "the replaced scan's bytes go with it");

    // Once it has been cut, the tiles' boxes were drawn over *these* pixels, so replacing it would
    // leave them describing an image that is no longer there.
    await commitCut(userId, second.id, [FRONT_BOXES[0]]);
    const replacement = await card(SHEET_W, SHEET_H, [{ box: FRONT_BOXES[0], colour: RED }]);
    await assert.rejects(
      () =>
        uploadSheet(userId, lotId, {
          bytes: replacement,
          mime: "image/png",
          side: "front",
          batchNo: first.batchNo,
        }),
      ScanValidationError
    );

    await deleteLot(userId, lotId);
  });

  it("refuses a back scan with no front, and gives each front scan its own batch", async () => {
    const lotId = await newLot();
    const orphanBack = await card(400, 400, []);
    await assert.rejects(
      () =>
        uploadSheet(userId, lotId, {
          bytes: orphanBack,
          mime: "image/png",
          side: "back",
          batchNo: 1,
        }),
      ScanValidationError
    );

    const first = await uploadFront(lotId);
    const second = await uploadFront(lotId);
    assert.equal(first.batchNo, 1);
    assert.equal(second.batchNo, 2, "a second card is a second batch, not a replacement");

    await deleteLot(userId, lotId);
  });
});
