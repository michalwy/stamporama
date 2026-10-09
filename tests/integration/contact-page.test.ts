import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getContactPage } from "../../src/lib/contact-page";

// A contact's own page (#1708, its auctions section #1709), read back out of Prisma: which transactions each section counts,
// that the period narrows every figure, that a section shows by role **or** by data, and the money
// rules — the order totals with their shipping (#852), the share of catalogue (#1395), and a total
// that cannot be stated in the base currency stated as absent rather than partial.

const TS = Date.now();
const TODAY = "2026-10-09";

describe("contact page (#1708)", () => {
  let userId: string;
  let collectionId: string;
  /** A supplier created on the fly — no roles, three purchases. */
  let sellerId: string;
  /** A buyer with two sales and no purchases. */
  let buyerId: string;
  /** A contact with the Buyer role and nothing recorded. */
  let newBuyerId: string;
  let latestPurchaseId: string;
  /** An auction house with two tracked sales, one this year and one last. */
  let houseId: string;
  /** An auction house with nothing tracked yet. */
  let newHouseId: string;
  let houseSaleId: string;

  before(async () => {
    userId = `test-user-contactpage-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactpage-${TS}`, name: "Contact page", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
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
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Priced" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: null,
        price: "2.00",
        currency: "EUR",
      },
    });

    sellerId = (await prisma.contact.create({ data: { collectionId, name: "On the fly" } })).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Buyer", buyer: true } })).id;
    newBuyerId = (await prisma.contact.create({ data: { collectionId, name: "New buyer", buyer: true } }))
      .id;
    const otherId = (await prisma.contact.create({ data: { collectionId, name: "Someone else" } })).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;

    // This year, arrived: 10 EUR + 2 EUR shipping over two copies at 2 EUR each, closed — 12 against 4.
    const arrived = (
      await createPurchase(userId, collectionId, {
        contactId: sellerId,
        purchasedAt: "2026-09-01",
        currency: "EUR",
        shippingCost: 2,
        status: "arrived",
      })
    ).id;
    const lotId = await createLot(userId, arrived, 10, null);
    await intakeStamps(userId, { lotId }, { stampId, conditionId });
    await intakeStamps(userId, { lotId }, { stampId, conditionId });
    assert.equal((await closeLot(userId, lotId)).ok, true);

    // This year, still being prepared: 5 EUR, nothing in it yet.
    latestPurchaseId = (
      await createPurchase(userId, collectionId, {
        contactId: sellerId,
        purchasedAt: "2026-10-01",
        currency: "EUR",
        status: "preparing",
      })
    ).id;
    await createLot(userId, latestPurchaseId, 5, null);

    // Last year, in US dollars with no rate recorded: in no base-currency total.
    const usd = (
      await createPurchase(userId, collectionId, {
        contactId: sellerId,
        purchasedAt: "2025-01-15",
        currency: "EUR",
        status: "completed",
      })
    ).id;
    await createLot(userId, usd, 40, null);
    await prisma.purchase.update({ where: { id: usd }, data: { currency: "USD", fxRateToBase: null } });

    // Someone else's purchase, which no figure here may count.
    const others = (
      await createPurchase(userId, collectionId, {
        contactId: otherId,
        purchasedAt: "2026-09-02",
        currency: "EUR",
        status: "preparing",
      })
    ).id;
    await createLot(userId, others, 99, null);

    // Two sales to the buyer this year — one still ordered, one sent — and one last year.
    const sale = (data: {
      saleNo: number;
      soldAt: string;
      currency: string;
      fxRateToBase?: string;
      buyerHandling: string;
      status: string;
      buyer?: string;
    }) =>
      prisma.sale.create({
        data: {
          collectionId,
          platformId,
          buyerId: data.buyer ?? buyerId,
          saleNo: data.saleNo,
          soldAt: new Date(`${data.soldAt}T00:00:00.000Z`),
          currency: data.currency,
          fxRateToBase: data.fxRateToBase ?? null,
          buyerHandling: data.buyerHandling,
          status: data.status,
        },
      });
    await sale({ saleNo: 1, soldAt: "2026-09-10", currency: "EUR", buyerHandling: "5.00", status: "ordered" });
    await sale({
      saleNo: 2,
      soldAt: "2026-05-01",
      currency: "GBP",
      fxRateToBase: "1.2",
      buyerHandling: "10.00",
      status: "sent",
    });
    await sale({ saleNo: 3, soldAt: "2024-12-31", currency: "EUR", buyerHandling: "7.00", status: "received" });
    await sale({
      saleNo: 4,
      soldAt: "2026-09-11",
      currency: "EUR",
      buyerHandling: "100.00",
      status: "ordered",
      buyer: otherId,
    });

    // Auctions (#1709). The house's sale this year, in the base currency: 20% + 1 EUR a lot, 5 EUR
    // shipping. One lot of each outcome; the open one is waiting for review.
    houseId = (
      await prisma.contact.create({ data: { collectionId, name: "House", auctionHouse: true } })
    ).id;
    newHouseId = (
      await prisma.contact.create({ data: { collectionId, name: "New house", auctionHouse: true } })
    ).id;
    const auctionSale = (data: {
      sellerId: string;
      createdAt: string;
      currency: string;
      premiumPercent?: string;
      premiumFixed?: string;
      shippingCost?: string;
    }) =>
      prisma.auctionSale.create({
        data: {
          collectionId,
          sellerId: data.sellerId,
          platformId,
          name: `Sale ${data.createdAt}`,
          currency: data.currency,
          premiumPercent: data.premiumPercent ?? null,
          premiumFixed: data.premiumFixed ?? null,
          shippingCost: data.shippingCost ?? null,
          createdAt: new Date(`${data.createdAt}T12:00:00.000Z`),
        },
      });
    let lotNo = 0;
    const auctionLot = (
      auctionSaleId: string,
      data: {
        status: string;
        myBid?: string;
        finalPrice?: string;
        currentBid?: string;
        fxRateToBase?: string;
        apiReviewAt?: Date;
      }
    ) =>
      prisma.auctionLot.create({
        data: {
          auctionSaleId,
          auctionLotNo: ++lotNo,
          endsAt: new Date("2026-10-20T12:00:00.000Z"),
          status: data.status,
          myBid: data.myBid ?? null,
          finalPrice: data.finalPrice ?? null,
          currentBid: data.currentBid ?? null,
          fxRateToBase: data.fxRateToBase ?? null,
          apiReviewAt: data.apiReviewAt ?? null,
        },
      });
    houseSaleId = (
      await auctionSale({
        sellerId: houseId,
        createdAt: "2026-09-01",
        currency: "EUR",
        premiumPercent: "20",
        premiumFixed: "1",
        shippingCost: "5",
      })
    ).id;
    // Won at 50: 50 + 10 + 1 = 61 all-in.
    await auctionLot(houseSaleId, { status: "closed", myBid: "100", finalPrice: "50" });
    await auctionLot(houseSaleId, { status: "closed", myBid: "30", finalPrice: "40" });
    // Open at a 10 bid: 13 all-in, the ceiling following the bid.
    await auctionLot(houseSaleId, { status: "open", myBid: "10", currentBid: "5", apiReviewAt: new Date() });
    await auctionLot(houseSaleId, { status: "cancelled" });
    // Only watched: neither won nor lost.
    await auctionLot(houseSaleId, { status: "closed", finalPrice: "20" });

    // Last year, in pounds at a frozen 1.2: won at 80 + 10% = 88, plus 2 shipping.
    const lastYear = (
      await auctionSale({
        sellerId: houseId,
        createdAt: "2025-03-01",
        currency: "GBP",
        premiumPercent: "10",
        shippingCost: "2",
      })
    ).id;
    await auctionLot(lastYear, { status: "closed", myBid: "100", finalPrice: "80", fxRateToBase: "1.2" });
    await auctionLot(lastYear, { status: "closed", myBid: "10", finalPrice: "20", fxRateToBase: "1.2" });

    // Someone else's sale, which nothing here may count.
    const elsewhere = (await auctionSale({ sellerId: otherId, createdAt: "2026-09-02", currency: "EUR" })).id;
    await auctionLot(elsewhere, { status: "closed", myBid: "100", finalPrice: "70" });
    await auctionLot(elsewhere, { status: "open", myBid: "50", apiReviewAt: new Date() });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("shows a role-less supplier's purchases, and no sales section it has neither role nor data for", async () => {
    const page = await getContactPage(userId, sellerId, "all", TODAY);
    assert.ok(page);
    assert.ok(page.purchases);
    assert.equal(page.sales, null);
  });

  it("shows a section for the role alone, before anything is recorded", async () => {
    const page = await getContactPage(userId, newBuyerId, "all", TODAY);
    assert.ok(page?.sales);
    assert.equal(page.sales.count, 0);
    assert.equal(page.sales.lastSoldAt, null);
    assert.equal(page.purchases, null);
  });

  it("narrows every purchase figure to the period", async () => {
    const page = await getContactPage(userId, sellerId, "year", TODAY);
    const p = page!.purchases!;
    assert.equal(p.count, 2);
    // The order totals, shipping included (#852): 12 + 5.
    assert.deepEqual(p.spent, { baseCurrency: "EUR", base: "17.00", unconvertedCount: 0, tx: null });
    assert.equal(p.copyCount, 2);
    assert.equal(p.lastPurchasedAt, "2026-10-01");
    assert.equal(p.lastPurchaseId, latestPurchaseId);
    assert.equal(p.notDeliveredCount, 1);
    assert.deepEqual(
      p.rows.map((r) => [r.purchasedAt, r.total, r.copyCount]),
      [
        ["2026-10-01", "5.00", 0],
        ["2026-09-01", "12.00", 2],
      ]
    );
  });

  it("reads the share of catalogue over the lots that have a figure (#1395)", async () => {
    const p = (await getContactPage(userId, sellerId, "year", TODAY))!.purchases!;
    assert.equal(p.costToCatalog?.kind, "settled");
    assert.equal(p.costToCatalog?.cost, 12);
    assert.equal(p.costToCatalog?.value, 4);
  });

  it("states no base-currency total over a purchase with no rate, and says why", async () => {
    const p = (await getContactPage(userId, sellerId, "all", TODAY))!.purchases!;
    assert.equal(p.count, 3);
    assert.equal(p.spent.base, null);
    assert.equal(p.spent.unconvertedCount, 1);
    assert.equal(p.spent.tx, null);
  });

  it("counts the buyer's sales over the period: what they paid, in the base currency", async () => {
    const s = (await getContactPage(userId, buyerId, "12m", TODAY))!.sales!;
    assert.equal(s.count, 2);
    // 5 EUR, and 10 GBP at 1.2.
    assert.deepEqual(s.revenue, { baseCurrency: "EUR", base: "17.00", unconvertedCount: 0, tx: null });
    assert.equal(s.lastSoldAt, "2026-09-10");
    assert.equal(s.unpaidCount, 1);
    assert.equal(s.unsentCount, 1);
  });

  it("counts every sale to the buyer over all time", async () => {
    const s = (await getContactPage(userId, buyerId, "all", TODAY))!.sales!;
    assert.equal(s.count, 3);
    assert.equal(s.revenue.base, "24.00");
  });

  it("shows no auctions section for a seller with no auction sale", async () => {
    assert.equal((await getContactPage(userId, sellerId, "all", TODAY))!.auctions, null);
  });

  it("shows the auctions section for an auction house before anything is tracked", async () => {
    const a = (await getContactPage(userId, newHouseId, "all", TODAY))!.auctions!;
    assert.equal(a.saleCount, 0);
    assert.equal(a.winRate, null);
    assert.equal(a.openCount, 0);
    assert.equal(a.exposure.committedTotal, "0.00");
  });

  it("counts the house's sales and lots over all time, and what the won ones cost all-in", async () => {
    const a = (await getContactPage(userId, houseId, "all", TODAY))!.auctions!;
    assert.equal(a.saleCount, 2);
    assert.equal(a.lotCount, 7);
    assert.equal(a.wonCount, 2);
    assert.equal(a.lostCount, 2);
    assert.equal(a.cancelledCount, 1);
    // Won of won + lost; the watched lot is neither.
    assert.equal(a.winRate, 0.5);
    // 61 + 5 shipping in euros, and (88 + 2) GBP at 1.2 = 108: two currencies, so no tx total.
    assert.deepEqual(a.spent, { baseCurrency: "EUR", base: "174.00", unconvertedCount: 0, tx: null });
    assert.deepEqual(a.premiumTerms, ["20% + 1 EUR/lot", "10%"]);
  });

  it("narrows the sales and their lots to the period they were tracked in", async () => {
    const a = (await getContactPage(userId, houseId, "year", TODAY))!.auctions!;
    assert.equal(a.saleCount, 1);
    assert.equal(a.lotCount, 5);
    assert.equal(a.wonCount, 1);
    assert.equal(a.lostCount, 1);
    assert.equal(a.cancelledCount, 1);
    assert.deepEqual(a.spent, { baseCurrency: "EUR", base: "66.00", unconvertedCount: 0, tx: null });
    assert.deepEqual(
      a.rows.map((r) => [r.id, r.trackedAt, r.openCount, r.wonCount, r.lostCount]),
      [[houseSaleId, "2026-09-01", 1, 1, 1]]
    );
  });

  it("reads open lots, exposure and review as the lots list does, the house's alone", async () => {
    const a = (await getContactPage(userId, houseId, "year", TODAY))!.auctions!;
    assert.equal(a.openCount, 1);
    // 13 all-in on the open lot, plus the sale's 5 shipping once.
    assert.equal(a.exposure.committedTotal, "18.00");
    assert.equal(a.exposure.ceilingTotal, "18.00");
    assert.equal(a.toReviewCount, 1);
  });

  it("is nothing for another collector", async () => {
    assert.equal(await getContactPage(`not-${userId}`, sellerId, "all", TODAY), null);
  });
});
