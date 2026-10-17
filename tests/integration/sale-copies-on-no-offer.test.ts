import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  setOfferState,
  getOfferDetail,
  listOffersPaginated,
} from "../../src/lib/offers";
import {
  createSale,
  addSaleCopySet,
  getSaleDetail,
  listSaleLineSetOptions,
  listStockCopiesForSale,
  removeSaleLine,
  swapSaleLineSet,
  SaleActionBlockedError,
} from "../../src/lib/sales";

// Copies on no offer sold as one set on a sale (#2021, ADR-0013 §8). The line names no offer and no
// set, carries its copies and the price typed for them, and counts in the sale's figures like any
// other. Only copies in stock can be picked; one also held by an offer flags that offer as sold
// elsewhere; removing the line puts the copies back in stock.

describe("selling copies on no offer (#2021)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let offerId: string;
  let saleId: string;
  /** a: kept in the collection, not for sale · b: in an active offer · c: plain stock ·
   *  disposed: no longer held · inTransit: not yet in hand. */
  const ids: Record<"a" | "b" | "c" | "disposed" | "inTransit", string> = {
    a: "",
    b: "",
    c: "",
    disposed: "",
    inTransit: "",
  };
  let otherUserId: string;
  let foreignItemId: string;

  const blocked = (reason: string) => (e: unknown) =>
    e instanceof SaleActionBlockedError && e.reason === reason;

  const newSale = () =>
    createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-10-17"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });

  const stockIds = async () =>
    new Set((await listStockCopiesForSale(userId, collectionId)).map((c) => c.id));

  before(async () => {
    const ts = Date.now();
    userId = `test-user-no-offer-${ts}`;
    otherUserId = `test-user-no-offer-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const col = await prisma.collection.create({
      data: { slug: `col-no-offer-${ts}`, name: `Collection no-offer-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp N" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Fair" } })).id;

    const make = async (data: { forSale?: boolean; inCollection?: boolean } = {}) =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, ...data })).id;
    ids.a = await make({ inCollection: true, forSale: false });
    ids.b = await make({ forSale: true });
    ids.c = await make({ forSale: true });
    ids.disposed = await make();
    await prisma.item.update({ where: { id: ids.disposed }, data: { disposedAt: new Date() } });
    ids.inTransit = await make();
    await prisma.item.update({ where: { id: ids.inTransit }, data: { deliveryState: "in_transit" } });

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [ids.b]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");

    saleId = await newSale();

    const otherCol = await prisma.collection.create({
      data: { slug: `col-no-offer-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: otherUserId },
    });
    const otherStamp = await prisma.stamp.create({ data: { collectionId: otherCol.id, name: "Other" } });
    const otherCondition = await prisma.stampCondition.create({
      data: { collectionId: otherCol.id, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    foreignItemId = (
      await createItem(otherUserId, otherCol.id, { stampId: otherStamp.id, conditionId: otherCondition.id })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    for (const id of [userId, otherUserId]) {
      await prisma.collection.deleteMany({ where: { ownerId: id } });
      await prisma.user.delete({ where: { id } });
    }
  });

  it("offers every copy in stock, whatever it is kept for, and nothing else", async () => {
    const stock = await stockIds();
    assert.ok(stock.has(ids.a), "a copy kept in the collection can be sold");
    assert.ok(stock.has(ids.b), "a copy in an offer can be picked");
    assert.ok(stock.has(ids.c));
    assert.ok(!stock.has(ids.disposed), "a disposed copy is not in stock");
    assert.ok(!stock.has(ids.inTransit), "a copy still in the post is not in hand");
  });

  let lineId: string;

  it("adds the picked copies as one set with the typed price, naming no offer", async () => {
    lineId = await addSaleCopySet(userId, saleId, { itemIds: [ids.a, ids.b], price: "12.50" });

    const row = await prisma.saleLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { offerId: true, offerSetId: true, price: true, items: { select: { itemId: true } } },
    });
    assert.equal(row.offerId, null);
    assert.equal(row.offerSetId, null);
    assert.equal(Number(row.price), 12.5);
    assert.deepEqual(row.items.map((i) => i.itemId).sort(), [ids.a, ids.b].sort());

    const detail = await getSaleDetail(userId, saleId);
    assert.ok(detail);
    assert.equal(detail.lines.length, 1);
    const [line] = detail.lines;
    assert.equal(line.offerSetId, null);
    assert.equal(line.offerId, null);
    assert.equal(line.copyCount, 2);
    assert.ok(line.setLabel.length > 0, "the set is named by its copies");
    assert.equal(detail.grossProceeds, "12.50", "the set counts in the sale's totals");
    assert.equal(line.netBase, "12.50");

    const stock = await stockIds();
    assert.ok(!stock.has(ids.a) && !stock.has(ids.b), "the sold copies leave stock");
    assert.equal(await prisma.offer.count({ where: { collectionId } }), 1, "no offer is made");
  });

  it("flags the offer that also holds a sold copy, as for any sale elsewhere", async () => {
    const offer = await getOfferDetail(userId, offerId);
    assert.ok(offer);
    assert.equal(offer.sets[0].soldElsewhere, true);
    const rows = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.equal(rows.items.find((o) => o.id === offerId)?.soldCopyCount, 1);
  });

  it("takes several such sets on one sale, each a set of its own", async () => {
    const second = await addSaleCopySet(userId, saleId, { itemIds: [ids.c], price: "3.00" });
    const detail = await getSaleDetail(userId, saleId);
    assert.equal(detail?.lines.length, 2);
    assert.equal(detail?.grossProceeds, "15.50");
    await removeSaleLine(userId, second);
  });

  it("has no other set to choose", async () => {
    assert.equal(await listSaleLineSetOptions(userId, lineId), null);
    await assert.rejects(() => swapSaleLineSet(userId, lineId, "any"), blocked("no-offer"));
  });

  it("refuses copies that are not in stock, and an empty pick", async () => {
    await assert.rejects(() => addSaleCopySet(userId, saleId, { itemIds: [], price: "1.00" }), blocked("empty"));
    for (const itemId of [ids.a, ids.disposed, ids.inTransit, foreignItemId]) {
      await assert.rejects(
        () => addSaleCopySet(userId, saleId, { itemIds: [ids.c, itemId], price: "1.00" }),
        blocked("not-in-stock")
      );
    }
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 1, "nothing was written");
  });

  it("adds to a sent sale only when asked, by the sold sets' rule", async () => {
    const sent = await newSale();
    await prisma.sale.update({ where: { id: sent }, data: { status: "sent" } });
    await assert.rejects(
      () => addSaleCopySet(userId, sent, { itemIds: [ids.c], price: "1.00" }),
      blocked("sale-sent")
    );
    const added = await addSaleCopySet(userId, sent, { itemIds: [ids.c], price: "1.00" }, { toSentSale: true });
    await removeSaleLine(userId, added);
  });

  it("puts the copies back in stock when the set is removed, and the offer stops being flagged", async () => {
    await removeSaleLine(userId, lineId);
    const stock = await stockIds();
    assert.ok(stock.has(ids.a) && stock.has(ids.b));
    const offer = await getOfferDetail(userId, offerId);
    assert.equal(offer?.sets[0].soldElsewhere, false);
  });
});
