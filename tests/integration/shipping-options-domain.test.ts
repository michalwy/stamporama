import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getShippingOptions,
  createShippingOption,
  updateShippingOption,
  deleteShippingOption,
  ShippingOptionInUseError,
} from "../../src/lib/shipping-options";
import { createSale, updateSaleShipping, updateSaleHeader, getSaleDetail } from "../../src/lib/sales";
import {
  createCarrier,
  createCarrierService,
  deleteCarrierService,
  getCarriers,
  CarrierServiceInUseError,
} from "../../src/lib/carriers";

// Per-platform shipping options (#468, #1909): the list itself, at buyer prices and linked to a
// carrier service, and the two facts a sale keeps about it — the live link and the name snapshot.

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

describe("shipping options list", () => {
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
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Delcampe", platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists a platform's own options, by name, at the buyer's price", async () => {
    await createShippingOption(userId, collectionId, platformId, {
      name: "Registered letter",
      price: "12.00",
      currency: "PLN",
      serviceId: null,
    });
    await createShippingOption(userId, collectionId, platformId, {
      name: "Courier",
      price: "25.00",
      currency: "PLN",
      serviceId: null,
    });
    await createShippingOption(userId, collectionId, otherPlatformId, {
      name: "Priority",
      price: "4.50",
      currency: "EUR",
      serviceId: null,
    });

    const options = await getShippingOptions(userId, platformId);
    assert.deepEqual(
      options.map((o) => `${o.name} ${o.price} ${o.currency}`),
      ["Courier 25.00 PLN", "Registered letter 12.00 PLN"]
    );
    const others = await getShippingOptions(userId, otherPlatformId);
    assert.deepEqual(others.map((m) => m.name), ["Priority"]);
  });

  it("refuses a contact — a platform is no contact (#1955)", async () => {
    const buyer = await prisma.contact.create({
      data: { collectionId, name: "A buyer", buyer: true },
    });
    await assert.rejects(
      () =>
        createShippingOption(userId, collectionId, buyer.id, {
          name: "Nope",
          price: "1.00",
          currency: "EUR",
          serviceId: null,
        }),
      /Platform not found/i
    );
  });

  it("refuses a stranger", async () => {
    await assert.rejects(
      () =>
        createShippingOption("stranger", collectionId, platformId, {
          name: "Nope",
          price: "1.00",
          currency: "PLN",
          serviceId: null,
        }),
      /access denied/i
    );
  });

  it("rejects a duplicate name on the same platform, allows it on another", async () => {
    await assert.rejects(() =>
      createShippingOption(userId, collectionId, platformId, {
        name: "Courier",
        price: "30.00",
        currency: "PLN",
        serviceId: null,
      })
    );
    await createShippingOption(userId, collectionId, otherPlatformId, {
      name: "Courier",
      price: "9.00",
      currency: "EUR",
      serviceId: null,
    });
  });

  it("edits and deletes an unused option", async () => {
    const [courier] = await getShippingOptions(userId, platformId);
    await updateShippingOption(userId, courier.id, {
      name: "Courier (DPD)",
      price: "27.50",
      currency: "PLN",
      serviceId: null,
    });
    const renamed = (await getShippingOptions(userId, platformId)).find((m) => m.id === courier.id);
    assert.equal(renamed?.name, "Courier (DPD)");
    assert.equal(renamed?.price, "27.50");

    await deleteShippingOption(userId, courier.id);
    assert.equal(
      (await getShippingOptions(userId, platformId)).some((m) => m.id === courier.id),
      false
    );
  });
});

describe("a sale's shipping option", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let optionId: string;
  let saleId: string;

  before(async () => {
    userId = (await createTestUser(`s-${TS}`)).id;
    const col = await prisma.collection.create({
      data: { slug: `col-ship-s-${TS}`, name: "Ship sales", baseCurrency: "PLN", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Delcampe", platformCurrency: "PLN" },
      })
    ).id;
    await createShippingOption(userId, collectionId, platformId, {
      name: "Registered letter",
      price: "12.00",
      currency: "PLN",
      serviceId: null,
    });
    optionId = (await getShippingOptions(userId, platformId))[0].id;
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
        optionId,
        optionName: null,
        cost: "12.00",
        currency: "PLN",
      },
    });
  }

  it("stores the link and the name together at creation", async () => {
    saleId = await newSale();
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingOptionId, optionId);
    assert.equal(detail?.shippingOptionName, "Registered letter");
    assert.equal(detail?.shippingCost, "12.00");
    assert.equal(detail?.shippingCurrency, "PLN");
  });

  it("takes the name from the option, never from the caller", async () => {
    await updateSaleShipping(userId, saleId, {
      optionId,
      optionName: "Something else entirely",
      cost: "12.00",
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingOptionName, "Registered letter");
  });

  it("keeps the snapshot when the option is renamed", async () => {
    await updateShippingOption(userId, optionId, {
      name: "Registered letter (priority)",
      price: "14.00",
      currency: "PLN",
      serviceId: null,
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingOptionName, "Registered letter");
    assert.equal(detail?.shippingCost, "12.00");
  });

  it("refuses to delete an option a sale points at", async () => {
    await assert.rejects(
      () => deleteShippingOption(userId, optionId),
      (e: unknown) => e instanceof ShippingOptionInUseError && e.saleCount === 1
    );
  });

  it("records a one-off option with no row", async () => {
    await updateSaleShipping(userId, saleId, {
      optionId: null,
      optionName: "  Hand-delivered  ",
      cost: "0.00",
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingOptionId, null);
    assert.equal(detail?.shippingOptionName, "Hand-delivered");
  });

  it("clears the cost but keeps the option when the amount is blanked", async () => {
    await updateSaleShipping(userId, saleId, {
      optionId,
      optionName: null,
      cost: null,
      currency: "PLN",
    });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.shippingOptionId, optionId);
    assert.equal(detail?.shippingCost, null);
    assert.equal(detail?.shippingCurrency, null);
  });

  it("refuses an option belonging to another platform", async () => {
    await createShippingOption(userId, collectionId, otherPlatformId, {
      name: "Elsewhere",
      price: "3.00",
      currency: "PLN",
      serviceId: null,
    });
    const elsewhere = (await getShippingOptions(userId, otherPlatformId))[0];
    await assert.rejects(
      () =>
        updateSaleShipping(userId, saleId, {
          optionId: elsewhere.id,
          optionName: null,
          cost: "3.00",
          currency: "PLN",
        }),
      /not found on this sale's platform/i
    );
  });

  it("drops the option when the sale moves to another platform", async () => {
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
    assert.equal(detail?.shippingOptionId, null);
    // The name stays: it is a snapshot of how the parcel actually went, and moving the sale to
    // another marketplace does not make that untrue. It reads "(priority)" because the option was
    // re-picked *after* the rename above — a fresh pick re-snapshots the row as it is then.
    assert.equal(detail?.shippingOptionName, "Registered letter (priority)");
  });
});

describe("carrier services and the options linked to them", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let carrierId: string;

  before(async () => {
    userId = (await createTestUser(`c-${TS}`)).id;
    const col = await prisma.collection.create({
      data: { slug: `col-ship-c-${TS}`, name: "Ship services", baseCurrency: "PLN", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformCurrency: "PLN" },
      })
    ).id;
    await createCarrier(userId, collectionId, { name: "Poczta Polska", trackingUrlTemplate: null });
    carrierId = (await getCarriers(userId, collectionId))[0].id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("keeps a carrier's services with what each costs the collector, by name", async () => {
    await createCarrierService(userId, carrierId, { name: "List polecony", cost: "9.50", currency: "PLN" });
    await createCarrierService(userId, carrierId, { name: "Paczka", cost: "16.00", currency: "PLN" });
    const [carrier] = await getCarriers(userId, collectionId);
    assert.deepEqual(
      carrier.services.map((s) => `${s.name} ${s.cost} ${s.currency}`),
      ["List polecony 9.50 PLN", "Paczka 16.00 PLN"]
    );
  });

  it("rejects a duplicate service name within one carrier", async () => {
    await assert.rejects(() =>
      createCarrierService(userId, carrierId, { name: "Paczka", cost: "20.00", currency: "PLN" })
    );
  });

  it("gives a sale's option the postage of its service, while the option keeps the buyer's price", async () => {
    const [carrier] = await getCarriers(userId, collectionId);
    const letter = carrier.services.find((s) => s.name === "List polecony")!;
    await createShippingOption(userId, collectionId, platformId, {
      name: "Registered letter",
      price: "12.00",
      currency: "PLN",
      serviceId: letter.id,
    });
    const [option] = await getShippingOptions(userId, platformId);
    assert.equal(option.price, "12.00");
    assert.equal(option.service?.cost, "9.50");
    assert.equal(option.service?.name, "List polecony");
  });

  it("refuses to delete a service an option is linked to", async () => {
    const [option] = await getShippingOptions(userId, platformId);
    await assert.rejects(
      () => deleteCarrierService(userId, option.service!.id),
      (e: unknown) => e instanceof CarrierServiceInUseError && e.optionCount === 1
    );
  });
});
