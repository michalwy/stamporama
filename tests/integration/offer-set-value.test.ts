import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, getOfferDetail } from "../../src/lib/offers";

// What each set of an offer is worth and what it cost (#378). The aggregation itself is the holdings
// pair the summary bars use (#134/#179) — what is exercised here is that it is computed **per set**
// over the right copies, and that a set with nothing priced or nothing costed says so rather than
// reporting zero.

describe("per-set catalogue value + cost (#378)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  /** A copy with a catalog price of 30.00 EUR and a frozen cost basis of 12.00. */
  let priced: string;
  /** A second priced copy, 20.00 EUR, no cost recorded. */
  let pricedNoCost: string;
  /** A copy no catalogue prices at all. */
  let unpriced: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-set-value-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User set-value-${ts}`,
        email: `test-set-value-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-set-value-${ts}`,
        name: `Collection set-value-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;

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
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const mkCopy = async (name: string, price: string | null, costBasis: string | null) => {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
        },
      });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: stamp.id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      const item = await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId,
        forSale: true,
      });
      if (costBasis) {
        await prisma.item.update({ where: { id: item.id }, data: { costBasis } });
      }
      return item.id;
    };

    priced = await mkCopy("Priced", "30.00", "12.00");
    pricedNoCost = await mkCopy("Priced, uncosted", "20.00", null);
    unpriced = await mkCopy("Unpriced", null, "5.00");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offerWithSets(sets: string[][]) {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(detail);
    return detail;
  }

  it("totals each set over its own copies, not the whole offer", async () => {
    const detail = await offerWithSets([[priced], [pricedNoCost]]);
    assert.equal(detail.sets[0].holdings.totalBaseAmount, "30.00");
    assert.equal(detail.sets[1].holdings.totalBaseAmount, "20.00");
    assert.equal(detail.sets[0].holdings.cost.totalCostBasis, "12.00");
  });

  it("sums a multi-copy set and counts what it could not price", async () => {
    const detail = await offerWithSets([[priced, pricedNoCost, unpriced]]);
    const [set] = detail.sets;
    assert.equal(set.holdings.totalBaseAmount, "50.00");
    assert.equal(set.holdings.pricedCount, 2);
    assert.equal(set.holdings.unpricedCount, 1);
    // Cost is its own tally over the same copies: two carry one, one does not.
    assert.equal(set.holdings.cost.totalCostBasis, "17.00");
    assert.equal(set.holdings.cost.knownCount, 2);
    assert.equal(set.holdings.cost.noneCount, 1);
  });

  it("reports a set with nothing priced as unpriced rather than worth zero", async () => {
    const [set] = (await offerWithSets([[unpriced]])).sets;
    assert.equal(set.holdings.pricedCount, 0);
    assert.equal(set.holdings.unpricedCount, 1);
  });

  it("adds no second currency while the offer prices in the base currency", async () => {
    const detail = await offerWithSets([[priced]]);
    assert.equal(detail.sets[0].holdingsInOfferCurrency, null);
    assert.equal(detail.setsTotals.inOfferCurrency, null);
  });

  it("sums and averages the whole listing over its sets", async () => {
    const detail = await offerWithSets([[priced], [pricedNoCost]]);
    const t = detail.setsTotals;
    assert.equal(t.setCount, 2);
    assert.equal(t.catalogTotal, "50.00");
    assert.equal(t.catalogAverage, "25.00");
    assert.equal(t.catalogValuedSets, 2);
    // Only one of the two sets carries a cost, so the total is that set's and the average divides
    // by one — an uncosted set is a gap, not a set that cost nothing.
    assert.equal(t.costTotal, "12.00");
    assert.equal(t.costAverage, "12.00");
    assert.equal(t.costKnownSets, 1);
  });

  it("averages over the sets that carry a value, not over every set", async () => {
    const t = (await offerWithSets([[priced], [pricedNoCost], [unpriced]])).setsTotals;
    assert.equal(t.setCount, 3);
    assert.equal(t.catalogTotal, "50.00");
    assert.equal(t.catalogAverage, "25.00");
    assert.equal(t.catalogValuedSets, 2);
  });

  it("reports no totals at all for a listing with nothing priced or costed", async () => {
    const t = (await offerWithSets([[unpriced]])).setsTotals;
    assert.equal(t.catalogTotal, null);
    assert.equal(t.catalogAverage, null);
    assert.equal(t.catalogValuedSets, 0);
    // …while the cost side still has this copy's own basis to report.
    assert.equal(t.costTotal, "5.00");
  });

  it("matches the catalogue row to the per-set catalogue average", async () => {
    const detail = await offerWithSets([[priced], [pricedNoCost]]);
    assert.equal(detail.catalogPrice, detail.setsTotals.catalogAverage);
    assert.equal(detail.catalogUnpricedSets, 0);
  });

  // The price table (#1829). Nothing has been recorded in this collection, so the ladder answers
  // with the catalogue's manual factor where one is set and with `bidFallbackPercent` otherwise.
  it("suggests Estimated value — the catalogue at the fallback percentage while nothing is learned", async () => {
    const detail = await offerWithSets([[priced], [pricedNoCost]]);
    // The default fallback is 100%, so the estimate is the catalogue itself, and says why.
    assert.equal(detail.suggestedPrice, "25.00");
    assert.equal(detail.suggestedEstimate?.valuedSets, 2);
    assert.equal(detail.suggestedEstimate?.copies, 2);
    assert.equal(detail.suggestedEstimate?.source.level, "fallback");
    assert.equal(detail.suggestedEstimate?.ratio, 1);
  });

  it("names the book the catalogue value was read in (#1839)", async () => {
    const detail = await offerWithSets([[priced], [pricedNoCost]]);
    assert.deepEqual(detail.catalogNames, ["Michel / Michel Katalog"]);
  });

  it("corrects the catalogue by the catalogue's manual factor, and names it as the source", async () => {
    await prisma.catalogName.updateMany({
      where: { vendor: { collectionId } },
      data: { manualFactor: 10 },
    });
    try {
      const detail = await offerWithSets([[priced], [pricedNoCost]]);
      // 30.00 ÷ 10 and 20.00 ÷ 10, averaged over the two sets.
      assert.equal(detail.suggestedPrice, "2.50");
      assert.equal(detail.suggestedEstimate?.source.level, "catalogue-factor");
      assert.equal(detail.catalogPrice, "25.00");
    } finally {
      await prisma.catalogName.updateMany({
        where: { vendor: { collectionId } },
        data: { manualFactor: null },
      });
    }
  });

  it("leaves out what does not exist: no estimate over unpriced copies, no market without results", async () => {
    const detail = await offerWithSets([[unpriced]]);
    assert.equal(detail.suggestedPrice, null);
    assert.equal(detail.suggestedEstimate, null);
    assert.equal(detail.marketPrice, null);
    // Nothing recorded at all, which is not the same as results no rate converts (#1839).
    assert.equal(detail.marketUnconvertible, false);
    assert.deepEqual(detail.catalogNames, []);
    // …while the cost is known, per set and in the offer's currency.
    assert.equal(detail.costPrice, "5.00");
  });
});
