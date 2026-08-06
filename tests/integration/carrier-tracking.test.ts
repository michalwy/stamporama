import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCarriers,
  createCarrier,
  updateCarrier,
  deleteCarrier,
  CarrierInUseError,
} from "../../src/lib/carriers";
import {
  createShippingMethod,
  getShippingMethods,
  updateShippingMethod,
} from "../../src/lib/shipping-methods";
import { createSale, getSaleDetail, updateSaleShipment } from "../../src/lib/sales";

// Carriers and shipment tracking (#491): the dictionary itself, and the one thing it is for — a
// sale's tracking number resolving to a link through the method that carried the parcel.

const TS = Date.now();
const TEMPLATE = "https://emonitoring.poczta-polska.pl/?numer={code}";

describe("carriers + sale tracking", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let carrierId: string;
  let methodId: string;

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
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newSale(methodIdForSale: string | null): Promise<string> {
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
      shipping: methodIdForSale
        ? { methodId: methodIdForSale, methodName: null, cost: "12.00", currency: "PLN" }
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

  it("attaches a carrier to a platform's shipping method", async () => {
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Registered letter",
      cost: "12.00",
      currency: "PLN",
      carrierId,
    });
    const method = (await getShippingMethods(userId, platformId))[0];
    methodId = method.id;
    assert.equal(method.carrierId, carrierId);
  });

  it("refuses a carrier from outside the collection", async () => {
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-carrier-other-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
    });
    await createCarrier(userId, otherCollection.id, { name: "Elsewhere", trackingUrlTemplate: null });
    const [elsewhere] = await getCarriers(userId, otherCollection.id);
    await assert.rejects(
      () =>
        updateShippingMethod(userId, methodId, {
          name: "Registered letter",
          cost: "12.00",
          currency: "PLN",
          carrierId: elsewhere.id,
        }),
      /not found in this collection/i
    );
  });

  it("falls back to the method's carrier when the sale says nothing", async () => {
    const saleId = await newSale(methodId);
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: "PL123456789" });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingCode, "PL123456789");
    assert.equal(detail?.carrierId, carrierId);
    assert.equal(detail?.carrierName, "Poczta Polska");
    assert.equal(detail?.trackingUrl, "https://emonitoring.poczta-polska.pl/?numer=PL123456789");
  });

  it("lets the sale's own carrier override the method's default", async () => {
    await createCarrier(userId, collectionId, {
      name: "DPD",
      trackingUrlTemplate: "https://tracktrace.dpd.com.pl/findParcel?p1={code}",
    });
    const dpd = (await getCarriers(userId, collectionId)).find((c) => c.name === "DPD")!;
    const saleId = await newSale(methodId);
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
    const saleId = await newSale(methodId);
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
    const saleId = await newSale(methodId);
    await updateSaleShipment(userId, saleId, { carrierId, trackingCode: "PL42" });
    await updateCarrier(userId, carrierId, {
      name: "Poczta Polska",
      trackingUrlTemplate: "https://tracking.example/{code}/status",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingUrl, "https://tracking.example/PL42/status");
  });

  it("clears the number when it is blanked", async () => {
    const saleId = await newSale(methodId);
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: "PL7" });
    await updateSaleShipment(userId, saleId, { carrierId: null, trackingCode: null });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.trackingCode, null);
    assert.equal(detail?.trackingUrl, null);
  });

  it("refuses to delete a carrier a shipping method still posts with", async () => {
    await assert.rejects(
      () => deleteCarrier(userId, carrierId),
      (e: unknown) => e instanceof CarrierInUseError && e.methodCount === 1
    );
  });

  it("refuses to delete a carrier a sale still names, once nothing else points at it", async () => {
    await updateShippingMethod(userId, methodId, {
      name: "Registered letter",
      cost: "12.00",
      currency: "PLN",
      carrierId: null,
    });
    // The sales recorded above still carry it, so the database's own RESTRICT is what stops this —
    // the same detach-before-delete guard, one level further along.
    await assert.rejects(() => deleteCarrier(userId, carrierId), /foreign key|constraint/i);
  });
});
