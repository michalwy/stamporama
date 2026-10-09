import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { createTrade } from "../../src/lib/trades";
import { getContactPage } from "../../src/lib/contact-page";

// A contact page's platform and trades sections (#1710), read back out of Prisma: which offers,
// sales and purchases the platform section counts and on which day an ended offer is placed — its
// sale's, never the closing stamp's — and what the trades section values each way, in the
// collector's own valuation, with a cancelled trade counted but not valued.

const TS = Date.now();
const TODAY = "2026-10-09";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("contact page — platform and trades (#1710)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  /** A role-less partner with three trades. */
  let partnerId: string;
  /** Neither a platform nor a partner, and nothing recorded. */
  let plainId: string;

  before(async () => {
    userId = `test-user-contactpagept-${TS}`;
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
        data: { slug: `col-contactpagept-${TS}`, name: "Contact page", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Unpriced" } })).id;

    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformModule: "allegro" },
      })
    ).id;
    partnerId = (await prisma.contact.create({ data: { collectionId, name: "Partner" } })).id;
    plainId = (await prisma.contact.create({ data: { collectionId, name: "Plain" } })).id;
    const otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;

    // ── Offers ──────────────────────────────────────────────────────────────────────────────────
    let offerNo = 0;
    const offer = (data: {
      state: string;
      listingDate?: string;
      closedAt?: string;
      platform?: string;
    }) =>
      prisma.offer.create({
        data: {
          collectionId,
          offerNo: ++offerNo,
          platformId: data.platform ?? platformId,
          price: "1.00",
          currency: "EUR",
          state: data.state,
          listingDate: data.listingDate ? day(data.listingDate) : null,
          closedAt: data.closedAt ? day(data.closedAt) : null,
        },
      });
    let saleNo = 0;
    /** A sale through the platform, of one set of the offer given. */
    const sellOffer = async (offerId: string, soldAt: string, price: string) => {
      const set = await prisma.offerSet.create({ data: { offerId } });
      await prisma.sale.create({
        data: {
          collectionId,
          platformId,
          saleNo: ++saleNo,
          soldAt: day(soldAt),
          currency: "EUR",
          lines: { create: { offerId, offerSetId: set.id, price } },
        },
      });
    };

    await offer({ state: "active" });
    await offer({ state: "active" });
    await offer({ state: "ready" });
    await offer({ state: "preparing" });
    // Sold this year, ten days after listing — closed on a stamp months later, as #512's backfill
    // left every offer closed before it.
    const sold1 = await offer({ state: "sold", listingDate: "2026-03-01", closedAt: "2026-08-12" });
    await sellOffer(sold1.id, "2026-03-11", "20.00");
    // Sold this year with no listing date: counted, not timed.
    const sold2 = await offer({ state: "sold", closedAt: "2026-06-01" });
    await sellOffer(sold2.id, "2026-06-01", "30.00");
    // Sold last year, closed on this year's stamp: the sale's day is the one that counts.
    const sold3 = await offer({ state: "sold", listingDate: "2025-01-01", closedAt: "2026-08-12" });
    await sellOffer(sold3.id, "2025-02-01", "50.00");
    await offer({ state: "withdrawn", closedAt: "2026-07-01" });
    // Another platform's, which nothing here may count.
    await offer({ state: "active", platform: otherPlatformId });

    // ── Purchases through the platform ─────────────────────────────────────────────────────────
    const thisYear = (
      await createPurchase(userId, collectionId, {
        platformId,
        purchasedAt: "2026-09-01",
        currency: "EUR",
        shippingCost: 2,
        status: "arrived",
      })
    ).id;
    await createLot(userId, thisYear, 10, null);
    const lastYear = (
      await createPurchase(userId, collectionId, {
        platformId,
        purchasedAt: "2025-05-01",
        currency: "EUR",
        status: "completed",
      })
    ).id;
    await createLot(userId, lastYear, 7, null);

    // ── Trades with the partner ────────────────────────────────────────────────────────────────
    const trade = async (status: string, createdAt: string) => {
      const t = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
      await prisma.trade.update({ where: { id: t.id }, data: { status, createdAt: day(createdAt) } });
      return { tradeId: t.id, sectionId: t.sections[0].id };
    };
    const give = async (ids: { tradeId: string; sectionId: string }, manualValue: string | null) => {
      const item = await createItem(userId, collectionId, { stampId, conditionId });
      await prisma.tradeLine.create({
        data: { ...ids, side: "give", itemId: item.id, manualValue },
      });
    };
    const receive = (
      ids: { tradeId: string; sectionId: string },
      quantity: number,
      manualValue: string | null
    ) =>
      prisma.tradeLine.create({
        data: { ...ids, side: "receive", stampId, conditionId, quantity, manualValue },
      });

    // This year, being prepared: 10 out, two pieces at 4 in.
    const t1 = await trade("preparing", "2026-02-01");
    await give(t1, "10.00");
    await receive(t1, 2, "4.00");
    // This year, cancelled: counted and listed, never valued.
    const t2 = await trade("cancelled", "2026-04-01");
    await give(t2, "100.00");
    // Last year, shared: 5 out, and a piece in that nothing values.
    const t3 = await trade("shared", "2025-06-01");
    await give(t3, "5.00");
    await receive(t3, 1, null);
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts the platform's offers today, and those that ended in the period on their sale's day", async () => {
    const p = (await getContactPage(userId, platformId, "year", TODAY))!.platform!;
    assert.equal(p.activeCount, 2);
    assert.equal(p.readyCount, 1);
    assert.equal(p.soldCount, 2);
    assert.equal(p.withdrawnCount, 1);
    assert.equal(p.sellThrough, 2 / 3);
    assert.equal(p.avgDaysToSale, 10);
    assert.equal(p.timedCount, 1);
    assert.equal(p.settings, "allegro");
  });

  it("reads every ended offer over all time", async () => {
    const p = (await getContactPage(userId, platformId, "all", TODAY))!.platform!;
    assert.equal(p.soldCount, 3);
    assert.equal(p.withdrawnCount, 1);
    assert.equal(p.sellThrough, 0.75);
    // 10 days and 31 days.
    assert.equal(p.avgDaysToSale, 20.5);
    assert.equal(p.timedCount, 2);
  });

  it("states the revenue from sales and the spend on purchases made through the platform", async () => {
    const year = (await getContactPage(userId, platformId, "year", TODAY))!.platform!;
    assert.equal(year.salesCount, 2);
    assert.equal(year.revenue.base, "50.00");
    assert.equal(year.purchaseCount, 1);
    // The order total, shipping included (#852).
    assert.equal(year.purchaseSpent.base, "12.00");

    const all = (await getContactPage(userId, platformId, "all", TODAY))!.platform!;
    assert.equal(all.salesCount, 3);
    assert.equal(all.revenue.base, "100.00");
    assert.equal(all.purchaseCount, 2);
    assert.equal(all.purchaseSpent.base, "19.00");
  });

  it("does not show a platform as a seller, nor a sales section for the sales made through it", async () => {
    const page = (await getContactPage(userId, platformId, "all", TODAY))!;
    assert.equal(page.purchases, null);
    assert.equal(page.sales, null);
    assert.equal(page.trades, null);
  });

  it("shows a role-less partner's trades, valued in the collector's own valuation", async () => {
    const page = (await getContactPage(userId, partnerId, "year", TODAY))!;
    assert.equal(page.platform, null);
    const t = page.trades!;
    assert.equal(t.count, 2);
    assert.equal(t.openCount, 1);
    // The cancelled trade's 100 is not in it.
    assert.deepEqual(t.given, { total: "10.00", missingLines: 0 });
    assert.deepEqual(t.received, { total: "8.00", missingLines: 0 });
    assert.deepEqual(
      t.rows.map((r) => [r.createdAt, r.status, r.givePieces, r.receivePieces, r.ownGiven, r.ownReceived]),
      [
        ["2026-04-01", "cancelled", 1, 0, null, null],
        ["2026-02-01", "preparing", 1, 2, 10, 8],
      ]
    );
  });

  it("counts a line with no value as missing rather than as zero", async () => {
    const t = (await getContactPage(userId, partnerId, "all", TODAY))!.trades!;
    assert.equal(t.count, 3);
    assert.equal(t.openCount, 2);
    assert.deepEqual(t.given, { total: "15.00", missingLines: 0 });
    assert.deepEqual(t.received, { total: "8.00", missingLines: 1 });
    assert.equal(t.rows[2].ownMissing, 1);
  });

  it("shows neither section for a contact that is neither, with nothing recorded", async () => {
    const page = (await getContactPage(userId, plainId, "all", TODAY))!;
    assert.equal(page.platform, null);
    assert.equal(page.trades, null);
  });
});
