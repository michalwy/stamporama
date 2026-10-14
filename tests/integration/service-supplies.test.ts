import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createShippingOption, getShippingOptions, updateShippingOption } from "../../src/lib/shipping-options";
import {
  createCarrier,
  createCarrierService,
  deleteCarrierService,
  getCarriers,
  updateCarrierService,
  CarrierServiceSuppliesError,
} from "../../src/lib/carriers";
import { createSale, getSaleDetail, updateSaleHeader, updateSaleShipping } from "../../src/lib/sales";
import {
  createPackingSupply,
  createPurchaseSupplyLine,
  deletePackingSupply,
  getSuppliesStock,
} from "../../src/lib/packing-supplies";
import { deleteSaleSupplyLine, updateSaleSupplyLine } from "../../src/lib/sale-supplies";

// A carrier service's usual packing supplies (#1899, ADR-0068 §8; on the service since #1909), read
// back out of Prisma: the service's list is saved with it, choosing a shipping option linked to it on
// a sale fills the sale's supply lines in and takes their units from stock, and changing the option
// swaps the lines that still match the old list while keeping the ones changed by hand. The swap rule itself is unit-tested
// (`tests/unit/service-supplies.test.ts`); this covers every write that applies it.

const TS = Date.now();

describe("a carrier service's usual packing supplies", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let envelopeId: string;
  let cardId: string;
  let bubbleId: string;
  let foreignSupplyId: string;
  let carrierId: string;
  let letterServiceId: string;
  let bareServiceId: string;
  // The platform's options, each linked to the service of the same kind.
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

  function header(platform: string, optionId: string | null, shipping = true) {
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
      shipping: shipping ? { optionId, optionName: null, cost: "5.00", currency: "EUR" } : null,
    };
  }

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-service-supplies-${TS}`,
          name: "Test User Service Supplies",
          email: `test-service-supplies-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-service-supplies-${TS}`, name: "Service supplies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-service-supplies-b-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
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

  /** The service's list as the option linked to it reads it. */
  async function optionSupplies(optionId: string) {
    const option = (await getShippingOptions(userId, platformId)).find((o) => o.id === optionId)!;
    return option.service?.supplies ?? [];
  }

  it("saves a service's list with it and reads it back by supply name", async () => {
    await createCarrier(userId, collectionId, { name: "Poczta Polska", trackingUrlTemplate: null });
    carrierId = (await getCarriers(userId, collectionId))[0].id;
    await createCarrierService(userId, carrierId, {
      name: "Registered letter",
      cost: "5.00",
      currency: "EUR",
      supplies: [
        { supplyId: envelopeId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createCarrierService(userId, carrierId, {
      name: "Parcel",
      cost: "9.00",
      currency: "EUR",
      supplies: [
        { supplyId: bubbleId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createCarrierService(userId, carrierId, { name: "Hand delivery", cost: "0.00", currency: "EUR" });
    const services = (await getCarriers(userId, collectionId))[0].services;
    const serviceId = (name: string) => services.find((s) => s.name === name)!.id;
    letterServiceId = serviceId("Registered letter");
    bareServiceId = serviceId("Hand delivery");
    for (const name of ["Registered letter", "Parcel", "Hand delivery"]) {
      await createShippingOption(userId, collectionId, platformId, {
        name,
        price: "6.00",
        currency: "EUR",
        serviceId: serviceId(name),
      });
    }
    const options = await getShippingOptions(userId, platformId);
    letterId = options.find((o) => o.name === "Registered letter")!.id;
    parcelId = options.find((o) => o.name === "Parcel")!.id;
    bareId = options.find((o) => o.name === "Hand delivery")!.id;
    assert.deepEqual(await optionSupplies(letterId), [
      { supplyId: envelopeId, name: "C6 envelope", quantity: 1 },
      { supplyId: cardId, name: "Transport card A6", quantity: 2 },
    ]);
    assert.deepEqual(await optionSupplies(bareId), []);
  });

  it("refuses a supply of another collection, a supply twice, and a quantity below one", async () => {
    const base = { name: "Registered letter", cost: "5.00", currency: "EUR" };
    for (const supplies of [
      [{ supplyId: foreignSupplyId, quantity: 1 }],
      [
        { supplyId: cardId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
      [{ supplyId: cardId, quantity: 0 }],
    ]) {
      await assert.rejects(
        updateCarrierService(userId, letterServiceId, { ...base, supplies }),
        CarrierServiceSuppliesError
      );
    }
    // An update that leaves the list out keeps it.
    await updateCarrierService(userId, letterServiceId, base);
    assert.equal((await optionSupplies(letterId)).length, 2);
  });

  it("fills a sale in with its option's service's list when the sale is recorded, taking the units from stock", async () => {
    const before = await onHand(cardId);
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
    assert.equal(await onHand(cardId), before - 2);
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail!.supplies.lines.length, 2);
  });

  it("fills in nothing for a service with no list, an option with no service, or a one-off", async () => {
    const bare = await createSale(userId, collectionId, header(platformId, bareId));
    assert.deepEqual(await linesOf(bare), []);
    const custom = await createSale(userId, collectionId, {
      ...header(platformId, null),
      shipping: { optionId: null, optionName: "Courier", cost: "7.00", currency: "EUR" },
    });
    assert.deepEqual(await linesOf(custom), []);
    await createShippingOption(userId, collectionId, platformId, {
      name: "Pick-up",
      price: "0.00",
      currency: "EUR",
      serviceId: null,
    });
    const pickUpId = (await getShippingOptions(userId, platformId)).find((o) => o.name === "Pick-up")!.id;
    const unlinked = await createSale(userId, collectionId, header(platformId, pickUpId));
    assert.deepEqual(await linesOf(unlinked), []);
  });

  it("swaps untouched lines on a change of option, keeping the ones changed by hand", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const card = (await linesOf(saleId)).find((l) => l.supply === "card")!;
    await updateSaleSupplyLine(userId, card.id, { supplyId: cardId, quantity: 4 });
    const envelopesBefore = await onHand(envelopeId);

    await updateSaleShipping(userId, saleId, { optionId: parcelId, optionName: null, cost: "9.00", currency: "EUR" });
    // The envelope was the letter's and goes back to stock; the four cards were the collector's and
    // stay, so the parcel's two are not added beside them.
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×4"]);
    assert.equal(await onHand(envelopeId), envelopesBefore + 1);

    // Back to a service with no list: only the parcel's untouched bubble envelope goes.
    await updateSaleShipping(userId, saleId, { optionId: bareId, optionName: null, cost: "0.00", currency: "EUR" });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×4"]);
  });

  it("keeps a line that is the same in both lists rather than giving it back and taking it again", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const card = (await linesOf(saleId)).find((l) => l.supply === "card")!;
    await updateSaleShipping(userId, saleId, { optionId: parcelId, optionName: null, cost: "9.00", currency: "EUR" });
    const after = await linesOf(saleId);
    assert.deepEqual(shape(after), ["bubble×1", "card×2"]);
    assert.ok(after.some((l) => l.id === card.id));
  });

  it("does not bring a removed default back when the same option is saved again", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    const envelope = (await linesOf(saleId)).find((l) => l.supply === "envelope")!;
    await deleteSaleSupplyLine(userId, envelope.id);
    await updateSaleShipping(userId, saleId, { optionId: letterId, optionName: null, cost: "6.00", currency: "EUR" });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2"]);
  });

  it("swaps the lines when the header's form changes the option, and keeps them on a change of platform alone", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    await updateSaleHeader(userId, saleId, header(platformId, parcelId));
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);

    // Moving to another platform without the shipping fields drops the option, not the parcel's supplies.
    await updateSaleHeader(userId, saleId, header(otherPlatformId, null, false));
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { shippingOptionId: true } });
    assert.equal(sale.shippingOptionId, null);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);
  });

  it("leaves sales already recorded alone when a service's list changes", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, letterId));
    await updateCarrierService(userId, letterServiceId, {
      name: "Registered letter",
      cost: "5.00",
      currency: "EUR",
      supplies: [{ supplyId: bubbleId, quantity: 3 }],
    });
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
  });

  it("reads the list through the option's link as it stands, so re-linking an option changes its defaults", async () => {
    await updateShippingOption(userId, bareId, {
      name: "Hand delivery",
      price: "6.00",
      currency: "EUR",
      serviceId: letterServiceId,
    });
    const saleId = await createSale(userId, collectionId, header(platformId, bareId));
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×3"]);
    await updateShippingOption(userId, bareId, {
      name: "Hand delivery",
      price: "6.00",
      currency: "EUR",
      serviceId: bareServiceId,
    });
  });

  it("drops a deleted supply from the lists it was on, and a service's list goes with the service", async () => {
    const tapeId = await createPackingSupply(userId, collectionId, "Tape");
    await updateCarrierService(userId, bareServiceId, {
      name: "Hand delivery",
      cost: "0.00",
      currency: "EUR",
      supplies: [{ supplyId: tapeId, quantity: 1 }],
    });
    await deletePackingSupply(userId, tapeId);
    assert.deepEqual(await optionSupplies(bareId), []);

    await createCarrierService(userId, carrierId, {
      name: "Throwaway",
      cost: "1.00",
      currency: "EUR",
      supplies: [{ supplyId: cardId, quantity: 1 }],
    });
    const throwaway = (await getCarriers(userId, collectionId))[0].services.find((s) => s.name === "Throwaway")!;
    await deleteCarrierService(userId, throwaway.id);
    assert.equal(await prisma.carrierServiceSupply.count({ where: { serviceId: throwaway.id } }), 0);
  });
});
