import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { getSaleDetail } from "../../src/lib/sales";
import {
  recordAllegroOrderSale,
  fillBuyerDetailsFromOrder,
  AllegroSaleError,
} from "../../src/lib/allegro-sale";
import { getAllegroWorklist } from "../../src/lib/allegro-worklist";
import { ALLEGRO_PLATFORM_MODULE } from "../../src/lib/platform-modules";
import type { ResolvedSaleHeader } from "../../src/lib/sale-header-input";

// An Allegro order becoming a `Sale` (#463), and what the worklist then says about it.
//
// The three things worth a database to prove: a multi-item order is **one** sale with several lines,
// an order can never become two sales, and an order only half recorded **stays** on the worklist
// with the rest of it still offered.
//
// The pre-fill itself is not exercised here — it re-reads the order from Allegro, and what it
// decides on the way past is pure and unit-tested (`allegro-sale-rules`).

describe("recording an Allegro order as a sale (#463)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-allegro-sale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User allegro-sale-${ts}`,
        email: `test-allegro-sale-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-allegro-sale-${ts}`,
        name: `Collection allegro-sale-${ts}`,
        // The sale's own currency, so nothing here depends on an exchange rate being known.
        baseCurrency: "PLN",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Allegro",
          platform: true,
          platformCurrency: "PLN",
          platformModule: ALLEGRO_PLATFORM_MODULE,
        },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by `sale_line_item` (the no-double-sale backstop),
    // so the collection cannot be cascaded away while its sales still name the copies.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** One copy, in its own offer of one set — the ordinary listing an ordinary order line is. */
  async function offerWithOneSet(name: string): Promise<{ offerId: string; setId: string; itemIds: string[] }> {
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    // Seeded with its copy at creation, because an offer cannot start `active` with nothing in it.
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "10.00",
        currency: "PLN",
        listingDate: null,
        state: "active",
      },
      { seedItemIds: [item.id] }
    );
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true } });
    return { offerId, setId: set.id, itemIds: [item.id] };
  }

  /** A synced order with one line per offer, matched, as `allegro-sync` would have written it. */
  async function syncedOrder(
    orderId: string,
    offers: { offerId: string }[],
    opts: { paymentStatus?: string } = {}
  ): Promise<void> {
    const now = new Date();
    const order = await prisma.allegroOrder.create({
      data: {
        collectionId,
        orderId,
        status: "READY_FOR_PROCESSING",
        paymentStatus: opts.paymentStatus ?? "paid",
        boughtAt: now,
        buyerLogin: "buyer_login",
        buyerName: "Jan Kowalski",
        totalPaid: "27.00",
        currency: "PLN",
        observedAt: now,
      },
      select: { id: true },
    });
    await prisma.allegroOrderLine.createMany({
      data: offers.map((offer, index) => ({
        collectionId,
        allegroOrderId: order.id,
        lineItemId: `${orderId}-line-${index}`,
        platformOfferId: `1000${index}`,
        title: `Listing ${index}`,
        quantity: 1,
        unitPrice: "10.00",
        currency: "PLN",
        boughtAt: now,
        offerId: offer.offerId,
        matchedBy: "url",
        observedAt: now,
      })),
    });
  }

  function header(): ResolvedSaleHeader {
    return {
      platformId,
      buyerId: null,
      // Deliberately wrong: the flow writes the order's own id, never what the form carried.
      externalRef: "typed-by-hand",
      transactionUrl: "https://allegro.pl/moje-allegro/sprzedaz/zamowienia/x",
      soldAt: new Date("2026-07-04"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: "27.00",
      commission: null,
      shipping: null,
    };
  }

  it("records a multi-item order as one sale with a line per offer, and marks a paid order paid", async () => {
    const a = await offerWithOneSet("Multi A");
    const b = await offerWithOneSet("Multi B");
    await syncedOrder("ORDER-MULTI", [a, b]);

    const result = await recordAllegroOrderSale(userId, collectionId, "ORDER-MULTI", header(), [
      { offerId: a.offerId, offerSetId: a.setId, price: "10.00", itemIds: a.itemIds },
      { offerId: b.offerId, offerSetId: b.setId, price: "10.00", itemIds: b.itemIds },
    ]);

    assert.equal(result.created, true);
    assert.equal(result.linesError, null);

    const sale = await getSaleDetail(userId, result.saleId);
    assert.ok(sale);
    assert.equal(sale.lines.length, 2);
    // The order's id, not the header's — the key the worklist drops the order on.
    assert.equal(sale.externalRef, "ORDER-MULTI");
    assert.equal(sale.buyerPaidTotal, "27.00");
    // Allegro says it is paid, so the lifecycle starts a step further along (#191).
    assert.equal(sale.status, "paid");

    // And the order is gone from the worklist, every line of it being covered.
    const worklist = await getAllegroWorklist(userId, collectionId);
    assert.equal(
      worklist.orders.find((order) => order.orderId === "ORDER-MULTI"),
      undefined
    );
  });

  it("leaves an unpaid order's sale at ordered", async () => {
    const a = await offerWithOneSet("Unpaid A");
    await syncedOrder("ORDER-UNPAID", [a], { paymentStatus: "unpaid" });

    const result = await recordAllegroOrderSale(userId, collectionId, "ORDER-UNPAID", header(), [
      { offerId: a.offerId, offerSetId: a.setId, price: "10.00", itemIds: a.itemIds },
    ]);
    const sale = await getSaleDetail(userId, result.saleId);
    assert.equal(sale?.status, "ordered");
  });

  it("keeps a partly recorded order on the worklist, with the recorded line marked", async () => {
    const a = await offerWithOneSet("Partial A");
    const b = await offerWithOneSet("Partial B");
    await syncedOrder("ORDER-PARTIAL", [a, b]);

    const first = await recordAllegroOrderSale(userId, collectionId, "ORDER-PARTIAL", header(), [
      { offerId: a.offerId, offerSetId: a.setId, price: "10.00", itemIds: a.itemIds },
    ]);

    const worklist = await getAllegroWorklist(userId, collectionId);
    const order = worklist.orders.find((row) => row.orderId === "ORDER-PARTIAL");
    assert.ok(order, "a half-recorded order must stay on the worklist");
    assert.deepEqual(order.recordedSale, { id: first.saleId, saleNo: first.saleNo });
    assert.deepEqual(
      order.lines.map((line) => line.recorded),
      [true, false]
    );
    // Nothing else is proposed for an order a sale already claims.
    assert.equal(order.suggestedSale, null);
  });

  it("adds the rest to the same sale rather than making a second one", async () => {
    const a = await offerWithOneSet("Rest A");
    const b = await offerWithOneSet("Rest B");
    await syncedOrder("ORDER-REST", [a, b]);

    const first = await recordAllegroOrderSale(userId, collectionId, "ORDER-REST", header(), [
      { offerId: a.offerId, offerSetId: a.setId, price: "10.00", itemIds: a.itemIds },
    ]);
    const second = await recordAllegroOrderSale(userId, collectionId, "ORDER-REST", header(), [
      { offerId: b.offerId, offerSetId: b.setId, price: "10.00", itemIds: b.itemIds },
    ]);

    assert.equal(second.created, false);
    assert.equal(second.saleId, first.saleId);

    const claims = await prisma.sale.count({ where: { collectionId, externalRef: "ORDER-REST" } });
    assert.equal(claims, 1, "one order is one sale, for ever");

    const sale = await getSaleDetail(userId, first.saleId);
    assert.equal(sale?.lines.length, 2);

    // Both lines covered now, so the order has left the list.
    const worklist = await getAllegroWorklist(userId, collectionId);
    assert.equal(
      worklist.orders.find((row) => row.orderId === "ORDER-REST"),
      undefined
    );
  });

  it("fills a buyer contact's blank full name and email from the order, and overwrites neither", async () => {
    const a = await offerWithOneSet("Buyer A");
    await syncedOrder("ORDER-BUYER", [a]);
    // A buyer already filed under their Allegro login, the way the collector names them — and
    // already carrying an email of their own.
    const buyer = await prisma.contact.create({
      data: { collectionId, name: "bronek_1980", buyer: true, email: "typed@example.com" },
      select: { id: true },
    });

    await recordAllegroOrderSale(
      userId,
      collectionId,
      "ORDER-BUYER",
      { ...header(), buyerId: buyer.id },
      [{ offerId: a.offerId, offerSetId: a.setId, price: "10.00", itemIds: a.itemIds }]
    );
    await fillBuyerDetailsFromOrder(userId, collectionId, buyer.id, {
      email: "from-allegro@example.com",
      fullName: "Bronisław Włoch",
    });

    const after = await prisma.contact.findUniqueOrThrow({
      where: { id: buyer.id },
      select: { name: true, fullName: true, email: true },
    });
    // The login stays the identity, the legal name lands beside it…
    assert.equal(after.name, "bronek_1980");
    assert.equal(after.fullName, "Bronisław Włoch");
    // …and what the collector typed is never replaced by what a marketplace said.
    assert.equal(after.email, "typed@example.com");
  });

  it("refuses an order that is not in the collection, by name", async () => {
    await assert.rejects(
      () => recordAllegroOrderSale(userId, collectionId, "NO-SUCH-ORDER", header(), []),
      (err: unknown) => err instanceof AllegroSaleError
    );
  });

  it("refuses to record nothing at all", async () => {
    const a = await offerWithOneSet("Empty A");
    await syncedOrder("ORDER-EMPTY", [a]);
    await assert.rejects(
      () => recordAllegroOrderSale(userId, collectionId, "ORDER-EMPTY", header(), []),
      (err: unknown) => err instanceof AllegroSaleError
    );
  });
});
