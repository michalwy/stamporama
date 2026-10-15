import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createCarrier,
  createCarrierService,
  deleteCarrierService,
  getCarriers,
  CarrierServiceInUseError,
} from "../../src/lib/carriers";
import { createShippingOption, getShippingOptions } from "../../src/lib/shipping-options";
import {
  createSale,
  getSaleDetail,
  updateSaleHeader,
  updateSaleShipment,
  updateSaleShipping,
  type SaleShippingInput,
} from "../../src/lib/sales";
import { createPackingSupply, createPurchaseSupplyLine } from "../../src/lib/packing-supplies";
import { updateSaleSupplyLine } from "../../src/lib/sale-supplies";

// *Sent as* (#1923): the carrier service a parcel was actually sent with, recorded beside the buyer's
// shipping option. Null reads as the option's linked service; naming another one moves the default
// supplies and the tracking carrier to it, and leaves the option the buyer chose as it was.

const TS = Date.now();

describe("a sale's Sent as", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let envelopeId: string;
  let cardId: string;
  let bubbleId: string;
  let postId: string;
  let courierId: string;
  let letterServiceId: string;
  let parcelServiceId: string;
  let courierServiceId: string;
  let foreignServiceId: string;
  let letterOptionId: string;
  let pickUpOptionId: string;

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

  function shipping(optionId: string | null, extra: Partial<SaleShippingInput> = {}): SaleShippingInput {
    return { optionId, optionName: optionId ? null : "Courier", cost: "5.00", currency: "PLN", ...extra };
  }

  function header(platform: string, ship: SaleShippingInput | null) {
    return {
      platformId: platform,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-03-01"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
      shipping: ship,
    };
  }

  async function stored(saleId: string) {
    return prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { shippingOptionId: true, shippingOptionName: true, sentAsServiceId: true, carrierId: true },
    });
  }

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-sent-as-${TS}`,
          name: "Test User Sent As",
          email: `test-sent-as-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sent-as-${TS}`, name: "Sent as", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-sent-as-b-${TS}`, name: "Other", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    envelopeId = await createPackingSupply(userId, collectionId, "C6 envelope");
    cardId = await createPackingSupply(userId, collectionId, "Transport card A6");
    bubbleId = await createPackingSupply(userId, collectionId, "Bubble envelope");
    const purchaseId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: 9200, purchasedAt: new Date("2026-01-01"), currency: "PLN" },
      })
    ).id;
    for (const supplyId of [envelopeId, cardId, bubbleId]) {
      await createPurchaseSupplyLine(userId, purchaseId, { supplyId, quantity: 50, price: 1 });
    }

    await createCarrier(userId, collectionId, { name: "Poczta Polska", trackingUrlTemplate: null });
    await createCarrier(userId, collectionId, { name: "InPost", trackingUrlTemplate: null });
    await createCarrier(userId, otherCollectionId, { name: "Elsewhere", trackingUrlTemplate: null });
    const carriers = await getCarriers(userId, collectionId);
    postId = carriers.find((c) => c.name === "Poczta Polska")!.id;
    courierId = carriers.find((c) => c.name === "InPost")!.id;
    await createCarrierService(userId, postId, {
      name: "Registered letter",
      cost: "9.50",
      currency: "PLN",
      supplies: [
        { supplyId: envelopeId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createCarrierService(userId, postId, {
      name: "Parcel",
      cost: "16.00",
      currency: "PLN",
      supplies: [
        { supplyId: bubbleId, quantity: 1 },
        { supplyId: cardId, quantity: 2 },
      ],
    });
    await createCarrierService(userId, courierId, { name: "Locker", cost: "13.00", currency: "PLN" });
    const services = (await getCarriers(userId, collectionId)).flatMap((c) => c.services);
    letterServiceId = services.find((s) => s.name === "Registered letter")!.id;
    parcelServiceId = services.find((s) => s.name === "Parcel")!.id;
    courierServiceId = services.find((s) => s.name === "Locker")!.id;
    const elsewhere = (await getCarriers(userId, otherCollectionId))[0].id;
    await createCarrierService(userId, elsewhere, { name: "Theirs", cost: "1.00", currency: "PLN" });
    foreignServiceId = (await getCarriers(userId, otherCollectionId))[0].services[0].id;

    await createShippingOption(userId, collectionId, platformId, {
      name: "Letter",
      price: "12.00",
      currency: "PLN",
      serviceId: letterServiceId,
    });
    await createShippingOption(userId, collectionId, platformId, {
      name: "Pick-up",
      price: "0.00",
      currency: "PLN",
      serviceId: null,
    });
    const options = await getShippingOptions(userId, platformId);
    letterOptionId = options.find((o) => o.name === "Letter")!.id;
    pickUpOptionId = options.find((o) => o.name === "Pick-up")!.id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("reads a sale that never said as sent by its option's service, and keeps it quiet", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    assert.equal((await stored(saleId)).sentAsServiceId, null);
    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.sentAsServiceId, null);
    assert.deepEqual(detail.sentAs, {
      serviceId: letterServiceId,
      serviceName: "Registered letter",
      carrierName: "Poczta Polska",
    });
    assert.equal(detail.sentAsDiffers, false);
    assert.equal(detail.carrierId, postId);
  });

  it("moves the supplies and the default carrier to another carrier's service, and leaves the buyer's option alone", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    const card = (await linesOf(saleId)).find((l) => l.supply === "card")!;
    await updateSaleSupplyLine(userId, card.id, { supplyId: cardId, quantity: 3 });

    await updateSaleShipping(userId, saleId, shipping(letterOptionId, { cost: "13.00", sentAsServiceId: courierServiceId }));
    const row = await stored(saleId);
    assert.equal(row.shippingOptionId, letterOptionId);
    assert.equal(row.shippingOptionName, "Letter");
    assert.equal(row.sentAsServiceId, courierServiceId);
    // The letter's envelope was its default and goes; the three cards were the collector's and stay.
    assert.deepEqual(shape(await linesOf(saleId)), ["card×3"]);
    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.sentAsDiffers, true);
    assert.equal(detail.sentAs?.serviceName, "Locker");
    assert.equal(detail.carrierId, courierId);
    assert.equal(detail.shippingCost, "13.00");
  });

  it("stores the option's own service as null, so the sale goes on following its option", async () => {
    const saleId = await createSale(
      userId,
      collectionId,
      header(platformId, shipping(letterOptionId, { sentAsServiceId: parcelServiceId }))
    );
    assert.equal((await stored(saleId)).sentAsServiceId, parcelServiceId);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);

    await updateSaleShipping(userId, saleId, shipping(letterOptionId, { sentAsServiceId: letterServiceId }));
    assert.equal((await stored(saleId)).sentAsServiceId, null);
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
    assert.equal((await getSaleDetail(userId, saleId))!.sentAsDiffers, false);
  });

  it("keeps Sent as when a write leaves it out, and a new option then swaps nothing", async () => {
    const saleId = await createSale(
      userId,
      collectionId,
      header(platformId, shipping(letterOptionId, { sentAsServiceId: parcelServiceId }))
    );
    await updateSaleShipping(userId, saleId, shipping(pickUpOptionId));
    assert.equal((await stored(saleId)).sentAsServiceId, parcelServiceId);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);
  });

  it("names any service on a one-off option, and none keeps typed postage only", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(null, { cost: "7.00" })));
    assert.equal((await getSaleDetail(userId, saleId))!.sentAs, null);
    assert.deepEqual(await linesOf(saleId), []);
    await updateSaleShipping(userId, saleId, shipping(null, { cost: "16.00", sentAsServiceId: parcelServiceId }));
    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.sentAs?.serviceName, "Parcel");
    assert.equal(detail.sentAsDiffers, true);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);
  });

  it("moves a recorded carrier that was the old service's, and keeps one chosen by hand", async () => {
    const followed = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    await updateSaleShipment(userId, followed, { carrierId: postId, trackingCode: "RR123" });
    await updateSaleShipping(userId, followed, shipping(letterOptionId, { sentAsServiceId: courierServiceId }));
    assert.equal((await stored(followed)).carrierId, courierId);

    const chosen = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    await updateSaleShipment(userId, chosen, { carrierId: courierId, trackingCode: "X1" });
    await updateSaleShipping(userId, chosen, shipping(letterOptionId, { sentAsServiceId: parcelServiceId }));
    assert.equal((await stored(chosen)).carrierId, courierId);
  });

  it("changes Sent as from the header form too", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    await updateSaleHeader(
      userId,
      saleId,
      header(platformId, shipping(letterOptionId, { sentAsServiceId: parcelServiceId }))
    );
    assert.equal((await stored(saleId)).sentAsServiceId, parcelServiceId);
    assert.deepEqual(shape(await linesOf(saleId)), ["bubble×1", "card×2"]);
  });

  it("keeps how the parcel went when a change of platform drops the option", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    await updateSaleHeader(userId, saleId, header(otherPlatformId, null));
    const row = await stored(saleId);
    assert.equal(row.shippingOptionId, null);
    assert.equal(row.sentAsServiceId, letterServiceId);
    assert.deepEqual(shape(await linesOf(saleId)), ["card×2", "envelope×1"]);
  });

  it("refuses a service of another collection", async () => {
    const saleId = await createSale(userId, collectionId, header(platformId, shipping(letterOptionId)));
    await assert.rejects(
      updateSaleShipping(userId, saleId, shipping(letterOptionId, { sentAsServiceId: foreignServiceId })),
      /Carrier service not found/
    );
  });

  it("refuses to delete a service a sale was sent as", async () => {
    await assert.rejects(
      deleteCarrierService(userId, courierServiceId),
      (e: unknown) => e instanceof CarrierServiceInUseError && e.optionCount === 0 && e.saleCount > 0
    );
  });
});
