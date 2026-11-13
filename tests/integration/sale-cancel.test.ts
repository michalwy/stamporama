import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import {
  addSaleLines,
  cancelSale,
  cancelSaleThroughApi,
  countBuyerCancelledSales,
  createSale,
  deleteSale,
  getSaleDetail,
  listSaleProfitRows,
  listSalesPaginated,
  setSaleStatus,
  updateSaleNote,
  SaleActionBlockedError,
} from "../../src/lib/sales";
import { getContactPage } from "../../src/lib/contact-page";
import { getOverviewValue } from "../../src/lib/overview";
import { createPackingSupply, createPurchaseSupplyLine, getSuppliesStock } from "../../src/lib/packing-supplies";
import { createSaleSupplyLine } from "../../src/lib/sale-supplies";

// A sale can be cancelled, not only deleted (#2500, ADR-0082). The issue's *Done when*, held here:
//
//   - cancelling an *Ordered* sale of three offers, two back to active and one withdrawn, keeps the
//     sale as *Cancelled* with reason *Not paid*; the two offers are active and out of step with
//     their listings, the third withdrawn, and every copy free;
//   - the sale counts in no revenue, profit or figure, and is on the Sales list with its status;
//   - the buyer's contact shows one cancelled sale, and the count a new sale warns with is one;
//   - *Delete sale* still deletes without a trace.

const TODAY = new Date().toISOString().slice(0, 10);

describe("cancelling a sale (#2500)", () => {
  const TS = Date.now();
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let buyerId: string;
  let envelopeId: string;
  let nextPurchaseNo = 1;

  before(async () => {
    for (const id of [`test-user-cancel-${TS}`, `test-user-cancel-other-${TS}`]) {
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
    userId = `test-user-cancel-${TS}`;
    otherUserId = `test-user-cancel-other-${TS}`;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-cancel-${TS}`, name: `Cancel ${TS}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp C" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Nowak", buyer: true } })).id;
    envelopeId = await createPackingSupply(userId, collectionId, "C6 envelope");
    const purchaseId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: nextPurchaseNo++, purchasedAt: new Date("2026-01-01"), currency: "EUR" },
      })
    ).id;
    await createPurchaseSupplyLine(userId, purchaseId, { supplyId: envelopeId, quantity: 10, price: 0.5 });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const copy = async () => (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** A live offer of one single-copy set. */
  async function activeOffer(): Promise<{ offerId: string; setId: string; itemId: string }> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
    });
    const itemId = await copy();
    const setId = await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return { offerId, setId, itemId };
  }

  async function sale(buyer: string | null = buyerId): Promise<string> {
    return createSale(userId, collectionId, {
      platformId,
      buyerId: buyer,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: "2.00",
      buyerPaidTotal: null,
      commission: "1.00",
    });
  }

  /** A sale of `n` offers, each sold whole — every offer closed by it. */
  async function saleOf(n: number, buyer: string | null = buyerId) {
    const offers = [];
    for (let i = 0; i < n; i++) offers.push(await activeOffer());
    const saleId = await sale(buyer);
    await addSaleLines(
      userId,
      saleId,
      offers.map((o) => ({ offerId: o.offerId, offerSetId: o.setId, price: "5.00", itemIds: [o.itemId] }))
    );
    return { saleId, offers };
  }

  const envelopeOnHand = async () =>
    (await getSuppliesStock(userId, collectionId)).supplies.find((s) => s.id === envelopeId)!.onHand;

  it("keeps an Ordered sale as Cancelled, two offers back to active, one withdrawn, every copy free", async () => {
    const { saleId, offers } = await saleOf(3);
    await createSaleSupplyLine(userId, saleId, { supplyId: envelopeId, quantity: 2 });
    const stockBefore = await envelopeOnHand();
    for (const o of offers) {
      assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: o.offerId } })).state, "sold");
    }

    const result = await cancelSale(userId, saleId, {
      reason: "Not paid",
      offerOutcomes: { [offers[2].offerId]: "withdrawn" },
    });
    assert.deepEqual(result.activeOfferIds.sort(), [offers[0].offerId, offers[1].offerId].sort());
    assert.deepEqual(result.withdrawnOfferIds, [offers[2].offerId]);

    const row = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { status: true, cancelReason: true, cancelledAt: true, statusEvents: { select: { status: true } } },
    });
    assert.equal(row.status, "cancelled");
    assert.equal(row.cancelReason, "Not paid");
    assert.ok(row.cancelledAt);
    assert.ok(row.statusEvents.some((e) => e.status === "cancelled"), "the timeline records the cancel");

    for (const o of offers.slice(0, 2)) {
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id: o.offerId } });
      assert.equal(offer.state, "active");
      assert.equal(offer.closedAt, null);
      assert.ok(offer.listingContentChangedAt, "an offer back to active is out of step with its listing");
    }
    const withdrawn = await prisma.offer.findUniqueOrThrow({ where: { id: offers[2].offerId } });
    assert.equal(withdrawn.state, "withdrawn");
    assert.ok(withdrawn.closedAt);

    // Every copy is free: no sale line holds it, so it can be sold again.
    const held = await prisma.saleLineItem.count({ where: { itemId: { in: offers.map((o) => o.itemId) } } });
    assert.equal(held, 0);
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 0);
    // The packing supplies went back to stock.
    assert.equal(await envelopeOnHand(), stockBefore + 2);

    // The record keeps what the buyer had bought, as the sale named it, with each offer's outcome.
    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.status, "cancelled");
    assert.equal(detail.cancelReason, "Not paid");
    assert.equal(detail.lines.length, 0);
    assert.equal(detail.netProceeds, "0.00");
    assert.deepEqual(
      detail.cancelledLines.map((l) => [l.offerId, l.price, l.offerOutcome]),
      [
        [offers[0].offerId, "5.00", "active"],
        [offers[1].offerId, "5.00", "active"],
        [offers[2].offerId, "5.00", "withdrawn"],
      ]
    );
    assert.ok(detail.cancelledLines.every((l) => l.title.length > 0 && l.offerNo !== null));

    // A copy back on an active offer sells again.
    const again = await sale();
    await addSaleLines(userId, again, [
      { offerId: offers[0].offerId, offerSetId: offers[0].setId, price: "5.00", itemIds: [offers[0].itemId] },
    ]);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offers[0].offerId } })).state, "sold");
    await deleteSale(userId, again);
  });

  it("counts nowhere, and is on the Sales list as Cancelled", async () => {
    const { saleId } = await saleOf(1);
    const profitBefore = await listSaleProfitRows(collectionId, "EUR");
    assert.ok(profitBefore.some((r) => r.id === saleId));
    const overviewBefore = await getOverviewValue(userId, collectionId);

    await cancelSale(userId, saleId, { reason: null, offerOutcomes: {} });

    const profitAfter = await listSaleProfitRows(collectionId, "EUR");
    assert.ok(!profitAfter.some((r) => r.id === saleId), "no profit row for a cancelled sale");
    const overviewAfter = await getOverviewValue(userId, collectionId);
    assert.equal(overviewAfter.realized.saleCount, overviewBefore.realized.saleCount - 1);

    const all = await listSalesPaginated(userId, collectionId, {});
    const listed = all.items.find((s) => s.id === saleId)!;
    assert.equal(listed.status, "cancelled");
    assert.equal(listed.netProceeds, "0.00");
    assert.equal(listed.lineCount, 1);
    const onlyCancelled = await listSalesPaginated(userId, collectionId, { statuses: ["cancelled"] });
    assert.ok(onlyCancelled.items.every((s) => s.status === "cancelled"));
    assert.ok(onlyCancelled.items.some((s) => s.id === saleId));
    const ordered = await listSalesPaginated(userId, collectionId, { statuses: ["ordered"] });
    assert.ok(!ordered.items.some((s) => s.id === saleId));
  });

  it("shows on the buyer's contact as cancelled, and in no other figure there", async () => {
    const buyer = (await prisma.contact.create({ data: { collectionId, name: "Anna Kowalska", buyer: true } })).id;
    const kept = await saleOf(1, buyer);
    const { saleId } = await saleOf(2, buyer);
    assert.equal(await countBuyerCancelledSales(userId, collectionId, buyer), 0);

    await cancelSale(userId, saleId, { reason: "Not paid", offerOutcomes: {} });

    const page = (await getContactPage(userId, buyer, "all", TODAY))!;
    assert.equal(page.sales!.cancelledCount, 1);
    assert.equal(page.sales!.count, 1);
    assert.deepEqual(page.sales!.rows.map((r) => r.id), [kept.saleId]);
    assert.equal(page.sales!.copyCount, 1);
    // The count a new sale to this buyer warns with.
    assert.equal(await countBuyerCancelledSales(userId, collectionId, buyer), 1);
    await assert.rejects(countBuyerCancelledSales(otherUserId, collectionId, buyer));
  });

  it("refuses a sale already sent, and a second cancel", async () => {
    const { saleId } = await saleOf(1);
    await setSaleStatus(userId, saleId, "sent");
    await assert.rejects(cancelSale(userId, saleId, { reason: null, offerOutcomes: {} }), SaleActionBlockedError);

    const other = await saleOf(1);
    await cancelSale(userId, other.saleId, { reason: null, offerOutcomes: {} });
    await assert.rejects(
      cancelSale(userId, other.saleId, { reason: null, offerOutcomes: {} }),
      /already cancelled/
    );
  });

  it("is never reopened, and takes no more sets — but its note can still be written", async () => {
    const { saleId } = await saleOf(1);
    await cancelSale(userId, saleId, { reason: null, offerOutcomes: {} });
    await assert.rejects(setSaleStatus(userId, saleId, "ordered"), /cancelled/);
    const fresh = await activeOffer();
    await assert.rejects(
      addSaleLines(
        userId,
        saleId,
        [{ offerId: fresh.offerId, offerSetId: fresh.setId, price: "5.00", itemIds: [fresh.itemId] }],
        { toSentSale: true }
      ),
      /cancelled/
    );
    await assert.rejects(createSaleSupplyLine(userId, saleId, { supplyId: envelopeId, quantity: 1 }), /cancelled/);
    await updateSaleNote(userId, saleId, "Buyer stopped answering.");
    assert.equal((await getSaleDetail(userId, saleId))!.note, "Buyer stopped answering.");
  });

  it("is not another collector's to cancel", async () => {
    const { saleId } = await saleOf(1);
    await assert.rejects(cancelSale(otherUserId, saleId, { reason: null, offerOutcomes: {} }), /not found/);
    assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).status, "ordered");
  });

  it("through the agent API, marks the sale to review with what it did", async () => {
    const { saleId, offers } = await saleOf(2);
    await cancelSaleThroughApi(userId, collectionId, saleId, {
      reason: "Not paid",
      offerOutcomes: { [offers[1].offerId]: "withdrawn" },
    });
    const row = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    assert.equal(row.status, "cancelled");
    assert.ok(row.apiReviewAt);
    assert.deepEqual(row.apiReviewActions, ["cancelled the sale — 1 offer back to active, 1 withdrawn"]);
  });

  it("leaves Delete sale deleting without a trace — an open sale, and a cancelled one", async () => {
    const open = await saleOf(1);
    await deleteSale(userId, open.saleId);
    assert.equal(await prisma.sale.count({ where: { id: open.saleId } }), 0);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: open.offers[0].offerId } })).state, "active");

    const cancelled = await saleOf(1);
    await cancelSale(userId, cancelled.saleId, { reason: null, offerOutcomes: {} });
    await deleteSale(userId, cancelled.saleId);
    assert.equal(await prisma.sale.count({ where: { id: cancelled.saleId } }), 0);
    assert.equal(await prisma.saleCancelledLine.count({ where: { saleId: cancelled.saleId } }), 0);
  });
});
