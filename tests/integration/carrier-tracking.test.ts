import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCarriers,
  createCarrier,
  updateCarrier,
  deleteCarrier,
  createCarrierService,
  deleteCarrierService,
  CarrierInUseError,
} from "../../src/lib/carriers";
import {
  createShippingOption,
  getShippingOptions,
  updateShippingOption,
} from "../../src/lib/shipping-options";
import { createSale, getSaleDetail, updateSaleShipment } from "../../src/lib/sales";

// Carriers and shipment tracking (#491): the dictionary itself, and what it is for — a sale's tracking
// number resolving to a link through the carrier of the service its shipping option is linked to
// (#1909).

const TS = Date.now();
const TEMPLATE = "https://emonitoring.poczta-polska.pl/?numer={code}";

describe("carriers + sale tracking", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let carrierId: string;
  let serviceId: string;
  let optionId: string;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-carrier-${TS}`,
          name: "Test User Carrier",
          email: `test-carrier-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    const col = await prisma.collection.create({
      data: { slug: `col-carrier-${TS}`, name: "Carrier", baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformCurrency: "PLN" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newSale(optionIdForSale: string | null): Promise<string> {
    return createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-02-01"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
      shipping: optionIdForSale
        ? { optionId: optionIdForSale, optionName: null, cost: "12.00", currency: "PLN" }
        : null,
    });
  }

  it("lists the collection's carriers by name", async () => {
    await createCarrier(userId, collectionId, { name: "Poczta Polska", trackingUrlTemplate: TEMPLATE });
    await createCarrier(userId, collectionId, { name: "Courier with no tracking page", trackingUrlTemplate: null });
    const carriers = await getCarriers(userId, collectionId);
    assert.deepEqual(
      carriers.map((c) => c.name),
      ["Courier with no tracking page", "Poczta Polska"]
    );
    carrierId = carriers.find((c) => c.name === "Poczta Polska")!.id;
    assert.equal(carriers[0].trackingUrlTemplate, null);
  });

  it("refuses to read another owner's carriers", async () => {
    await assert.rejects(() => getCarriers("stranger", collectionId), /access denied/i);
  });

  it("links a platform's shipping option to a service of the carrier's", async () => {
    await createCarrierService(userId, carrierId, { name: "List polecony", cost: "12.00", currency: "PLN" });
    serviceId = (await getCarriers(userId, collectionId)).find((c) => c.id === carrierId)!.services[0].id;
    await createShippingOption(userId, collectionId, platformId, {
      name: "Registered letter",
      price: "14.00",
      currency: "PLN",
      serviceId,
    });
    const option = (await getShippingOptions(userId, platformId))[0];
    optionId = option.id;
    assert.equal(option.service?.id, serviceId);
    assert.equal(option.service?.carrierId, carrierId);
    assert.equal(option.service?.carrierName, "Poczta Polska");
  });

  it("refuses a service from outside the collection", async () => {
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-carrier-other-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
    });
    await createCarrier(userId, otherCollection.id, { name: "Elsewhere", trackingUrlTemplate: null });
    const [elsewhere] = await getCarriers(userId, otherCollection.id);
    await createCarrierService(userId, elsewhere.id, { name: "Letter", cost: "5.00", currency: "EUR" });
    const [farService] = (await getCarriers(userId, otherCollection.id))[0].services;
    await assert.rejects(
      () =>
        updateShippingOption(userId, optionId, {
          name: "Registered letter",
          price: "14.00",
          currency: "PLN",
          serviceId: farService.id,
        }),
      /not found in this collection/i
    );
  });

  it("falls back to the carrier of the option's service when the sale says nothing", async () => {
    const saleId = await newSale(optionId);
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: "PL123456789" });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingCode, "PL123456789");
    assert.equal(detail?.carrierId, carrierId);
    assert.equal(detail?.carrierName, "Poczta Polska");
    assert.equal(detail?.trackingUrl, "https://emonitoring.poczta-polska.pl/?numer=PL123456789");
  });

  it("lets the sale's own carrier override the option's default", async () => {
    await createCarrier(userId, collectionId, {
      name: "DPD",
      trackingUrlTemplate: "https://tracktrace.dpd.com.pl/findParcel?p1={code}",
    });
    const dpd = (await getCarriers(userId, collectionId)).find((c) => c.name === "DPD")!;
    const saleId = await newSale(optionId);
    await updateSaleShipment(userId, saleId, { carrierId: dpd.id, trackingCode: "DPD9" });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.carrierId, dpd.id);
    assert.equal(detail?.carrierName, "DPD");
    assert.equal(detail?.trackingUrl, "https://tracktrace.dpd.com.pl/findParcel?p1=DPD9");
  });

  it("refuses a carrier from outside the sale's collection", async () => {
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-carrier-far-${TS}`, name: "Far", baseCurrency: "EUR", ownerId: userId },
    });
    await createCarrier(userId, otherCollection.id, { name: "Far away", trackingUrlTemplate: null });
    const [far] = await getCarriers(userId, otherCollection.id);
    const saleId = await newSale(optionId);
    await assert.rejects(
      () => updateSaleShipment(userId, saleId, { carrierId: far.id, trackingCode: "X1" }),
      /not found in this collection/i
    );
  });

  it("keeps the number without a link when nothing names a carrier", async () => {
    const saleId = await newSale(null);
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: "PL999" });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingCode, "PL999");
    assert.equal(detail?.carrierId, null);
    assert.equal(detail?.carrierName, null);
    assert.equal(detail?.trackingUrl, null);
  });

  it("follows the carrier to its new address rather than freezing it on the sale", async () => {
    const saleId = await newSale(optionId);
    await updateSaleShipment(userId, saleId, { carrierId, trackingCode: "PL42" });
    await updateCarrier(userId, carrierId, {
      name: "Poczta Polska",
      trackingUrlTemplate: "https://tracking.example/{code}/status",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingUrl, "https://tracking.example/PL42/status");
  });

  it("clears the number when it is blanked", async () => {
    const saleId = await newSale(optionId);
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: "PL7" });
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: null });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingCode, null);
    assert.equal(detail?.trackingUrl, null);
  });

  it("refuses to delete a carrier that still has services", async () => {
    await assert.rejects(
      () => deleteCarrier(userId, carrierId),
      (e: unknown) => e instanceof CarrierInUseError && e.serviceCount === 1
    );
  });

  it("refuses to delete a carrier a sale still names, once it has no services", async () => {
    await updateShippingOption(userId, optionId, {
      name: "Registered letter",
      price: "14.00",
      currency: "PLN",
      serviceId: null,
    });
    await deleteCarrierService(userId, serviceId);
    // The sales recorded above still carry it as the carrier that took their parcel.
    await assert.rejects(
      () => deleteCarrier(userId, carrierId),
      (e: unknown) => e instanceof CarrierInUseError && e.serviceCount === 0 && e.saleCount > 0
    );
  });
});
