import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  setOfferState,
  updateOfferPhotoConfig,
} from "../../src/lib/offers";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import { attachOfferUpload } from "../../src/lib/offer-photo-attachments";
import { addSaleLines, createSale, deleteSale } from "../../src/lib/sales";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  purgeClosedOfferPhotos,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { getStorage, variantKey } from "../../src/lib/storage";
import { setCollectionClosedOfferPhotoTtl } from "../../src/lib/collections";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// As in the generation test: point the filesystem backend at a throwaway directory rather than the
// repo's `.data`. `dataDir()` reads the env var on every call, so setting it before any test body
// runs is enough.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-closed-offer-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The closed-offer photo purge (#512). The TTL parsing itself is unit-tested; what needs a database
// and a storage backend is the sweep's own contract:
//
//   - a closed offer keeps its images inside the grace period and loses them after it;
//   - only *generated* images go — the copies' scans and an attachment's uploaded original stay;
//   - the plan survives the purge, so Regenerate makes the images again;
//   - the generation row says `purged` rather than reading as never generated;
//   - `closedAt` is stamped by both ways a listing closes, and cleared when a sale is deleted.

const DAY_MS = 24 * 60 * 60 * 1000;

/** One scan's worth of bytes: a solid PNG, distinct per colour so nothing collapses. */
async function scan(red: number): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 160, channels: 3, background: { r: red, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

/** Does the storage backend still hold both variants of this photo? */
async function bytesExist(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<boolean> {
  const storage = getStorage(photo.storageBackend);
  try {
    for (const variant of ["full", "thumb"] as const) {
      await storage.get(variantKey(photo.storageKey, variant, photo.mime), photo.mime, "delivery");
    }
    return true;
  } catch {
    return false;
  }
}

describe("closed-offer photo cleanup (#512)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let offerId: string;
  let setId: string;
  let itemId: string;
  /** The original uploaded straight to the offer for a manual attachment (#313) — never in scope. */
  let uploadedPhotoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-closed-photos-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User closed-photos-${ts}`,
        email: `test-closed-photos-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-closed-photos-${ts}`,
          name: `Collection closed-photos-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `Delcampe ${ts}`,
          platform: true,
          maxPhotos: 6,
          maxPhotoEdge: 900,
        },
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
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const stamp = await prisma.stamp.create({
      data: { collectionId, name: `Stamp closed-photos-${ts}`, primaryCatalogSortKey: catalogSortKeyOf("0") },
    });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    itemId = item.id;
    const scanUpload = await stageUpload(userId, collectionId, {
      bytes: await scan(30),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: scanUpload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    setId = await addOfferSet(userId, offerId, [itemId]);

    // An image of the collector's own, uploaded to the offer: its original is a source, not output.
    const own = await stageUpload(userId, collectionId, {
      bytes: await scan(200),
      mime: "image/png",
    });
    const attachment = await attachOfferUpload(userId, offerId, own.id, "Envelope");
    assert.ok(attachment.photoId, "an uploaded attachment owns its original");
    uploadedPhotoId = attachment.photoId;

    // Render the plan: one collage of the single copy, plus the attachment.
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
    delete process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
  });

  it("leaves an open offer alone, however long it has been sitting there", async () => {
    const generated = await prisma.photo.count({ where: { offerId, kind: "generated" } });
    assert.equal(generated, 2, "one collage plus the rendered attachment");

    const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 365 * DAY_MS), { offerId });
    assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
    assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);
  });

  it("stamps `closedAt` when the listing is withdrawn", async () => {
    await setOfferState(userId, offerId, "withdrawn");
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, closedAt: true },
    });
    assert.equal(offer.state, "withdrawn");
    assert.ok(offer.closedAt, "a closed listing knows when it closed");
  });

  it("keeps the images inside the grace period", async () => {
    const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 6 * DAY_MS), { offerId });
    assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
    assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);
  });

  it("does nothing at all when the purge is switched off", async () => {
    process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = "off";
    try {
      const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 365 * DAY_MS), { offerId });
      assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
      assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);
    } finally {
      delete process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
    }
  });

  it("purges the generated images once the grace period is up, keeping every source", async () => {
    const generated = await prisma.photo.findMany({
      where: { offerId, kind: "generated" },
      select: { id: true, storageBackend: true, storageKey: true, mime: true, sizeBytes: true },
    });
    const totalBytes = generated.reduce((sum, p) => sum + p.sizeBytes, 0);

    const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 8 * DAY_MS), { offerId });
    assert.deepEqual(freed, { offers: 1, photos: 2, bytes: totalBytes });

    assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 0);
    assert.equal(
      await prisma.offerPhotoEntry.count({ where: { offerId } }),
      0,
      "an entry goes with its photo, exactly as a regeneration's swap drops it"
    );
    for (const photo of generated) {
      assert.equal(await bytesExist(photo), false, "the files are gone, not just the rows");
    }

    // The sources are untouched: the copy's own scan, and the original uploaded to the offer.
    const copyScan = await prisma.photo.findFirstOrThrow({
      where: { itemId, role: "front" },
      select: { storageBackend: true, storageKey: true, mime: true },
    });
    assert.equal(await bytesExist(copyScan), true, "a copy's scan is a source, never output");
    const uploaded = await prisma.photo.findUniqueOrThrow({
      where: { id: uploadedPhotoId },
      select: { kind: true, storageBackend: true, storageKey: true, mime: true },
    });
    assert.equal(uploaded.kind, "original");
    assert.equal(await bytesExist(uploaded), true, "the attachment's own upload survives (#313)");
    assert.equal(
      await prisma.offerPhotoAttachment.count({ where: { offerId } }),
      1,
      "the plan structure stays — only the bytes it produced went"
    );
  });

  it("says the images were cleaned up rather than never made", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "purged");
    assert.equal(state.images.length, 0);
    assert.equal(state.outOfDate, false, "there is nothing stored left to be stale");
    assert.equal(state.plan.configured, true, "the plan is intact");
    assert.equal(state.plan.imageCount, 2, "Generate would make the same two images again");
  });

  it("is idempotent — a second pass over the same offer finds nothing", async () => {
    const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 9 * DAY_MS), { offerId });
    assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
  });

  it("regenerates on demand after a purge — a closed listing is not frozen out of its own images", async () => {
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready");
    assert.equal(state.images.length, 2);
  });

  it("skips an offer with a run in flight — those rows are the worker's", async () => {
    await enqueueOfferPhotoGeneration(userId, offerId);
    const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 30 * DAY_MS), { offerId });
    assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
    assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);

    // Drain the queue again so the offer is left in a settled state.
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
  });

  it("stamps `closedAt` on a sale and clears it when the sale is deleted", async () => {
    // A second offer, so the purge cases above keep the one they were written for.
    const soldOfferId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "12.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: `Stamp sold-${Date.now()}`, primaryCatalogSortKey: catalogSortKeyOf("1") },
    });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    const soldSetId = await addOfferSet(userId, soldOfferId, [item.id]);
    await prisma.offer.update({ where: { id: soldOfferId }, data: { state: "active" } });

    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      { offerId: soldOfferId, offerSetId: soldSetId, price: "12.00", itemIds: [item.id] },
    ]);

    const sold = await prisma.offer.findUniqueOrThrow({
      where: { id: soldOfferId },
      select: { state: true, closedAt: true },
    });
    assert.equal(sold.state, "sold");
    assert.ok(sold.closedAt, "the sale is what closed the listing");

    await deleteSale(userId, saleId);
    const reopened = await prisma.offer.findUniqueOrThrow({
      where: { id: soldOfferId },
      select: { state: true, closedAt: true },
    });
    assert.equal(reopened.state, "active");
    assert.equal(reopened.closedAt, null, "an offer that is open again is not waiting to be purged");
  });

  it("leaves the set alone — the purge only ever touches images", async () => {
    assert.equal(await prisma.offerSet.count({ where: { offerId, id: setId } }), 1);
  });

  // Retention per collection (#577). Everything above this point runs with the column unset, which
  // is the case that matters most: an instance that sets the environment variable and touches
  // nothing must behave exactly as it did before the column existed. These cases are what the
  // column adds on top of that.
  describe("resolved per collection (#577)", () => {
    // The offer is withdrawn and holds two freshly generated images by the time these run.
    const wellPast = () => new Date(Date.now() + 365 * DAY_MS);

    after(async () => {
      await setCollectionClosedOfferPhotoTtl(userId, collectionId, null);
      delete process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
    });

    it("passes over a collection that keeps for ever, while the instance would purge at once", async () => {
      process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = "0";
      await setCollectionClosedOfferPhotoTtl(userId, collectionId, "off");

      const freed = await purgeClosedOfferPhotos(wellPast(), { offerId });
      assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
      assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);
    });

    it("inherits the operator's variable again once the collection's answer is cleared", async () => {
      // The instance says keep for ever; the collection has no opinion, so neither does the sweep.
      process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = "off";
      await setCollectionClosedOfferPhotoTtl(userId, collectionId, null);
      assert.equal(
        (
          await prisma.collection.findUniqueOrThrow({
            where: { id: collectionId },
            select: { closedOfferPhotoTtlDays: true },
          })
        ).closedOfferPhotoTtlDays,
        null,
        "clearing stores null — no opinion, not a default"
      );

      const freed = await purgeClosedOfferPhotos(wellPast(), { offerId });
      assert.deepEqual(freed, { offers: 0, photos: 0, bytes: 0 });
      assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 2);
    });

    it("refuses a period that is not in the grammar, rather than storing one nothing can read", async () => {
      await assert.rejects(
        () => setCollectionClosedOfferPhotoTtl(userId, collectionId, "soon"),
        /number of days/
      );
      assert.equal(
        (
          await prisma.collection.findUniqueOrThrow({
            where: { id: collectionId },
            select: { closedOfferPhotoTtlDays: true },
          })
        ).closedOfferPhotoTtlDays,
        null,
        "a rejected value never reached the column"
      );
    });

    it("sweeps on the collection's own period, over an instance that would keep for ever", async () => {
      process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = "off";
      await setCollectionClosedOfferPhotoTtl(userId, collectionId, "7");

      // Inside the collection's own week, nothing goes — the period is the collection's, and it is
      // read as a period rather than as a flag.
      assert.deepEqual(
        await purgeClosedOfferPhotos(new Date(Date.now() + 6 * DAY_MS), { offerId }),
        { offers: 0, photos: 0, bytes: 0 }
      );

      const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 8 * DAY_MS), { offerId });
      assert.equal(freed.offers, 1);
      assert.equal(freed.photos, 2);
      assert.equal(await prisma.photo.count({ where: { offerId, kind: "generated" } }), 0);
    });
  });
});
