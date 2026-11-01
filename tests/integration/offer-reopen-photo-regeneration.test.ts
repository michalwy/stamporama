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
import { addSaleLines, createSale, deleteSale, removeSaleLine } from "../../src/lib/sales";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  purgeClosedOfferPhotos,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// As in the cleanup test: a throwaway directory for the filesystem backend.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-reopen-offer-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// An offer back on sale gets its cleaned-up images made again on its own (#2317):
//
//   - deleting the sale, or taking the set out of it, queues the run Regenerate would queue;
//   - an offer whose images were never cleaned up is left alone;
//   - a run that cannot be queued says why on the card rather than still reading "Cleaned up".

const DAY_MS = 24 * 60 * 60 * 1000;

async function scan(red: number): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 160, channels: 3, background: { r: red, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

describe("cleaned-up images made again when an offer is back on sale (#2317)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let seq = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-reopen-photos-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User reopen-photos-${ts}`,
        email: `test-reopen-photos-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-reopen-photos-${ts}`,
          name: `Collection reopen-photos-${ts}`,
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
      await prisma.platform.create({
        data: { collectionId, name: `Delcampe ${ts}`, maxPhotos: 6, maxPhotoEdge: 900 },
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** Drain this offer's queued run, as the worker would. */
  async function render(offerId: string): Promise<void> {
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
  }

  /**
   * One offer of one scanned copy with its images generated, sold through a sale of its own and —
   * unless `purge` is false — swept once the grace period was up.
   */
  async function soldOffer(purge = true): Promise<{
    offerId: string;
    itemId: string;
    saleId: string;
    lineId: string;
  }> {
    seq += 1;
    const offerId = await createOffer(userId, collectionId, {
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
      data: {
        collectionId,
        name: `Stamp reopen-${seq}-${Date.now()}`,
        primaryCatalogSortKey: catalogSortKeyOf(String(seq)),
      },
    });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const upload = await stageUpload(userId, collectionId, { bytes: await scan(20 + seq), mime: "image/png" });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    const setId = await addOfferSet(userId, offerId, [item.id]);
    await enqueueOfferPhotoGeneration(userId, offerId);
    await render(offerId);
    await prisma.offer.update({ where: { id: offerId }, data: { state: "active" } });

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
    await addSaleLines(userId, saleId, [{ offerId, offerSetId: setId, price: "10.00", itemIds: [item.id] }]);
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId }, select: { id: true } });

    if (purge) {
      const freed = await purgeClosedOfferPhotos(new Date(Date.now() + 8 * DAY_MS), { offerId });
      assert.equal(freed.offers, 1, "the sold offer's images were cleaned up");
      assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "purged");
    }
    return { offerId, itemId: item.id, saleId, lineId: line.id };
  }

  it("deleting the sale queues the images again, and the run makes them", async () => {
    const { offerId, saleId } = await soldOffer();

    const queued = await deleteSale(userId, saleId);
    assert.equal(queued, 1, "the caller is told there is a run to nudge the worker for");
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { state: true } });
    assert.equal(offer.state, "active");
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "queued", "no Regenerate pressed");

    await render(offerId);
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready");
    assert.equal(state.images.length, 1);
  });

  it("taking the set out of the sale does the same, and the offer is no longer closed", async () => {
    const { offerId, lineId } = await soldOffer();

    assert.equal(await removeSaleLine(userId, lineId), 1);
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, closedAt: true },
    });
    assert.equal(offer.state, "active");
    assert.equal(offer.closedAt, null, "an offer open again is out of the purge's reach");
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "queued");

    await render(offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).images.length, 1);
  });

  it("leaves an offer whose images were never cleaned up alone", async () => {
    const { offerId, saleId } = await soldOffer(false);

    assert.equal(await deleteSale(userId, saleId), 0);
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready", "nothing queued: the images are still there");
    assert.equal(state.images.length, 1);
  });

  it("says why on the card when the images cannot be made", async () => {
    const { offerId, itemId, saleId } = await soldOffer();
    // The copy's scan has gone since, so there is nothing to render from.
    await prisma.photo.deleteMany({ where: { itemId } });

    assert.equal(await deleteSale(userId, saleId), 0);
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "failed", "no longer reads as cleaned up");
    assert.match(state.error ?? "", /no scans/);
  });
});
