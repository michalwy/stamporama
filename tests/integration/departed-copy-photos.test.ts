import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { setCollectionDepartedCopyPhotoTtl } from "../../src/lib/collections";
import { createItem, disposeItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, cancelSale, createSale } from "../../src/lib/sales";
import { getCopyPhotosReducedAt, reduceDepartedCopyPhotos } from "../../src/lib/departed-copy-photos";
import { REDUCED_MAX_EDGE, THUMB_MAX_EDGE } from "../../src/lib/photos/process";
import { getActiveStorage, permanentPrefix, variantKey } from "../../src/lib/storage";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-departed-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;
delete process.env.STAMPORAMA_DEPARTED_COPY_PHOTO_TTL_DAYS;

// A copy that has left keeps a thumbnail and a reduced photo (#2547). The issue's *Done when*:
//
//   - with the default setting, a copy sold 91 days ago shows a thumbnail and a reduced photo that
//     opens larger, and its full-resolution files are gone;
//   - a copy sold 30 days ago still has its full photos;
//   - with the setting `off`, nothing is reduced;
//   - a copy whose sale was cancelled within the period keeps its full photos.
//
// Plus the other two ways a copy leaves (a trade, a disposal) and a photo whose bytes are shared.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("reducing the photos of a copy that has left (#2547)", () => {
  const TS = Date.now();
  const userId = `test-user-departed-${TS}`;
  let collectionId: string;
  let stampId: string;
  let conditionId: string;
  let platformId: string;

  before(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-departed-${TS}`, name: `Departed ${TS}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })).id;
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A copy with one front photo stored at 2000 × 1500, as an upload would leave it. */
  async function copyWithPhoto(): Promise<{ itemId: string; photoId: string }> {
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    const photoId = `photo-departed-${TS}-${Math.random().toString(36).slice(2)}`;
    const prefix = permanentPrefix(collectionId, photoId);
    const image = sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 180, g: 40, b: 40 } } });
    const full = await image.clone().jpeg().toBuffer();
    const thumb = await image.clone().resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside" }).jpeg().toBuffer();
    const storage = getActiveStorage();
    await storage.put(variantKey(prefix, "full", "image/jpeg"), full, "image/jpeg", "work");
    await storage.put(variantKey(prefix, "thumb", "image/jpeg"), thumb, "image/jpeg", "work");
    await prisma.photo.create({
      data: {
        id: photoId,
        itemId,
        role: "front",
        storageBackend: storage.backend,
        storageKey: prefix,
        mime: "image/jpeg",
        width: 2000,
        height: 1500,
        originalWidth: 4000,
        originalHeight: 3000,
        sizeBytes: full.byteLength,
      },
    });
    return { itemId, photoId };
  }

  /** Sell the copy through an offer, the sale dated `days` ago. */
  async function sell(itemId: string, days: number): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
    });
    const setId = await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: daysAgo(days),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [{ offerId, offerSetId: setId, price: "5.00", itemIds: [itemId] }]);
    return saleId;
  }

  async function exists(key: string, mime = "image/jpeg"): Promise<boolean> {
    try {
      const object = await getActiveStorage().get(key, mime, "delivery");
      object.stream.destroy();
      return true;
    } catch {
      return false;
    }
  }

  async function photoRow(photoId: string) {
    return prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
  }

  it("reduces a copy sold 91 days ago under the default: a thumbnail and a smaller photo, the full one gone", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
    const { itemId, photoId } = await copyWithPhoto();
    const before = await photoRow(photoId);
    await sell(itemId, 91);

    const result = await reduceDepartedCopyPhotos(new Date(), { itemId });
    assert.equal(result.photos, 1);
    assert.equal(result.copies, 1);
    assert.ok(result.bytes > 0, "the full-resolution bytes are freed");

    const after = await photoRow(photoId);
    assert.ok(after.reducedAt, "the photo says when it was reduced");
    assert.equal(Math.max(after.width, after.height), REDUCED_MAX_EDGE);
    assert.ok(after.width > THUMB_MAX_EDGE, "the reduced photo opens larger than the thumbnail");
    assert.equal(after.originalWidth, 4000, "the upload's own size is kept, so measuring still works");
    assert.notEqual(after.storageKey, before.storageKey);
    assert.ok(after.sizeBytes < before.sizeBytes);

    assert.equal(await exists(variantKey(before.storageKey, "full", before.mime)), false, "the full-resolution file is gone");
    assert.equal(await exists(variantKey(before.storageKey, "thumb", before.mime)), false);
    assert.equal(await exists(variantKey(after.storageKey, "full", after.mime)), true);
    assert.equal(await exists(variantKey(after.storageKey, "thumb", after.mime)), true, "the thumbnail stays");
    const stored = await sharp(
      Buffer.concat(
        await (async () => {
          const chunks: Buffer[] = [];
          const object = await getActiveStorage().get(variantKey(after.storageKey, "full", after.mime), after.mime, "delivery");
          for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
          return chunks;
        })()
      )
    ).metadata();
    assert.equal(stored.width, after.width);

    assert.equal(await getCopyPhotosReducedAt(collectionId, itemId), after.reducedAt!.toISOString());

    // Nothing reduced twice: the next pass finds nothing to do.
    const again = await reduceDepartedCopyPhotos(new Date(), { itemId });
    assert.equal(again.photos, 0);
  });

  it("keeps the full photos of a copy sold 30 days ago", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
    const { itemId, photoId } = await copyWithPhoto();
    await sell(itemId, 30);

    const result = await reduceDepartedCopyPhotos(new Date(), { itemId });
    assert.equal(result.photos, 0);
    const row = await photoRow(photoId);
    assert.equal(row.reducedAt, null);
    assert.equal(row.width, 2000);
    assert.equal(await getCopyPhotosReducedAt(collectionId, itemId), null);
  });

  it("reduces nothing with the setting off", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, "off");
    const { itemId, photoId } = await copyWithPhoto();
    await sell(itemId, 400);

    const result = await reduceDepartedCopyPhotos(new Date(), { itemId });
    assert.equal(result.photos, 0);
    assert.equal((await photoRow(photoId)).reducedAt, null);
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
  });

  it("keeps the full photos of a copy whose sale was cancelled within the period", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
    const { itemId, photoId } = await copyWithPhoto();
    const saleId = await sell(itemId, 30);
    await cancelSale(userId, saleId, { reason: "Not paid", offerOutcomes: {} });

    // Long after the period would have ended had the sale stood: the copy is held again.
    const result = await reduceDepartedCopyPhotos(new Date(Date.now() + 200 * DAY_MS), { itemId });
    assert.equal(result.photos, 0);
    assert.equal((await photoRow(photoId)).reducedAt, null);
  });

  it("reduces a copy marked no longer held, counting from the day it was marked", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, "10");
    const { itemId, photoId } = await copyWithPhoto();
    await disposeItem(userId, itemId, { reason: "lost", note: null });

    assert.equal((await reduceDepartedCopyPhotos(new Date(), { itemId })).photos, 0, "inside the period");
    await prisma.item.update({ where: { id: itemId }, data: { disposedAt: daysAgo(11) } });
    assert.equal((await reduceDepartedCopyPhotos(new Date(), { itemId })).photos, 1);
    assert.ok((await photoRow(photoId)).reducedAt);
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
  });

  it("reduces a copy given away in a trade, counting from the trade's closing", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
    const { itemId, photoId } = await copyWithPhoto();
    const partnerId = (await prisma.contact.create({ data: { collectionId, name: `Partner ${TS}` } })).id;
    const trade = await prisma.trade.create({
      data: {
        collectionId,
        tradeNo: 1,
        partnerId,
        currency: "EUR",
        status: "closed",
        closedAt: daysAgo(30),
      },
    });
    const section = await prisma.tradeSection.create({ data: { tradeId: trade.id, name: "Give" } });
    await prisma.tradeLine.create({
      data: { tradeId: trade.id, sectionId: section.id, side: "give", itemId, fulfillment: "fulfilled" },
    });

    assert.equal((await reduceDepartedCopyPhotos(new Date(), { itemId })).photos, 0, "closed 30 days ago");
    await prisma.trade.update({ where: { id: trade.id }, data: { closedAt: daysAgo(91) } });
    assert.equal((await reduceDepartedCopyPhotos(new Date(), { itemId })).photos, 1);
    assert.ok((await photoRow(photoId)).reducedAt);
  });

  it("leaves a photo whose bytes another photo still uses", async () => {
    await setCollectionDepartedCopyPhotoTtl(userId, collectionId, null);
    const { itemId, photoId } = await copyWithPhoto();
    const row = await photoRow(photoId);
    // A second row pointing at the same bytes — here on the stamp, standing for any other user of them.
    await prisma.photo.create({
      data: {
        stampId,
        storageBackend: row.storageBackend,
        storageKey: row.storageKey,
        mime: row.mime,
        width: row.width,
        height: row.height,
        sizeBytes: row.sizeBytes,
      },
    });
    await sell(itemId, 91);

    assert.equal((await reduceDepartedCopyPhotos(new Date(), { itemId })).photos, 0);
    assert.equal((await photoRow(photoId)).reducedAt, null);
    assert.equal(await exists(variantKey(row.storageKey, "full", row.mime)), true);
    await prisma.photo.deleteMany({ where: { stampId } });
  });
});
