import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale, listSaleCopies, saleCopySetOrder } from "../../src/lib/sales";
import { sortCopiesInSetOrder } from "../../src/lib/order-summary";

// The buyer's order summary (#2512) lists a set's copies in the set's own order: the offer set's
// hand order where the collector gave one, else catalogue order. `saleCopySetOrder` is the read.

describe("a sale's copies in their sets' order (#2512)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-ordersum-${ts}`;
    otherUserId = `test-user-ordersum-other-${ts}`;
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
    const col = await prisma.collection.create({
      data: { slug: `col-ordersum-${ts}`, name: `Collection ordersum-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Colnect" } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function copyOf(sortKey: string): Promise<string> {
    const stampId = (
      await prisma.stamp.create({ data: { collectionId, name: `Stamp ${sortKey}`, primaryCatalogSortKey: sortKey } })
    ).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  async function soldSet(itemIds: string[]): Promise<{ saleId: string; setId: string }> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
    });
    const setId = await addOfferSet(userId, offerId, itemIds);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
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
    await addSaleLines(userId, saleId, [{ offerId, offerSetId: setId, price: "5.00", itemIds }]);
    return { saleId, setId };
  }

  it("orders by catalogue where the set was never hand-ordered", async () => {
    const [c, a, b] = [await copyOf("3"), await copyOf("1"), await copyOf("2")];
    const { saleId } = await soldSet([c, a, b]);
    const sorted = sortCopiesInSetOrder(
      await listSaleCopies(userId, saleId),
      await saleCopySetOrder(userId, saleId)
    );
    assert.deepEqual(
      sorted.map((x) => x.id),
      [a, b, c]
    );
  });

  it("follows the collector's hand order on the offer's set", async () => {
    const [a, b, c] = [await copyOf("1"), await copyOf("2"), await copyOf("3")];
    const { saleId, setId } = await soldSet([a, b, c]);
    for (const [itemId, sortOrder] of [
      [c, 0],
      [a, 1],
      [b, 2],
    ] as const) {
      await prisma.offerSetItem.update({ where: { offerSetId_itemId: { offerSetId: setId, itemId } }, data: { sortOrder } });
    }
    const sorted = sortCopiesInSetOrder(
      await listSaleCopies(userId, saleId),
      await saleCopySetOrder(userId, saleId)
    );
    assert.deepEqual(
      sorted.map((x) => x.id),
      [c, a, b]
    );
  });

  it("refuses another owner's sale", async () => {
    const { saleId } = await soldSet([await copyOf("9")]);
    await assert.rejects(saleCopySetOrder(otherUserId, saleId), /not found or access denied/);
  });
});
