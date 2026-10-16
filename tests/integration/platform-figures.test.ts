import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getPlatformFigures } from "../../src/lib/platform-figures";

// A platform's figures on its Settings page (#1960), read back out of Prisma — the figures the
// contact page's Platform section carried (#1710), now over all time: which offers, sales and
// purchases count, the time to sale measured to an ended offer's sale day rather than its closing
// stamp, and nothing of another platform's or another collection's.

const TS = Date.now();

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("platform figures (#1960)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let quietId: string;

  before(async () => {
    userId = `test-user-platformfigures-${TS}`;
    otherUserId = `test-user-platformfigures-other-${TS}`;
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
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-platformfigures-${TS}`, name: "Platform figures", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "eBay" } })).id;
    quietId = (await prisma.platform.create({ data: { collectionId, name: "Forum" } })).id;
    const otherPlatformId = (await prisma.platform.create({ data: { collectionId, name: "Club" } })).id;

    // ── Offers ──────────────────────────────────────────────────────────────────────────────────
    let offerNo = 0;
    const offer = (data: { state: string; listingDate?: string; closedAt?: string; platform?: string }) =>
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
    const sellOffer = async (offerId: string, soldAt: string, price: string, currency = "EUR") => {
      const set = await prisma.offerSet.create({ data: { offerId } });
      await prisma.sale.create({
        data: {
          collectionId,
          platformId,
          saleNo: ++saleNo,
          soldAt: day(soldAt),
          currency,
          lines: { create: { offerId, offerSetId: set.id, price } },
        },
      });
    };

    await offer({ state: "active" });
    await offer({ state: "active" });
    await offer({ state: "ready" });
    await offer({ state: "preparing" });
    // Sold ten days after listing, closed on a stamp months later, as #512's backfill left every
    // offer closed before it: the sale's day is the one measured to.
    const sold1 = await offer({ state: "sold", listingDate: "2026-03-01", closedAt: "2026-08-12" });
    await sellOffer(sold1.id, "2026-03-11", "20.00");
    // Sold with no listing date: counted, not timed.
    const sold2 = await offer({ state: "sold", closedAt: "2026-06-01" });
    await sellOffer(sold2.id, "2026-06-01", "30.00");
    // Sold a year earlier, 31 days after listing.
    const sold3 = await offer({ state: "sold", listingDate: "2025-01-01", closedAt: "2026-08-12" });
    await sellOffer(sold3.id, "2025-02-01", "50.00");
    await offer({ state: "withdrawn", closedAt: "2026-07-01" });
    // Another platform's, which nothing here may count.
    await offer({ state: "active", platform: otherPlatformId });

    // ── Purchases through the platform ─────────────────────────────────────────────────────────
    const first = (
      await createPurchase(userId, collectionId, {
        platformId,
        purchasedAt: "2026-09-01",
        currency: "EUR",
        shippingCost: 2,
        status: "arrived",
      })
    ).id;
    await createLot(userId, first, 10, null);
    const second = (
      await createPurchase(userId, collectionId, {
        platformId,
        purchasedAt: "2025-05-01",
        currency: "EUR",
        status: "completed",
      })
    ).id;
    await createLot(userId, second, 7, null);
  });

  after(async () => {
    // Sales before the offers their lines name, the offers before the platforms they name.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("counts the offers on it as they stand, and every one that ended", async () => {
    const f = (await getPlatformFigures(userId, collectionId, platformId))!;
    assert.equal(f.activeCount, 2);
    assert.equal(f.readyCount, 1);
    assert.equal(f.soldCount, 3);
    assert.equal(f.withdrawnCount, 1);
    assert.equal(f.sellThrough, 0.75);
    // 10 days and 31 days; the sale without a listing date is not timed.
    assert.equal(f.avgDaysToSale, 20.5);
    assert.equal(f.timedCount, 2);
  });

  it("states the revenue from sales and the spend on purchases made through it", async () => {
    const f = (await getPlatformFigures(userId, collectionId, platformId))!;
    assert.equal(f.salesCount, 3);
    assert.equal(f.revenue.base, "100.00");
    assert.equal(f.revenue.tx, null);
    assert.equal(f.purchaseCount, 2);
    // The order totals, shipping included (#852).
    assert.equal(f.purchaseSpent.base, "19.00");
  });

  it("says nothing happened on a platform nothing names", async () => {
    const f = (await getPlatformFigures(userId, collectionId, quietId))!;
    assert.equal(f.activeCount, 0);
    assert.equal(f.soldCount, 0);
    assert.equal(f.sellThrough, null);
    assert.equal(f.avgDaysToSale, null);
    assert.equal(f.salesCount, 0);
    assert.equal(f.revenue.base, "0.00");
    assert.equal(f.purchaseCount, 0);
  });

  it("reads nothing for another owner, or under another collection's address", async () => {
    assert.equal(await getPlatformFigures(otherUserId, collectionId, platformId), null);
    assert.equal(await getPlatformFigures(userId, "not-this-collection", platformId), null);
  });
});
