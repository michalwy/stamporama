import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createPurchase, getPurchaseReturn, getLotReturn } from "../../src/lib/purchases";

// A purchase order's ROI (#559): what it cost, read against what selling its copies has actually
// brought back. Exercises the three attribution cases end to end — a sale line made wholly of one
// order's copies, a mixed line split by catalogue weight, and a mixed line that cannot be split at
// all — plus the sold/unsold split the figures are stated with.
//
// Cost-basis is written here directly rather than through `closeLot`: freezing it is #121's
// allocation and has its own test (`lot-close-cost-basis`), and flat round snapshots make what each
// return figure claims readable in the assertions.

const TS = Date.now();

describe("purchase return (spent vs. realized)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let purchaseA: string;
  let purchaseB: string;
  // Purchase A's two lots: the first holds the copies the order-level cases use, the second one
  // copy, so a line spanning both exercises the lot boundary inside one order.
  let lotA1: string, lotA2: string;
  // Purchase A's copies: two sold whole, one on a mixed line, one on a blocked one, then the pair
  // (`a5` in the first lot, `a6` in the second) sold together across the two lots.
  let a1: string, a2: string, a3: string, a4: string, a5: string, a6: string;
  // Purchase B's copies: the other side of the two mixed lines. `b2` is deliberately unpriced.
  let b1: string, b2: string;

  let nextItemNo = 1;
  let nextNo = 9000;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-poreturn-${TS}`,
          name: "Test User PO Return",
          email: `test-poreturn-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    const col = await prisma.collection.create({
      data: { slug: `col-poreturn-${TS}`, name: "PO Return", baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true },
      })
    ).id;

    // Catalogue chain, so a copy resolves the primary-catalog price the mixed-line split weighs by.
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    async function stamp(name: string, price: string | null) {
      const row = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: row.id, collectionAreaId: area.id, isPrimary: true },
      });
      if (price != null) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: row.id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      return row.id;
    }
    const cheap = await stamp("Cheap", "1.00");
    const dear = await stamp("Dear", "9.00");
    const unpriced = await stamp("Unpriced", null);

    async function newOrder() {
      const purchase = await createPurchase(userId, collectionId, {
        currency: "EUR",
        purchasedAt: "2026-01-01",
      });
      return purchase.id;
    }

    /** A closed lot of the given stamps, every copy costing a flat 10.00. */
    async function lotOf(purchaseId: string, stamps: string[]) {
      const lot = await prisma.purchaseLot.create({
        data: { purchaseId, price: "40.00", status: "closed" },
        select: { id: true },
      });
      const ids: string[] = [];
      for (const stampId of stamps) {
        const item = await prisma.item.create({
          data: {
            collectionId,
            itemNo: nextItemNo++,
            stampId,
            conditionId,
            lotId: lot.id,
            costBasis: "10.00",
          },
          select: { id: true },
        });
        ids.push(item.id);
      }
      return { lotId: lot.id, ids };
    }

    purchaseA = await newOrder();
    const first = await lotOf(purchaseA, [cheap, cheap, cheap, cheap, cheap]);
    lotA1 = first.lotId;
    [a1, a2, a3, a4, a5] = first.ids;
    const second = await lotOf(purchaseA, [dear]);
    lotA2 = second.lotId;
    [a6] = second.ids;

    purchaseB = await newOrder();
    [b1, b2] = (await lotOf(purchaseB, [dear, unpriced])).ids;
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** One sale of one line, carrying the given copies. Amounts are in the base currency, so no
   * exchange-rate fixture is needed and the net is readable off the arithmetic. */
  async function sell(
    itemIds: string[],
    price: string,
    extra: { commission?: string; shippingCost?: string } = {}
  ) {
    const no = nextNo++;
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: no, platformId, currency: "EUR", price },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: {
        collectionId,
        saleNo: no,
        platformId,
        soldAt: new Date("2026-03-01"),
        currency: "EUR",
        commission: extra.commission ?? null,
        shippingCost: extra.shippingCost ?? null,
        shippingCurrency: extra.shippingCost ? "EUR" : null,
      },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price },
    });
    for (const itemId of itemIds) {
      await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    }
  }

  it("reads as a whole-order loss while nothing has sold", async () => {
    const ret = await getPurchaseReturn(userId, purchaseB);
    assert.equal(ret.baseCurrency, "EUR");
    assert.equal(ret.copyCount, 2);
    assert.equal(ret.soldCount, 0);
    assert.equal(ret.realized, "0.00");
    assert.equal(ret.spent.totalCostBasis, "20.00");
    assert.equal(ret.netReturn, "-20.00");
    assert.equal(ret.netReturnPercent, -100);
  });

  it("takes a line made wholly of the order's copies net of commission and shipping", async () => {
    // 60.00 − 10.00 commission − 5.00 shipping = 45.00, for two copies costing 10.00 each.
    await sell([a1, a2], "60.00", { commission: "10.00", shippingCost: "5.00" });

    const ret = await getPurchaseReturn(userId, purchaseA);
    assert.equal(ret.copyCount, 6);
    assert.equal(ret.soldCount, 2);
    assert.equal(ret.unattributedCount, 0);
    assert.equal(ret.realized, "45.00");
    assert.equal(ret.spent.totalCostBasis, "60.00");
    assert.equal(ret.soldCost.totalCostBasis, "20.00");
    // The order as a whole is still 15.00 down with four copies unsold; the two that left made
    // 25.00 on a 20.00 cost. Neither figure answers the other, which is why both are reported.
    assert.equal(ret.netReturn, "-15.00");
    assert.equal(ret.soldMargin, "25.00");
    assert.equal(ret.soldMarginPercent, 125);
  });

  it("splits a line shared with another order by catalogue weight", async () => {
    // Cheap (1.00) beside dear (9.00): a tenth of the 100.00 net belongs to purchase A.
    await sell([a3, b1], "100.00");

    const a = await getPurchaseReturn(userId, purchaseA);
    assert.equal(a.soldCount, 3);
    assert.equal(a.realized, "55.00");

    const b = await getPurchaseReturn(userId, purchaseB);
    assert.equal(b.soldCount, 1);
    assert.equal(b.realized, "90.00");
  });

  it("counts a copy on an unsplittable shared line as sold, but claims none of its proceeds", async () => {
    // `b2` carries no catalogue price, so the line cannot be split at all (ADR-0012 §6.3).
    await sell([a4, b2], "50.00");

    const a = await getPurchaseReturn(userId, purchaseA);
    assert.equal(a.copyCount, 6);
    assert.equal(a.soldCount, 4);
    assert.equal(a.unattributedCount, 1);
    // Unchanged: the blocked line contributes nothing rather than a phantom zero-cost sale.
    assert.equal(a.realized, "55.00");
    assert.equal(a.soldCost.totalCostBasis, "40.00");

    const b = await getPurchaseReturn(userId, purchaseB);
    assert.equal(b.soldCount, 2);
    assert.equal(b.unattributedCount, 1);
    assert.equal(b.realized, "90.00");
  });

  it("splits a line spanning two lots of one order between them, whole to the order", async () => {
    // `a5` (cheap, 1.00) and `a6` (dear, 9.00) leave together for 100.00. The order owns the line
    // outright, so it takes all 100.00; the two lots split it by the same catalogue weight a line
    // shared with another purchase would be split by.
    await sell([a5, a6], "100.00");

    const order = await getPurchaseReturn(userId, purchaseA);
    assert.equal(order.soldCount, 6);
    assert.equal(order.realized, "155.00");

    const first = await getLotReturn(userId, lotA1);
    assert.equal(first.copyCount, 5);
    assert.equal(first.soldCount, 5);
    assert.equal(first.unattributedCount, 1);
    // 45.00 whole-line + 10.00 of the shared line + a tenth of this one; the blocked line adds
    // nothing. Cost 10.00 a copy, all five sold.
    assert.equal(first.realized, "65.00");
    assert.equal(first.spent.totalCostBasis, "50.00");
    assert.equal(first.netReturn, "15.00");
    assert.equal(first.soldMargin, "15.00");

    const second = await getLotReturn(userId, lotA2);
    assert.equal(second.copyCount, 1);
    assert.equal(second.soldCount, 1);
    assert.equal(second.realized, "90.00");
    assert.equal(second.spent.totalCostBasis, "10.00");
    assert.equal(second.netReturn, "80.00");
    assert.equal(second.netReturnPercent, 800);
  });

  it("refuses a lot in someone else's collection", async () => {
    await assert.rejects(() => getLotReturn(`${userId}-stranger`, lotA1), /not found|denied/i);
  });
});
