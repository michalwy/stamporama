import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";
import { createSale, addSaleLines, listSalesPaginated, SaleActionBlockedError } from "../../src/lib/sales";
import { UNSENT_SALE_STATUSES } from "../../src/lib/sale-status";

// The *Sell* dialog adds only to sales still open (#1950). A sale already *Sent* or *Delivered* takes
// more sold sets only when the caller says so — the dialog's *Show sent sales too*, the sale's own
// screen — so no surface adds to a parcel that has gone by accident. The list the dialog reads is the
// ordinary sales list narrowed to the unsent statuses, newest first.

describe("adding sold sets to a sent sale (#1950)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let offerId: string;
  const setIds: string[] = [];
  const itemIds: string[] = [];

  const newSale = (soldAt: Date) =>
    createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt,
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  const line = (i: number) => [{ offerId, offerSetId: setIds[i], price: "5.00", itemIds: [itemIds[i]] }];

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sent-sale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User sent-sale-${ts}`,
        email: `test-sent-sale-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-sent-sale-${ts}`, name: `Collection sent-sale-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp S" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (let i = 0; i < 3; i++) {
      const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true });
      itemIds.push(item.id);
      setIds.push(await addOfferSet(userId, offerId, [item.id]));
    }
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("refuses a sent or delivered sale unless asked for, and takes it when asked", async () => {
    const sent = await newSale(new Date("2026-10-01"));
    await prisma.sale.update({ where: { id: sent }, data: { status: "sent" } });
    const delivered = await newSale(new Date("2026-10-02"));
    await prisma.sale.update({ where: { id: delivered }, data: { status: "received" } });

    for (const saleId of [sent, delivered]) {
      await assert.rejects(
        () => addSaleLines(userId, saleId, line(0)),
        (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "sale-sent"
      );
    }
    assert.equal(await prisma.saleLine.count({ where: { saleId: { in: [sent, delivered] } } }), 0);

    await addSaleLines(userId, sent, line(0), { toSentSale: true });
    assert.equal(await prisma.saleLine.count({ where: { saleId: sent } }), 1);
  });

  it("adds to an open sale without being asked", async () => {
    const packed = await newSale(new Date("2026-10-03"));
    await prisma.sale.update({ where: { id: packed }, data: { status: "packed" } });
    await addSaleLines(userId, packed, line(1));
    assert.equal(await prisma.saleLine.count({ where: { saleId: packed } }), 1);
  });

  it("lists only the unsent sales, newest first, for the Sell dialog", async () => {
    const ordered = await newSale(new Date("2026-10-05"));
    const paid = await newSale(new Date("2026-10-04"));
    await prisma.sale.update({ where: { id: paid }, data: { status: "paid" } });

    const open = await listSalesPaginated(userId, collectionId, {
      platformId,
      statuses: [...UNSENT_SALE_STATUSES],
    });
    assert.deepEqual(
      open.items.map((s) => s.status),
      ["ordered", "paid", "packed"],
      "sent and delivered sales are left out; the rest come newest first"
    );
    assert.equal(open.items[0].id, ordered);

    const all = await listSalesPaginated(userId, collectionId, { platformId });
    assert.equal(all.items.length, 5, "without the filter the sent and delivered sales come back");
  });
});
