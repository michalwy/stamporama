import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getShippingMethods,
  createShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  ShippingMethodInUseError,
} from "../../src/lib/shipping-methods";
import { createSale, updateSaleShipping, updateSaleHeader, getSaleDetail } from "../../src/lib/sales";

// Per-platform shipping methods (#468): the dictionary itself, and the two facts a sale keeps about
// it — the live link and the name snapshot.

const TS = Date.now();

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-ship-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-ship-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("shipping methods dictionary", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;

  before(async () => {
    userId = (await createTestUser(`d-${TS}`)).id;
    const col = await prisma.collection.create({
      data: { slug: `col-ship-d-${TS}`, name: "Ship", baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists a platform's own methods, by name", async () => {
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Registered letter",
      cost: "12.00",
      currency: "PLN",
      carrierId: null,
    });
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Courier",
      cost: "25.00",
      currency: "PLN",
      carrierId: null,
    });
    await createShippingMethod(userId, collectionId, otherPlatformId, {
      name: "Priority",
      cost: "4.50",
      currency: "EUR",
      carrierId: null,
    });

    const methods = await getShippingMethods(userId, platformId);
    assert.deepEqual(
      methods.map((m) => `${m.name} ${m.cost} ${m.currency}`),
      ["Courier 25.00 PLN", "Registered letter 12.00 PLN"]
    );
    const others = await getShippingMethods(userId, otherPlatformId);
    assert.deepEqual(others.map((m) => m.name), ["Priority"]);
  });

  it("refuses a contact that is not a platform", async () => {
    const buyer = await prisma.contact.create({
      data: { collectionId, name: "A buyer", buyer: true },
    });
    await assert.rejects(
      () =>
        createShippingMethod(userId, collectionId, buyer.id, {
          name: "Nope",
          cost: "1.00",
          currency: "EUR",
          carrierId: null,
        }),
      /not a platform/i
    );
  });

  it("refuses a stranger", async () => {
    await assert.rejects(
      () =>
        createShippingMethod("stranger", collectionId, platformId, {
          name: "Nope",
          cost: "1.00",
          currency: "PLN",
          carrierId: null,
        }),
      /access denied/i
    );
  });

  it("rejects a duplicate name on the same platform, allows it on another", async () => {
    await assert.rejects(() =>
      createShippingMethod(userId, collectionId, platformId, {
        name: "Courier",
        cost: "30.00",
        currency: "PLN",
        carrierId: null,
      })
    );
    await createShippingMethod(userId, collectionId, otherPlatformId, {
      name: "Courier",
      cost: "9.00",
      currency: "EUR",
      carrierId: null,
    });
  });

  it("edits and deletes an unused method", async () => {
    const [courier] = await getShippingMethods(userId, platformId);
    await updateShippingMethod(userId, courier.id, {
      name: "Courier (DPD)",
      cost: "27.50",
      currency: "PLN",
      carrierId: null,
    });
    const renamed = (await getShippingMethods(userId, platformId)).find((m) => m.id === courier.id);
    assert.equal(renamed?.name, "Courier (DPD)");
    assert.equal(renamed?.cost, "27.50");

    await deleteShippingMethod(userId, courier.id);
    assert.equal(
      (await getShippingMethods(userId, platformId)).some((m) => m.id === courier.id),
      false
    );
  });
});

describe("a sale's shipping method", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let methodId: string;
  let saleId: string;

  before(async () => {
    userId = (await createTestUser(`s-${TS}`)).id;
    const col = await prisma.collection.create({
      data: { slug: `col-ship-s-${TS}`, name: "Ship sales", baseCurrency: "PLN", ownerId: userId },
    });
    collectionId = col.id;
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
    await createShippingMethod(userId, collectionId, platformId, {
      name: "Registered letter",
      cost: "12.00",
      currency: "PLN",
      carrierId: null,
    });
    methodId = (await getShippingMethods(userId, platformId))[0].id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newSale(): Promise<string> {
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
      shipping: {
        methodId,
        methodName: null,
        cost: "12.00",
        currency: "PLN",
      },
    });
  }

  it("stores the link and the name together at creation", async () => {
    saleId = await newSale();
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodId, methodId);
    assert.equal(detail?.shippingMethodName, "Registered letter");
    assert.equal(detail?.shippingCost, "12.00");
    assert.equal(detail?.shippingCurrency, "PLN");
  });

  it("takes the name from the dictionary row, never from the caller", async () => {
    await updateSaleShipping(userId, saleId, {
      methodId,
      methodName: "Something else entirely",
      cost: "12.00",
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodName, "Registered letter");
  });

  it("keeps the snapshot when the dictionary row is renamed", async () => {
    await updateShippingMethod(userId, methodId, {
      name: "Registered letter (priority)",
      cost: "14.00",
      currency: "PLN",
      carrierId: null,
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodName, "Registered letter");
    assert.equal(detail?.shippingCost, "12.00");
  });

  it("refuses to delete a method a sale points at", async () => {
    await assert.rejects(
      () => deleteShippingMethod(userId, methodId),
      (e: unknown) => e instanceof ShippingMethodInUseError && e.saleCount === 1
    );
  });

  it("records a one-off method with no dictionary row", async () => {
    await updateSaleShipping(userId, saleId, {
      methodId: null,
      methodName: "  Hand-delivered  ",
      cost: "0.00",
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodId, null);
    assert.equal(detail?.shippingMethodName, "Hand-delivered");
  });

  it("clears the cost but keeps the method when the amount is blanked", async () => {
    await updateSaleShipping(userId, saleId, {
      methodId,
      methodName: null,
      cost: null,
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodId, methodId);
    assert.equal(detail?.shippingCost, null);
    assert.equal(detail?.shippingCurrency, null);
  });

  it("refuses a method belonging to another platform", async () => {
    await createShippingMethod(userId, collectionId, otherPlatformId, {
      name: "Elsewhere",
      cost: "3.00",
      currency: "PLN",
      carrierId: null,
    });
    const elsewhere = (await getShippingMethods(userId, otherPlatformId))[0];
    await assert.rejects(
      () =>
        updateSaleShipping(userId, saleId, {
          methodId: elsewhere.id,
          methodName: null,
          cost: "3.00",
          currency: "PLN",
        }),
      /not found on this sale's platform/i
    );
  });

  it("drops the method when the sale moves to another platform", async () => {
    await updateSaleHeader(userId, saleId, {
      platformId: otherPlatformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-02-01"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingMethodId, null);
    // The name stays: it is a snapshot of how the parcel actually went, and moving the sale to
    // another marketplace does not make that untrue. It reads "(priority)" because the method was
    // re-picked *after* the rename above — a fresh pick re-snapshots the row as it is then.
    assert.equal(detail?.shippingMethodName, "Registered letter (priority)");
  });
});
