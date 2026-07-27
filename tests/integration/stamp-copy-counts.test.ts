import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { countCopiesByStamp, NO_COPIES } from "../../src/lib/copy-counts";

// Copy counts behind the stamp badge (#348). The rules worth pinning down are all about *which*
// copies count: per stamp exactly (a variant's copies are not its parent's), sold copies excluded
// so the badge agrees with the View copies popup it sits beside (#207), disposition markers
// counted independently because they overlap, and never across collections.

const ts = Date.now();

describe("stamp copy counts", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let conditionId: string;
  let otherConditionId: string;
  let baseStampId: string;
  let variantStampId: string;
  let soldStampId: string;
  let otherStampId: string;

  before(async () => {
    userId = `test-user-copycount-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User copycount-${ts}`,
        email: `test-copycount-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-copycount-a-${ts}`, name: "A", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-copycount-b-${ts}`, name: "B", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    otherConditionId = (
      await prisma.stampCondition.create({
        data: {
          collectionId: otherCollectionId,
          name: "Used",
          abbreviation: "U",
          sortOrder: 0,
        },
      })
    ).id;

    baseStampId = (await prisma.stamp.create({ data: { collectionId, name: "Base" } })).id;
    variantStampId = (
      await prisma.stamp.create({ data: { collectionId, name: "Variant", parentId: baseStampId } })
    ).id;
    soldStampId = (await prisma.stamp.create({ data: { collectionId, name: "Sold" } })).id;
    otherStampId = (
      await prisma.stamp.create({ data: { collectionId: otherCollectionId, name: "Elsewhere" } })
    ).id;

    // Base: two copies — one in the collection, one both in the collection and for sale.
    await createItem(userId, collectionId, { stampId: baseStampId, conditionId });
    await createItem(userId, collectionId, {
      stampId: baseStampId,
      conditionId,
      forSale: true,
    });
    // Variant: one copy, for trade only.
    await createItem(userId, collectionId, {
      stampId: variantStampId,
      conditionId,
      inCollection: false,
      forTrade: true,
    });
    // Same stamp in another collection — must never leak into this one's counts.
    await createItem(userId, otherCollectionId, {
      stampId: otherStampId,
      conditionId: otherConditionId,
    });

    // Sold stamp: two copies, one of which has left on a sale line.
    const held = await createItem(userId, collectionId, { stampId: soldStampId, conditionId });
    const gone = await createItem(userId, collectionId, { stampId: soldStampId, conditionId });
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    const offer = await prisma.offer.create({
      data: { collectionId, platformId, currency: "EUR", price: "5.00" },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, platformId, soldAt: new Date(), currency: "EUR" },
    });
    const saleLine = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({
      data: { saleLineId: saleLine.id, itemId: gone.id },
    });
    assert.ok(held.id !== gone.id);
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.stamp.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.collection.deleteMany({
      where: { id: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts a stamp's own copies and its disposition markers", async () => {
    const counts = await countCopiesByStamp(collectionId, [baseStampId]);
    assert.deepEqual(counts.get(baseStampId), {
      total: 2,
      // Both copies are in the collection (the default), one of them also for sale — markers
      // overlap by design, so they are counted independently rather than partitioned.
      inCollection: 2,
      forSale: 1,
      forTrade: 0,
    });
  });

  it("does not roll a variant's copies up into its parent", async () => {
    const counts = await countCopiesByStamp(collectionId, [baseStampId, variantStampId]);
    assert.equal(counts.get(baseStampId)?.total, 2);
    assert.deepEqual(counts.get(variantStampId), {
      total: 1,
      inCollection: 0,
      forSale: 0,
      forTrade: 1,
    });
  });

  it("excludes copies that have sold", async () => {
    const counts = await countCopiesByStamp(collectionId, [soldStampId]);
    assert.equal(counts.get(soldStampId)?.total, 1);
  });

  it("omits stamps with no copies, and never counts another collection's", async () => {
    const empty = (await prisma.stamp.create({ data: { collectionId, name: "None" } })).id;
    const counts = await countCopiesByStamp(collectionId, [empty, otherStampId]);
    assert.equal(counts.get(empty), undefined);
    assert.equal(counts.get(otherStampId), undefined);
    assert.equal(counts.get(empty) ?? NO_COPIES, NO_COPIES);
  });

  it("returns an empty map for no stamps", async () => {
    assert.equal((await countCopiesByStamp(collectionId, [])).size, 0);
  });
});
