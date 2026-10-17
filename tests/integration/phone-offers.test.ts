import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, updateOfferPhotoConfig } from "../../src/lib/offers";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  readOfferUploadPlan,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { getPhoneOffer } from "../../src/lib/phone-offers";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// A throwaway data directory for the photos, as the photo-generation tests do.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-offers-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The phone offer screen's read (#2008). What needs a database is the offer's picture, decided with
// the collector on 2026-10-17: the first listing image once there is one, the first copy's photo
// until then — its copies in set order, the first that has a photo, its front before its back — and
// that the read is the owner's, in the collection it was asked for.

async function scan(red: number): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 160, channels: 3, background: { r: red, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

describe("the phone offer read (#2008)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let offerId: string;
  let frontPhotoId: string;
  let bareItemId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-offers-${ts}`;
    otherUserId = `test-user-phone-offers-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-offers-${ts}`, name: "Phone offers", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-offers-b-${ts}`, name: "Phone offers B", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const platformId = (
      await prisma.platform.create({
        data: { collectionId, name: `Delcampe ${ts}`, maxPhotos: 6, maxPhotoEdge: 900 },
      })
    ).id;

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed" as const,
        collageGridShape: "landscape" as const,
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const stamp = await prisma.stamp.create({
      data: { collectionId, name: `Stamp phone-offers-${ts}`, primaryCatalogSortKey: catalogSortKeyOf("0") },
    });
    // The first copy has no photo; the second has a back filed before its front.
    const bare = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const pictured = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const back = await stageUpload(userId, collectionId, { bytes: await scan(30), mime: "image/png" });
    const front = await stageUpload(userId, collectionId, { bytes: await scan(200), mime: "image/png" });
    await applyPhotoChangeSet(userId, pictured.id, {
      add: [
        { uploadId: back.id, role: "back", title: null, sortOrder: 0 },
        { uploadId: front.id, role: "front", title: null, sortOrder: 1 },
      ],
      update: [],
      remove: [],
    });
    frontPhotoId = (
      await prisma.photo.findFirstOrThrow({ where: { itemId: pictured.id, role: "front" }, select: { id: true } })
    ).id;
    bareItemId = bare.id;
    await addOfferSet(userId, offerId, [bare.id]);
    await addOfferSet(userId, offerId, [pictured.id]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("reads the offer as the desk names and prices it", async () => {
    const offer = await getPhoneOffer(userId, collectionId, offerId);
    assert.ok(offer);
    assert.equal(offer.state, "preparing");
    assert.equal(offer.price, "10.00");
    assert.equal(offer.currency, "EUR");
    assert.ok(offer.title.length > 0, "an offer with no generated title shows its sets' label");
    assert.equal(offer.withdrawTakesPost, false);
  });

  it("shows the first copy's photo with one, front first, while there is no listing image", async () => {
    const offer = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(offer?.photoId, frontPhotoId);
  });

  it("shows the first listing image once the images are generated", async () => {
    // A collage is drawn only when every copy in it has a scan of the side, so the bare copy gets one.
    const scanned = await stageUpload(userId, collectionId, { bytes: await scan(120), mime: "image/png" });
    await applyPhotoChangeSet(userId, bareItemId, {
      add: [{ uploadId: scanned.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const plan = await readOfferUploadPlan(userId, offerId);
    assert.ok(!("reason" in plan), "the run produced images to upload");
    const offer = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(offer?.photoId, plan.images[0].photoId);
    assert.notEqual(offer?.photoId, frontPhotoId);
  });

  it("reads nothing for another owner, or under another collection", async () => {
    assert.equal(await getPhoneOffer(otherUserId, collectionId, offerId), null);
    assert.equal(await getPhoneOffer(userId, otherCollectionId, offerId), null);
  });
});
