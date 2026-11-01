import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";
import {
  addSaleCopySet,
  addSaleLines,
  createSale,
  getSaleDetail,
  moveSaleLines,
  removeSaleLines,
  SaleLinesGoneError,
  soldItemIds,
} from "../../src/lib/sales";

// Removing the ticked sold sets from a sale in one action (#2315), read back out of Prisma: each set
// goes as a single removal takes it — copies sellable again, an offer no longer fully sold back to
// active — the sets left stay, and a set no longer on the sale refuses the whole removal.

describe("removing ticked sold sets from a sale (#2315)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let buyerId: string;

  async function newSale(): Promise<string> {
    return createSale(userId, collectionId, {
      platformId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-10-20"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  }

  const newCopy = async () => (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** A set on no offer, priced, on `saleId`; answers its line id and copy. */
  async function looseSet(saleId: string, price: string): Promise<{ lineId: string; itemId: string }> {
    const itemId = await newCopy();
    await addSaleCopySet(userId, saleId, { itemIds: [itemId], price });
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId, items: { some: { itemId } } } });
    return { lineId: line.id, itemId };
  }

  /** An active offer of two one-copy sets, both sold on `saleId`; answers the offer and its lines. */
  async function offerSoldOut(saleId: string): Promise<{ offerId: string; lineIds: string[]; itemIds: string[] }> {
    const itemIds = [await newCopy(), await newCopy()];
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "30.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    for (const itemId of itemIds) await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const sets = await prisma.offerSet.findMany({ where: { offerId }, include: { items: true } });
    await addSaleLines(
      userId,
      saleId,
      sets.map((set) => ({ offerId, offerSetId: set.id, price: "25.00", itemIds: set.items.map((i) => i.itemId) }))
    );
    const lines = await prisma.saleLine.findMany({ where: { saleId, offerId } });
    return { offerId, lineIds: lines.map((l) => l.id), itemIds };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sale-remove-${ts}`;
    otherUserId = `test-user-sale-remove-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-remove-${ts}`, name: "Remove", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp R" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Ewa Kupująca", buyer: true } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    for (const id of [userId, otherUserId]) {
      await prisma.collection.deleteMany({ where: { ownerId: id } });
      await prisma.user.delete({ where: { id } });
    }
  });

  it("removes every ticked set as a single removal would, and leaves the rest", async () => {
    const saleId = await newSale();
    const offer = await offerSoldOut(saleId);
    const loose = await looseSet(saleId, "15.00");
    const staying = await looseSet(saleId, "20.00");
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.offerId } })).state, "sold");

    const result = await removeSaleLines(userId, saleId, [...offer.lineIds, loose.lineId]);
    assert.equal(result.removed, 3);

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.deepEqual(
      detail.lines.map((l) => l.id),
      [staying.lineId]
    );
    // Copies sellable again; the offer, no longer fully sold, back to active.
    const sold = await soldItemIds([...offer.itemIds, loose.itemId, staying.itemId]);
    assert.deepEqual([...sold], [staying.itemId]);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.offerId } })).state, "active");
  });

  it("removes nothing when a ticked set is no longer on the sale, and names it", async () => {
    const saleId = await newSale();
    const kept = await looseSet(saleId, "10.00");
    const gone = await looseSet(saleId, "12.00");
    const other = await newSale();
    await looseSet(other, "5.00");
    await moveSaleLines(userId, { sourceSaleId: saleId, lineIds: [gone.lineId], target: { saleId: other } });

    await assert.rejects(
      () => removeSaleLines(userId, saleId, [kept.lineId, gone.lineId]),
      (e: unknown) =>
        e instanceof SaleLinesGoneError && e.reason === "cannot-remove" && e.lineIds.join() === gone.lineId
    );
    const lines = await prisma.saleLine.findMany({ where: { saleId }, select: { id: true } });
    assert.deepEqual(
      lines.map((l) => l.id),
      [kept.lineId]
    );
  });

  it("refuses a sale of another collector", async () => {
    const saleId = await newSale();
    const set = await looseSet(saleId, "10.00");
    await assert.rejects(() => removeSaleLines(otherUserId, saleId, [set.lineId]), /not found/);
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 1);
  });
});
