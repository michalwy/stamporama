import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getDashboardSection } from "../../src/lib/dashboard";
import { getActionItems } from "../../src/lib/action-items";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import {
  createSale,
  listSalesPaginated,
  setSaleStatus,
  type SaleHeaderInput,
  type SaleStatus,
} from "../../src/lib/sales";

// The Dashboard's Sales section (#1809): sales awaiting payment, to pack and to send, oldest in their
// status first, beside the bell's own *Sold on Allegro, no sale recorded* group.

describe("the Dashboard's Sales section (#1809)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let buyerId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-dashsales-${ts}`;
    otherUserId = `test-user-dashsales-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-dashsales-${ts}`,
          name: `Collection dashsales-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })
    ).id;
    buyerId = (
      await prisma.contact.create({ data: { collectionId, name: "Anna Buyer", buyer: true } })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const header = (over: Partial<SaleHeaderInput> = {}): SaleHeaderInput => ({
    platformId,
    buyerId: null,
    externalRef: null,
    transactionUrl: null,
    soldAt: new Date(),
    currency: "EUR",
    buyerHandling: null,
    buyerPaidTotal: null,
    commission: null,
    ...over,
  });

  /** A sale moved to `status`, which it entered at `since`. */
  async function saleIn(
    status: SaleStatus,
    since: Date,
    over: Partial<SaleHeaderInput> = {}
  ): Promise<string> {
    const id = await createSale(userId, collectionId, header(over));
    if (status !== "ordered") await setSaleStatus(userId, id, status);
    // The event that moved it into `status` is when it entered it; pin it so the order is the test's.
    const entered = await prisma.saleStatusEvent.findFirstOrThrow({ where: { saleId: id, status } });
    await prisma.saleStatusEvent.update({ where: { id: entered.id }, data: { changedAt: since } });
    return id;
  }

  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
  const sales = () => getDashboardSection(userId, collectionId, "sales");
  const group = async (id: string) => (await sales()).groups.find((g) => g.id === id)!;

  it("shows every group at zero before anything is waiting", async () => {
    const section = await sales();
    assert.deepEqual(
      section.groups.map((g) => [g.id, g.count]),
      [
        ["offer-platform-sale", 0],
        ["sales-awaiting-payment", 0],
        ["sales-to-pack", 0],
        ["sales-to-send", 0],
      ]
    );
  });

  let unpaidNew: string;
  let unpaidOld: string;
  let paid: string;
  let packed: string;
  let sent: string;

  it("groups sales by fulfilment status, oldest in their status first, and leaves out what has gone", async () => {
    unpaidNew = await saleIn("ordered", day(9), { buyerId, buyerHandling: "4.50" });
    unpaidOld = await saleIn("ordered", day(3), { buyerPaidTotal: "30.00" });
    paid = await saleIn("paid", day(5));
    packed = await saleIn("packed", day(6));
    sent = await saleIn("sent", day(1));
    await saleIn("received", day(1));

    const section = await sales();
    const byId = new Map(section.groups.map((g) => [g.id, g]));
    assert.deepEqual(
      byId.get("sales-awaiting-payment")!.items.map((i) => i.key),
      [unpaidOld, unpaidNew]
    );
    assert.deepEqual(byId.get("sales-to-pack")!.items.map((i) => i.key), [paid]);
    assert.deepEqual(byId.get("sales-to-send")!.items.map((i) => i.key), [packed]);
    const shown = section.groups.flatMap((g) => g.items.map((i) => i.key));
    assert.ok(!shown.includes(sent));
    assert.equal(byId.get("sales-awaiting-payment")!.count, 2);
  });

  it("ages a row from when the sale entered its status, and opens the sale", async () => {
    const [row] = (await group("sales-to-pack")).items;
    assert.equal(row.at, day(5).toISOString());
    assert.equal(row.href, `sales/${paid}`);
  });

  it("states what the buyer pays: the lines plus handling, or the total where that is the anchor", async () => {
    const items = (await group("sales-awaiting-payment")).items;
    const withBuyer = items.find((i) => i.key === unpaidNew)!;
    assert.match(withBuyer.label, /^#\d+ · Anna Buyer$/);
    assert.equal(withBuyer.detail, "Delcampe · 4.50 EUR");
    assert.equal(items.find((i) => i.key === unpaidOld)!.detail, "Delcampe · 30.00 EUR");
  });

  it("is the very set the Sales list's status chip opens", async () => {
    for (const status of ["ordered", "paid", "packed"] as const) {
      const listed = await listSalesPaginated(userId, collectionId, { statuses: [status] });
      const g = (await sales()).groups.find((x) => x.href === `sales?status=${status}`)!;
      assert.deepEqual(
        g.items.map((i) => i.key).sort(),
        listed.items.map((s) => s.id).sort()
      );
    }
  });

  it("drops a sale from its group once it is moved on", async () => {
    await setSaleStatus(userId, paid, "packed");
    assert.equal((await group("sales-to-pack")).count, 0);
    const toSend = (await group("sales-to-send")).items.map((i) => i.key);
    // Entered `packed` just now, so it queues behind the one packed on the 6th.
    assert.deepEqual(toSend, [packed, paid]);
  });

  it("carries the bell's own platform-sale group, so the two never disagree", async () => {
    // A live Allegro listing the sync has seen an order for, with no sale recorded here (#499).
    const allegroId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformModule: "allegro" },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } })).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true }))
      .id;
    const offerId = await createOffer(userId, collectionId, {
      platformId: allegroId,
      url: null,
      listingType: "fixed",
      price: "20.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const boughtAt = day(4);
    const order = await prisma.allegroOrder.create({
      data: {
        collectionId,
        orderId: "D-1",
        status: "BOUGHT",
        paymentStatus: "unpaid",
        boughtAt,
        currency: "PLN",
        observedAt: new Date(),
      },
    });
    await prisma.allegroOrderLine.create({
      data: {
        collectionId,
        allegroOrderId: order.id,
        lineItemId: "D-1-1",
        platformOfferId: "1000D-1",
        title: "Listing",
        quantity: 1,
        unitPrice: "20.00",
        currency: "PLN",
        boughtAt,
        offerId,
        matchedBy: "external",
        observedAt: new Date(),
      },
    });

    const fromBell = (await getActionItems(userId, collectionId)).groups.find(
      (g) => g.id === "offer-platform-sale"
    )!;
    const onDashboard = await group("offer-platform-sale");
    assert.equal(onDashboard.count, 1);
    assert.deepEqual(onDashboard, {
      id: fromBell.id,
      title: "Sold on Allegro, no sale recorded",
      count: fromBell.count,
      items: fromBell.items,
      href: "offers?platformSale=1",
    });
    assert.equal(onDashboard.items[0].href, `offers/${offerId}`);
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(getDashboardSection(otherUserId, collectionId, "sales"));
  });
});
