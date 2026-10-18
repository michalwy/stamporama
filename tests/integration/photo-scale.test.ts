import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { applyPhotoChangeSet, PhotoValidationError, stageUpload } from "../../src/lib/photos";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";
import {
  countUnscaledCopyPhotos,
  giveUnscaledCopyPhotosScale,
  PhotoScaleError,
  readCopyPhotoScales,
  setCopyPhotoScales,
} from "../../src/lib/photo-scales";
import { makeCopiesCollage, type CopiesCollageRequest } from "../../src/lib/copies-collage";
import { deleteScanningProfile, ScanningProfileError } from "../../src/lib/scanning-profiles";
import { commitCut, uploadSheet } from "../../src/lib/scan-sheets";
import type { PhotoScaleInput } from "../../src/lib/photo-scale";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-photo-scale-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A copy photo's scale (#2061): what it was scanned with, written when it is added, afterwards one
// copy at a time and in bulk to the photos with none — and an offer collage drawing every stamp at
// one scale once each photo on the image says what it measures. The arithmetic is unit-tested in
// `photo-scale.test.ts` and `collage-layout.test.ts`; here is the wiring.

/** A flat square standing in for one stamp: the same 25.4 mm stamp at any resolution is `dpi` px. */
async function stamp(px: number): Promise<Buffer> {
  return sharp({ create: { width: px, height: px, channels: 3, background: { r: 40, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

describe("a copy photo's scale (#2061)", () => {
  let userId: string;
  let collectionId: string;
  let otherProfileId: string;
  let fine: string;
  let coarse: string;
  let platformId: string;
  let conditionId: string;
  const itemIds: string[] = [];

  async function newCopy(index: number): Promise<string> {
    const stampRow = await prisma.stamp.create({
      data: { collectionId, name: `Stamp ${index}`, primaryCatalogSortKey: catalogSortKeyOf(String(index + 1)) },
    });
    return (await createItem(userId, collectionId, { stampId: stampRow.id, conditionId, forSale: true })).id;
  }

  async function addFront(itemId: string, px: number, scale?: PhotoScaleInput): Promise<string> {
    const upload = await stageUpload(userId, collectionId, { bytes: await stamp(px), mime: "image/png" });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0, ...(scale ? { scale } : {}) }],
      update: [],
      remove: [],
    });
    return (await prisma.photo.findFirstOrThrow({ where: { itemId, role: "front" } })).id;
  }

  function collage(ids: string[]): CopiesCollageRequest {
    return {
      itemIds: ids,
      platformId,
      packaging: "one-set",
      config: {
        photoSides: "front",
        preferSingles: false,
        photoLabelLeftTemplate: null,
        photoLabelRightTemplate: null,
        collage: {
          collageGridMode: "fixed",
          collageGridShape: "landscape",
          collageRows: 1,
          collageColumns: 3,
          collageGapPercent: 0,
          collageBackground: "#ffffff",
          collageLabelPercent: 0,
        },
      },
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-scale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User photo-scale-${ts}`,
        email: `test-photo-scale-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-photo-scale-${ts}`, name: `Scale ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    fine = (await prisma.scanningProfile.create({ data: { collectionId, name: "Epson", nominalDpi: 1200 } })).id;
    coarse = (await prisma.scanningProfile.create({ data: { collectionId, name: "Canon", nominalDpi: 600 } })).id;
    await prisma.collection.update({ where: { id: collectionId }, data: { defaultScanningProfileId: fine } });

    const other = await prisma.collection.create({
      data: { slug: `col-photo-scale-o-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
    });
    otherProfileId = (
      await prisma.scanningProfile.create({ data: { collectionId: other.id, name: "Theirs", nominalDpi: 1200 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: `Facebook ${ts}` } })).id;
    for (let i = 0; i < 3; i += 1) itemIds.push(await newCopy(i));
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("writes the scale a photo is added with, and refuses one that is not this collection's", async () => {
    const photoId = await addFront(itemIds[0], 1200, { kind: "profile", profileId: fine });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(row.scanningProfileId, fine);
    assert.equal(row.scanDpi, null);

    const upload = await stageUpload(userId, collectionId, { bytes: await stamp(100), mime: "image/png" });
    for (const scale of [{ kind: "profile", profileId: otherProfileId }, { kind: "typed", dpi: 1 }]) {
      await assert.rejects(
        applyPhotoChangeSet(userId, itemIds[1], {
          add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0, scale }],
          update: [],
          remove: [],
        }),
        PhotoValidationError
      );
    }
  });

  it("reads and sets a copy's photo scales one at a time, its own photos only", async () => {
    const photoId = await addFront(itemIds[1], 600, { kind: "typed", dpi: 600 });
    const read = await readCopyPhotoScales(userId, itemIds[1]);
    assert.deepEqual(
      read.photos.map((p) => [p.photoId, p.scale, p.reckonable]),
      [[photoId, { kind: "typed", dpi: 600 }, true]]
    );
    assert.equal(read.scanning.profiles.length, 2);

    await setCopyPhotoScales(userId, itemIds[1], [{ photoId, scale: { kind: "profile", profileId: coarse } }]);
    assert.equal((await prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).scanningProfileId, coarse);

    const theirs = (await readCopyPhotoScales(userId, itemIds[0])).photos[0].photoId;
    await assert.rejects(
      setCopyPhotoScales(userId, itemIds[1], [{ photoId: theirs, scale: { kind: "none" } }]),
      PhotoScaleError
    );
  });

  it("draws photos of different resolutions at one scale, and as before while one has none", async () => {
    // The same stamp at 1200 dpi (1200 px) and 600 dpi (600 px): equal on paper, so one scale draws
    // them 600 px each, side by side.
    const scaled = await makeCopiesCollage(userId, collectionId, collage([itemIds[0], itemIds[1]]));
    assert.equal(scaled.unscaledPhotoCount, 0);
    assert.deepEqual([scaled.images[0].width, scaled.images[0].height], [1200, 600]);

    // A third photo with no scale: drawn by its pixels, the others with it, and named.
    await addFront(itemIds[2], 300);
    const mixed = await makeCopiesCollage(userId, collectionId, collage(itemIds));
    assert.equal(mixed.unscaledPhotoCount, 1);
    assert.deepEqual([mixed.images[0].width, mixed.images[0].height], [1200 + 600 + 300, 1200]);
  });

  it("gives the ticked copies' photos with no scale one in bulk, and leaves the rest alone", async () => {
    assert.equal(await countUnscaledCopyPhotos(userId, collectionId, itemIds), 1);
    await assert.rejects(
      giveUnscaledCopyPhotosScale(userId, collectionId, itemIds, { kind: "none" }),
      PhotoScaleError
    );
    assert.equal(
      await giveUnscaledCopyPhotosScale(userId, collectionId, itemIds, { kind: "typed", dpi: 300 }),
      1
    );
    const rows = await prisma.photo.findMany({ where: { itemId: { in: itemIds } }, orderBy: { width: "desc" } });
    assert.deepEqual(
      rows.map((r) => [r.scanningProfileId, r.scanDpi]),
      [
        [fine, null],
        [coarse, null],
        [null, 300],
      ]
    );
    assert.equal(await countUnscaledCopyPhotos(userId, collectionId, itemIds), 0);

    const all = await makeCopiesCollage(userId, collectionId, collage(itemIds));
    assert.equal(all.unscaledPhotoCount, 0);
    assert.deepEqual([all.images[0].width, all.images[0].height], [900, 300]);
  });

  it("refuses to delete a profile a photo was scanned with", async () => {
    await assert.rejects(deleteScanningProfile(userId, coarse), (err: unknown) => {
      assert.ok(err instanceof ScanningProfileError);
      assert.match(err.message, /1 photo was scanned with it/);
      return true;
    });
  });

  it("gives a tile cut from a card its card's profile, or the default for a card with none", async () => {
    const purchase = await prisma.purchase.create({
      data: { collectionId, purchaseNo: 1, purchasedAt: new Date("2026-10-01"), currency: "EUR", lots: { create: { price: 1 } } },
    });
    const card = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#ffffff" } })
      .composite([{ input: await stamp(200), left: 100, top: 100 }])
      .png()
      .toBuffer();
    const box = [{ x: 100, y: 100, w: 200, h: 200 }];

    const withProfile = await uploadSheet(
      userId,
      { purchaseId: purchase.id },
      { source: card, mime: "image/png", side: "front", scanningProfileId: coarse }
    );
    await commitCut(userId, withProfile.id, box);
    const tilePhoto = await prisma.photo.findFirstOrThrow({ where: { scanSheetId: withProfile.id } });
    assert.equal(tilePhoto.scanningProfileId, coarse);

    // A card from before profiles says nothing; its tiles take the collection's default.
    const bare = await uploadSheet(userId, { purchaseId: purchase.id }, { source: card, mime: "image/png", side: "front" });
    await prisma.scanSheet.update({ where: { id: bare.id }, data: { scanningProfileId: null } });
    await commitCut(userId, bare.id, box);
    const bareTile = await prisma.photo.findFirstOrThrow({ where: { scanSheetId: bare.id } });
    assert.equal(bareTile.scanningProfileId, fine);
  });
});
