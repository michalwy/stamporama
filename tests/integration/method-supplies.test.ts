import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createShippingMethod,
  deleteShippingMethod,
  getShippingMethods,
  ShippingMethodSuppliesError,
  updateShippingMethod,
} from "../../src/lib/shipping-methods";
import { createSale, getSaleDetail, updateSaleHeader, updateSaleShipping } from "../../src/lib/sales";
import {
  createPackingSupply,
  createPurchaseSupplyLine,
  deletePackingSupply,
  getSuppliesStock,
} from "../../src/lib/packing-supplies";
import { deleteSaleSupplyLine, updateSaleSupplyLine } from "../../src/lib/sale-supplies";

// A shipping method's usual packing supplies (#1899, ADR-0068 §8), read back out of Prisma: the
// method's list is saved with it, choosing the method on a sale fills the sale's supply lines in and
// takes their units from stock, and changing it swaps the lines that still match the old list while
// keeping the ones changed by hand. The swap rule itself is unit-tested
// (`tests/unit/method-supplies.test.ts`); this covers every write that applies it.

const TS = Date.now();

describe("a shipping method's usual packing supplies", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let envelopeId: string;
  let cardId: string;
  let bubbleId: string;
  let foreignSupplyId: string;
  let letterId: string;
  let parcelId: string;
  let bareId: string;

  async function linesOf(saleId: string): Promise<{ id: string; supply: string; quantity: number }[]> {
    const rows = await prisma.saleSupplyLine.findMany({
      where: { saleId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, supplyId: true, quantity: true },
    });
    const names = new Map([
      [envelopeId, "envelope"],
      [cardId, "card"],
      [bubbleId, "bubble"],
    ]);
    return rows.map((r) => ({ id: r.id, supply: names.get(r.supplyId)!, quantity: r.quantity }));
  }

  const shape = (rows: { supply: string; quantity: number }[]) =>
    rows.map((r) => `${r.supply}×${r.quantity}`).sort();

  async function onHand(supplyId: string): Promise<number> {
    const stock = await getSuppliesStock(userId, collectionId);
    return stock.supplies.find((s) => s.id === supplyId)!.onHand;
  }

  function header(platform: string, methodId: string | null, shipping = true) {
    return {
      platformId: platform,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-03-01"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
      shipping: shipping ? { methodId, methodName: null, cost: "5.00", currency: "EUR" } : null,
    };
  }

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-method-supplies-${TS}`,
          name: "Test User Method Supplies",
          email: `test-method-supplies-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-method-supplies-${TS}`, name: "Method supplies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-method-supplies-b-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    envelopeId = await createPackingSupply(userId, collectionId, "C6 envelope");
    cardId = await createPackingSupply(userId, collectionId, "Transport card A6");
    bubbleId = await createPackingSupply(userId, collectionId, "Bubble envelope");
    foreignSupplyId = await createPackingSupply(userId, otherCollectionId, "Someone else's");

    // Ten of each on hand, so every take in here is covered.
    const purchaseId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: 9100, purchasedAt: new Date("2026-01-01"), currency: "EUR" },
      })
    ).id;
    for (const supplyId of [envelopeId, cardId, bubbleId]) {
      await createPurchaseSupplyLine(userId, purchaseId, { supplyId, quantity: 10, price: 1 });
    }
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("saves a method's list with it and reads it back by supply name", async () => {
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Registered letter",
      cost: "5.00",
      currency: "EUR",
      carrierId: null,
      supplies: [
        { supplyId: envelopeId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Parcel",
      cost: "9.00",
      currency: "EUR",
      carrierId: null,
      supplies: [
        { supplyId: bubbleId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Hand delivery",
      cost: "0.00",
      currency: "EUR",
      carrierId: null,
    });
    const methods = await getShippingMethods(userId, platformId);
    letterId = methods.find((m) => m.name === "Registered letter")!.id;
    parcelId = methods.find((m) => m.name === "Parcel")!.id;
    bareId = methods.find((m) => m.name === "Hand delivery")!.id;
    assert.deepEqual(methods.find((m) => m.id === letterId)!.supplies, [
      { supplyId: envelopeId, name: "C6 envelope", quantity: 1 },
      { supplyId: cardId, name: "Transport card A6", quantity: 2 },
    ]);
    assert.deepEqual(methods.find((m) => m.id === bareId)!.supplies, []);
  });

  it("refuses a supply of another collection, a supply twice, and a quantity below one", async () => {
    const base = { name: "Registered letter", cost: "5.00", currency: "EUR", carrierId: null };
    for (const supplies of [
      [{ supplyId: foreignSupplyId, quantity: 1 }],
      [
        { supplyId: cardId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
      [{ supplyId: cardId, quantity: 0 }],
    ]) {
      await assert.rejects(updateShippingMethod(userId, letterId, { ...base, supplies }), ShippingMethodSuppliesError);
    }
    // An update that leaves the list out keeps it.
    await updateShippingMethod(userId, letterId, base);
    const letter = (await getShippingMethods(userId, platformId)).find((m) => m.id === letterId)!;
    assert.equal(letter.supplies.length, 2);
  });

  it("fills a sale in with its method's list when the sale is recorded, taking the units from stock", async () => {
    const before = await onHand(cardId);
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
    assert.equal(await onHand(cardId), before - 2);
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail!.supplies.lines.length, 2);
  });

  it("fills in nothing for a method with no list, or a one-off method", async () => {
    const bare = await createSale(userId, collectionId, header(platformId, bareId));
    assert.deepEqual(await linesOf(bare), []);
    const custom = await createSale(userId, collectionId, {
      ...header(platformId, null),
      shipping: { methodId: null, methodName: "Courier", cost: "7.00", currency: "EUR" },
    });
    assert.deepEqual(await linesOf(custom), []);
  });

  it("swaps untouched lines on a change of method, keeping the ones changed by hand", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const card = (await linesOf(saleId)).find((l) => l.supply === "card")!;
    await updateSaleSupplyLine(userId, card.id, { supplyId: cardId, quantity: 4 });
    const envelopesBefore = await onHand(envelopeId);

    await updateSaleShipping(userId, saleId, { methodId: parcelId, methodName: null, cost: "9.00", currency: "EUR" });
    // The envelope was the letter's and goes back to stock; the four cards were the collector's and
    // stay, so the parcel's two are not added beside them.
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×4"]);
    assert.equal(await onHand(envelopeId), envelopesBefore + 1);

    // Back to a method with no list: only the parcel's untouched bubble envelope goes.
    await updateSaleShipping(userId, saleId, { methodId: bareId, methodName: null, cost: "0.00", currency: "EUR" });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×4"]);
  });

  it("keeps a line that is the same in both lists rather than giving it back and taking it again", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const card = (await linesOf(saleId)).find((l) => l.supply === "card")!;
    await updateSaleShipping(userId, saleId, { methodId: parcelId, methodName: null, cost: "9.00", currency: "EUR" });
    const after = await linesOf(saleId);
    assert.deepEqual(shape(after), ["bubble×1", "card×2"]);
    assert.ok(after.some((l) => l.id === card.id));
  });

  it("does not bring a removed default back when the same method is saved again", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const envelope = (await linesOf(saleId)).find((l) => l.supply === "envelope")!;
    await deleteSaleSupplyLine(userId, envelope.id);
    await updateSaleShipping(userId, saleId, { methodId: letterId, methodName: null, cost: "6.00", currency: "EUR" });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2"]);
  });

  it("swaps the lines when the header's form changes the method, and keeps them on a change of platform alone", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    await updateSaleHeader(userId, saleId, header(platformId, parcelId));
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);

    // Moving to another platform without the shipping fields drops the method, not the parcel's supplies.
    await updateSaleHeader(userId, saleId, header(otherPlatformId, null, false));
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { shippingMethodId: true } });
    assert.equal(sale.shippingMethodId, null);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);
  });

  it("leaves sales already recorded alone when a method's list changes", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    await updateShippingMethod(userId, letterId, {
      name: "Registered letter",
      cost: "5.00",
      currency: "EUR",
      carrierId: null,
      supplies: [{ supplyId: bubbleId, quantity: 3 }],
    });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
  });

  it("drops a deleted supply from the lists it was on, and a method's list goes with the method", async () => {
    const tapeId = await createPackingSupply(userId, collectionId, "Tape");
    await updateShippingMethod(userId, bareId, {
      name: "Hand delivery",
      cost: "0.00",
      currency: "EUR",
      carrierId: null,
      supplies: [{ supplyId: tapeId, quantity: 1 }],
    });
    await deletePackingSupply(userId, tapeId);
    const bare = (await getShippingMethods(userId, platformId)).find((m) => m.id === bareId)!;
    assert.deepEqual(bare.supplies, []);

    await createShippingMethod(userId, collectionId, otherPlatformId, {
      name: "Throwaway",
      cost: "1.00",
      currency: "EUR",
      carrierId: null,
      supplies: [{ supplyId: cardId, quantity: 1 }],
    });
    const throwaway = (await getShippingMethods(userId, otherPlatformId)).find((m) => m.name === "Throwaway")!;
    await deleteShippingMethod(userId, throwaway.id);
    assert.equal(await prisma.shippingMethodSupply.count({ where: { methodId: throwaway.id } }), 0);
  });
});
