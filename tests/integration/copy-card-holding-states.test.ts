import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItemsByHoldingState, listItemsPaginated } from "../../src/lib/items";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The Copies card's state chips on a stamp's and an issue's page (#2281): a count per holding state,
// read through the same filters the list is, and a sold row that names its sale.

describe("countItemsByHoldingState and the sale mark (#2281)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let otherStampId: string;
  let platformId: string;
  let nextItemNo = 1;
  let heldId: string;
  let soldId: string;
  let disposedId: string;
  let saleId: string;

  async function addCopy(stamp: string, disposed = false) {
    const item = await prisma.item.create({
      data: {
        collectionId,
        itemNo: nextItemNo++,
        stampId: stamp,
        conditionId,
        deliveryState: "delivered",
        ...(disposed ? { disposedAt: new Date("2026-04-02"), disposalReason: "lost" } : {}),
      },
      select: { id: true },
    });
    return item.id;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-copycard-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User copycard-${ts}`,
        email: `test-copycard-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-copycard-${ts}`, name: `Collection copycard-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Card stamp" } })).id;
    otherStampId = (await prisma.stamp.create({ data: { collectionId, name: "Other stamp" } })).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;

    heldId = await addCopy(stampId);
    soldId = await addCopy(stampId);
    disposedId = await addCopy(stampId, true);
    await addCopy(otherStampId);

    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: 1, platformId, currency: "EUR", price: "1.00" },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: 7, platformId, soldAt: new Date("2026-03-01"), currency: "EUR" },
    });
    saleId = sale.id;
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "1.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId: soldId } });
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts the stamp's copies in each state, whatever the list's defaults", async () => {
    const counts = await countItemsByHoldingState(
      userId,
      collectionId,
      readItemFilters(new URLSearchParams(`stampId=${stampId}`))
    );
    assert.deepEqual(counts, { held: 1, gone: 1, disposed: 1 });
  });

  it("lists exactly the states the chips ask for", async () => {
    const listed = async (states: string) =>
      (
        await listItemsPaginated(
          userId,
          collectionId,
          readItemFilters(new URLSearchParams(`stampId=${stampId}&holdingStates=${states}`))
        )
      ).items
        .map((i) => i.id)
        .sort();
    assert.deepEqual(await listed("held"), [heldId]);
    assert.deepEqual(await listed("gone,disposed"), [soldId, disposedId].sort());
    assert.deepEqual(await listed("held,gone,disposed"), [heldId, soldId, disposedId].sort());
  });

  it("names the sale a sold copy left on", async () => {
    const { items } = await listItemsPaginated(
      userId,
      collectionId,
      readItemFilters(new URLSearchParams(`stampId=${stampId}&holdingStates=gone,held`))
    );
    const sold = items.find((i) => i.id === soldId)!;
    assert.equal(sold.sold, true);
    assert.deepEqual(sold.soldIn, { saleId, saleNo: 7, soldAt: "2026-03-01" });
    assert.equal(items.find((i) => i.id === heldId)!.soldIn, null);
  });
});
