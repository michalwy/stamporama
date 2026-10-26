import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";
import {
  addSaleCopySet,
  addSaleLines,
  createSale,
  getSaleDetail,
  listSaleMoveTargets,
  moveSaleLines,
  SaleActionBlockedError,
  setSaleLineItemPacked,
  soldItemIds,
} from "../../src/lib/sales";
import { createPackingSupply, createPurchaseSupplyLine } from "../../src/lib/packing-supplies";
import { createSaleSupplyLine } from "../../src/lib/sale-supplies";

// Moving sold sets to another sale of the same buyer (#2204), read back out of Prisma: the sets move
// as they are — price, copies, packed state, offer — to a new sale or an open one of the buyer's;
// the sale's own amounts, supplies and conversation stay; nothing returns to stock and no offer
// changes; and a sent sale, every set, or a sale that is not the buyer's open one is refused. The
// refusals themselves are unit-tested (`tests/unit/sale-move-rules.test.ts`).

describe("moving sold sets to another sale (#2204)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let allegroId: string;
  let stampId: string;
  let conditionId: string;
  let supplyId: string;
  let buyerId: string;
  let otherBuyerId: string;

  const blocked = (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "cannot-move";

  async function newSale(data: { buyerId?: string | null; platformId?: string; soldAt?: string } = {}): Promise<string> {
    return createSale(userId, collectionId, {
      platformId: data.platformId ?? facebookId,
      buyerId: data.buyerId === undefined ? buyerId : data.buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(data.soldAt ?? "2026-10-20"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  }

  const newCopy = async () => (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** A set on no offer, priced, on `saleId`; answers its line id and copy. */
  async function looseSet(saleId: string, price: string): Promise<{ lineId: string; itemId: string }> {
    const itemId = await newCopy();
    await addSaleCopySet(userId, saleId, { itemIds: [itemId], price });
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId, items: { some: { itemId } } } });
    return { lineId: line.id, itemId };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sale-move-${ts}`;
    otherUserId = `test-user-sale-move-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-move-${ts}`, name: "Move", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    allegroId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro", platformCurrency: "PLN" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp V" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Ewa Kupująca", buyer: true } })).id;
    otherBuyerId = (await prisma.contact.create({ data: { collectionId, name: "Adam Inny", buyer: true } })).id;
    supplyId = await createPackingSupply(userId, collectionId, "C5 envelope");
    const purchaseId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: 1, purchasedAt: new Date("2026-01-01"), currency: "PLN" },
      })
    ).id;
    await createPurchaseSupplyLine(userId, purchaseId, { supplyId, quantity: 10, price: 5 });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    for (const id of [userId, otherUserId]) {
      await prisma.collection.deleteMany({ where: { ownerId: id } });
      await prisma.user.delete({ where: { id } });
    }
  });

  it("offers the buyer's other open sales on the same platform in the same currency, and nothing else", async () => {
    const here = await newSale();
    const open = await newSale();
    const elsewhere = await newSale({ platformId: allegroId });
    const someoneElse = await newSale({ buyerId: otherBuyerId });
    const sent = await newSale();
    await prisma.sale.update({ where: { id: sent }, data: { status: "sent" } });
    const euro = await newSale();
    await prisma.sale.update({ where: { id: euro }, data: { currency: "EUR" } });

    const ids = (await listSaleMoveTargets(userId, here)).map((c) => c.id);
    assert.ok(ids.includes(open));
    for (const id of [here, elsewhere, someoneElse, sent, euro]) assert.ok(!ids.includes(id));

    // A sale with no buyer has no other sale of theirs.
    assert.deepEqual(await listSaleMoveTargets(userId, await newSale({ buyerId: null })), []);
    await assert.rejects(() => listSaleMoveTargets(otherUserId, here), /not found/);
  });

  it("moves ticked sets to a new sale as they are, and leaves the sale's own amounts behind", async () => {
    const source = await newSale({ soldAt: "2026-10-19" });
    await prisma.sale.update({
      where: { id: source },
      data: {
        externalRef: "ORD-42",
        transactionUrl: "https://example.com/order/42",
        buyerPaidTotal: "70.00",
        commission: "3.00",
        shippingCost: "9.00",
        shippingCurrency: "PLN",
      },
    });
    await createSaleSupplyLine(userId, source, { supplyId, quantity: 1 });
    await prisma.conversationEntry.create({
      data: {
        collectionId,
        contactId: buyerId,
        saleId: source,
        occurredAt: new Date("2026-10-19T10:00:00Z"),
        channel: "messenger",
        direction: "incoming",
        summary: "Please send half later",
        author: "collector",
      },
    });

    // A set through an offer, packed; a set on no offer; and one that stays.
    const offered = await newCopy();
    const offerId = await createOffer(userId, collectionId, {
      platformId: facebookId,
      url: null,
      price: "30.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [offered]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const offerSet = await prisma.offerSet.findFirstOrThrow({ where: { offerId } });
    await addSaleLines(userId, source, [{ offerId, offerSetId: offerSet.id, price: "25.00", itemIds: [offered] }]);
    await setSaleLineItemPacked(userId, offered, true);
    const offeredLine = await prisma.saleLine.findFirstOrThrow({ where: { saleId: source, offerId } });
    const loose = await looseSet(source, "15.00");
    const staying = await looseSet(source, "20.00");

    const before = (await getSaleDetail(userId, source))!;
    assert.equal(before.buyerHandling, "10.00", "70 paid on 60 of sets");

    const moved = await moveSaleLines(userId, {
      sourceSaleId: source,
      lineIds: [offeredLine.id, loose.lineId],
      target: { newSale: true },
    });
    assert.equal(moved.created, true);
    assert.equal(moved.sourceSaleId, source);

    const target = (await getSaleDetail(userId, moved.targetSaleId))!;
    assert.deepEqual(target.lines.map((l) => l.id).sort(), [offeredLine.id, loose.lineId].sort());
    assert.deepEqual(target.lines.map((l) => l.price).sort(), ["15.00", "25.00"], "prices kept");
    // The same buyer, platform, currency, order number and date; status Ordered; none of the parcel.
    assert.equal(target.buyerId, buyerId);
    assert.equal(target.platformId, facebookId);
    assert.equal(target.currency, "PLN");
    assert.equal(target.externalRef, "ORD-42");
    assert.equal(target.soldAt.toISOString().slice(0, 10), "2026-10-19");
    assert.equal(target.status, "ordered");
    for (const amount of [target.buyerHandling, target.buyerPaidTotal, target.commission, target.shippingCost]) {
      assert.equal(amount, null);
    }
    assert.equal(target.supplies.lines.length, 0);
    assert.equal(target.apiReview, null, "a move in the app marks nothing");

    // The packed copy is still packed, on its new sale.
    const packed = await prisma.saleLineItem.findUniqueOrThrow({ where: { itemId: offered } });
    assert.equal(packed.packed, true);
    assert.equal(packed.saleLineId, offeredLine.id);

    // The source keeps its amounts, supplies and conversation; handling re-settles off the total paid.
    const after = (await getSaleDetail(userId, source))!;
    assert.deepEqual(after.lines.map((l) => l.id), [staying.lineId]);
    assert.equal(after.buyerPaidTotal, "70.00");
    assert.equal(after.buyerHandling, "50.00", "70 paid on the 20 left");
    assert.equal(after.commission, "3.00");
    assert.equal(after.shippingCost, "9.00");
    assert.equal(after.supplies.lines.length, 1);
    assert.equal(await prisma.conversationEntry.count({ where: { saleId: source } }), 1);

    // Nothing returns to stock and no offer changes.
    assert.deepEqual(
      [...(await soldItemIds([offered, loose.itemId, staying.itemId]))].sort(),
      [offered, loose.itemId, staying.itemId].sort()
    );
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).state, "sold");

    // And back again, into the open source.
    const back = await moveSaleLines(userId, {
      sourceSaleId: moved.targetSaleId,
      lineIds: [loose.lineId],
      target: { saleId: source },
    });
    assert.equal(back.created, false);
    assert.equal((await getSaleDetail(userId, source))!.lines.length, 2);
  });

  it("refuses a sent sale, every set, nothing, a sale that is not the buyer's open one, and another collector", async () => {
    const source = await newSale();
    const a = await looseSet(source, "5.00");
    const b = await looseSet(source, "6.00");
    const move = (lineIds: string[], target: { saleId: string } | { newSale: true }, owner = userId) =>
      moveSaleLines(owner, { sourceSaleId: source, lineIds, target });

    await assert.rejects(() => move([a.lineId, b.lineId], { newSale: true }), blocked);
    await assert.rejects(() => move([], { newSale: true }), blocked);
    await assert.rejects(() => move([a.lineId], { saleId: source }), blocked);
    const otherBuyers = await newSale({ buyerId: otherBuyerId });
    await assert.rejects(() => move([a.lineId], { saleId: otherBuyers }), blocked);
    const otherPlatform = await newSale({ platformId: allegroId });
    await assert.rejects(() => move([a.lineId], { saleId: otherPlatform }), blocked);
    const sentTarget = await newSale();
    await prisma.sale.update({ where: { id: sentTarget }, data: { status: "sent" } });
    await assert.rejects(() => move([a.lineId], { saleId: sentTarget }), blocked);
    // A line of another sale is not this sale's to move.
    const elsewhere = await looseSet(await newSale(), "7.00");
    await assert.rejects(() => move([elsewhere.lineId], { newSale: true }), blocked);
    await assert.rejects(() => move([a.lineId], { newSale: true }, otherUserId), /not found/);

    await prisma.sale.update({ where: { id: source }, data: { status: "sent" } });
    await assert.rejects(() => move([a.lineId], { newSale: true }), blocked);

    // Every refusal left the lines where they were.
    assert.equal(await prisma.saleLine.count({ where: { saleId: source } }), 2);
  });
});
