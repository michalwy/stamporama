import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { createCarrier, createCarrierService, getCarriers } from "../../src/lib/carriers";
import { createShippingOption, getShippingOptions } from "../../src/lib/shipping-options";
import {
  addSaleLines,
  createSale,
  getSaleDetail,
  listSalesAwaitingFulfilment,
  markSaleCopiesPacked,
  setSaleStatus,
  updateSaleShipment,
} from "../../src/lib/sales";
import { phoneSaleGroups } from "../../src/lib/phone-sales-rules";

// The phone's sales to do (#2007): the Dashboard's waiting sales, each carrying what its next step
// asks about — the parcel in force and the unpacked copies — read as the sale screen reads them, and
// moved through the desk's own writes so the status history is the desk's.

describe("the phone's sales to do (#2007)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let postId: string;
  let courierId: string;
  let letterOptionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phonesales-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User Phone Sales",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phonesales-${ts}`, name: "Phone sales", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro", platformCurrency: "PLN" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp P" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    await createCarrier(userId, collectionId, { name: "Poczta Polska", trackingUrlTemplate: null });
    await createCarrier(userId, collectionId, { name: "InPost", trackingUrlTemplate: null });
    const carriers = await getCarriers(userId, collectionId);
    postId = carriers.find((c) => c.name === "Poczta Polska")!.id;
    courierId = carriers.find((c) => c.name === "InPost")!.id;
    await createCarrierService(userId, postId, { name: "Registered letter", cost: "9.50", currency: "PLN" });
    const letterServiceId = (await getCarriers(userId, collectionId))
      .flatMap((c) => c.services)
      .find((s) => s.name === "Registered letter")!.id;
    await createShippingOption(userId, collectionId, platformId, {
      name: "Letter",
      price: "12.00",
      currency: "PLN",
      serviceId: letterServiceId,
    });
    letterOptionId = (await getShippingOptions(userId, platformId)).find((o) => o.name === "Letter")!.id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A sale by the Letter option carrying `n` sold copies, none of them packed. */
  async function saleWithCopies(n: number): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    const setIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
      setIds.push(await addOfferSet(userId, offerId, [itemId]));
    }
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
      shipping: { optionId: letterOptionId, optionName: null, cost: "9.50", currency: "PLN" },
    });
    for (const setId of setIds) {
      const items = await prisma.offerSetItem.findMany({ where: { offerSetId: setId }, select: { itemId: true } });
      await addSaleLines(userId, saleId, [
        { offerId, offerSetId: setId, price: "5.00", itemIds: items.map((r) => r.itemId) },
      ]);
    }
    return saleId;
  }

  const toDo = async (saleId: string) =>
    (await listSalesAwaitingFulfilment(userId, collectionId)).find((s) => s.id === saleId);

  it("reads the parcel and the unpacked copies as the sale screen does", async () => {
    const saleId = await saleWithCopies(2);
    const row = (await toDo(saleId))!;
    const detail = (await getSaleDetail(userId, saleId))!;

    assert.equal(row.status, "ordered");
    // The default carrier is the Letter option's service's — the sale recorded none.
    assert.equal(row.carrierId, postId);
    assert.equal(row.carrierId, detail.carrierId);
    assert.equal(row.goingBy, "Letter");
    assert.equal(row.trackingCode, null);
    assert.equal(row.unpackedItemCount, 2);
    assert.equal(row.unpackedItemCount, detail.unpackedItemCount);

    await markSaleCopiesPacked(userId, saleId);
    assert.equal((await toDo(saleId))!.unpackedItemCount, 0);
  });

  it("moves a sale paid, packed and sent through the desk's writes, with the desk's history", async () => {
    const saleId = await saleWithCopies(1);
    await setSaleStatus(userId, saleId, "paid");
    let groups = phoneSaleGroups(await listSalesAwaitingFulfilment(userId, collectionId));
    assert.ok(groups.find((g) => g.status === "paid")!.sales.some((s) => s.id === saleId));

    await markSaleCopiesPacked(userId, saleId);
    await setSaleStatus(userId, saleId, "packed");
    groups = phoneSaleGroups(await listSalesAwaitingFulfilment(userId, collectionId));
    assert.ok(groups.find((g) => g.status === "packed")!.sales.some((s) => s.id === saleId));

    // *Mark sent* with the parcel gone by another carrier than the default, as the desk saves it.
    await updateSaleShipment(userId, saleId, { carrierId: courierId, trackingCode: "PL123" });
    const before = (await toDo(saleId))!;
    assert.equal(before.carrierId, courierId);
    assert.equal(before.trackingCode, "PL123");
    await setSaleStatus(userId, saleId, "sent");

    // Sent is done: gone from the phone's list, as from the Dashboard's.
    assert.equal(await toDo(saleId), undefined);
    // One event per move, as at the desk. Compared as a set: two moves can share an instant.
    const events = await prisma.saleStatusEvent.findMany({ where: { saleId }, select: { status: true } });
    assert.deepEqual(events.map((e) => e.status).sort(), ["ordered", "packed", "paid", "sent"]);
  });
});
