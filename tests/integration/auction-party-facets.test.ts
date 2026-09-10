import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  auctionLotFilterCounts,
  createAuctionLot,
  createAuctionSale,
  listAuctionLots,
} from "../../src/lib/auctions";

// The two party selects' **All sellers** / **All platforms** rows (#1029). They used to read
// `counts.total` — the list as it stands, seller and platform included — so with a seller chosen
// they promised the number of lots already on screen while choosing them would show every lot in
// the collection. A facet drops its own dimension and keeps every other (#843, `ui-patterns.md`),
// and the *All* row is a facet row: what it needs a database for is that seller and platform live
// on the **sale** rather than on the lot, so the two facets group through a relation.

describe("auction lot party facets (#1029)", () => {
  let userId: string;
  let collectionId: string;
  let philkam: string;
  let koehler: string;
  let allegro: string;
  let delcampe: string;
  let philkamSaleId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  const sale = (sellerId: string, platformId: string, name: string) =>
    createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name,
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });

  const lot = (auctionSaleId: string, title: string) =>
    createAuctionLot(userId, collectionId, {
      auctionSaleId,
      lotNo: null,
      url: null,
      title,
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-auctionfacets-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auctionfacets-${ts}`,
        email: `test-auctionfacets-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-auctionfacets-${ts}`,
          name: `Collection auctionfacets-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    philkam = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    koehler = (
      await prisma.contact.create({ data: { collectionId, name: "Köhler", seller: true } })
    ).id;
    allegro = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    delcampe = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;

    // Three lots across two sellers and two platforms, so no pair of the numbers below coincides:
    // Philkam has two on Allegro, Köhler one on Delcampe.
    philkamSaleId = await sale(philkam, allegro, "Philkam · Allegro");
    const koehlerSaleId = await sale(koehler, delcampe, "Köhler 385");
    await lot(philkamSaleId, "Poland 1919 overprints");
    await lot(philkamSaleId, "Poland 1919 provisionals");
    await lot(koehlerSaleId, "Danzig airmails");
  });

  it("counts the All rows over the list with their own dimension dropped", async () => {
    // Nothing selected: every count is the whole watchlist, so the bug is invisible here — which is
    // exactly why the case below is the one worth asserting.
    const open = await auctionLotFilterCounts(userId, collectionId, {});
    assert.equal(open.total, 3);
    assert.equal(open.allSellers, 3);
    assert.equal(open.allPlatforms, 3);

    // A seller chosen. `total` follows the list down to Köhler's one lot; **All sellers** must not,
    // because choosing it brings all three back. This is the assertion that fails before the fix,
    // where `allSellers` was `total`.
    const bySeller = await auctionLotFilterCounts(userId, collectionId, { sellerId: koehler });
    assert.equal(bySeller.total, 1);
    assert.equal((await listAuctionLots(userId, collectionId, { sellerId: koehler })).items.length, 1);
    assert.equal(bySeller.allSellers, 3, "All sellers must count the lots choosing it would show");
    // The platform select is unaffected by its neighbour being chosen only in the sense that it
    // keeps it: Köhler sells on Delcampe, so **All platforms** stays at that one lot.
    assert.equal(bySeller.allPlatforms, 1);

    const byPlatform = await auctionLotFilterCounts(userId, collectionId, { platformId: delcampe });
    assert.equal(byPlatform.total, 1);
    assert.equal(byPlatform.allPlatforms, 3, "All platforms likewise");
    assert.equal(byPlatform.allSellers, 1);
  });

  it("keeps each All row the sum of the options drawn under it", async () => {
    // The property the fix is built on: an *All* row that disagrees with its own options is the
    // failure a bare row would have avoided. It has to hold under every other filter too.
    for (const filters of [
      {},
      { sellerId: philkam },
      { platformId: allegro },
      { sellerId: koehler, platformId: delcampe },
      { search: "poland" },
      { outcome: "pending" as const },
      { search: "nothing here matches this" },
    ]) {
      const counts = await auctionLotFilterCounts(userId, collectionId, filters);
      const label = JSON.stringify(filters);
      assert.equal(
        counts.allSellers,
        Object.values(counts.sellers).reduce((sum, n) => sum + n, 0),
        `All sellers disagreed with the seller options under ${label}`
      );
      assert.equal(
        counts.allPlatforms,
        Object.values(counts.platforms).reduce((sum, n) => sum + n, 0),
        `All platforms disagreed with the platform options under ${label}`
      );
      // And neither *All* row may promise more than the watchlist itself holds.
      assert.ok(counts.allSellers <= counts.unfiltered);
      assert.ok(counts.allPlatforms <= counts.unfiltered);
    }
  });

  it("stays inside the sale on a sale's own lot list", async () => {
    // `saleId` is the screen rather than a filter, so it narrows the *All* rows as it narrows
    // everything else — a sale's toolbar must never offer a count reaching outside the parcel.
    const scoped = await auctionLotFilterCounts(userId, collectionId, {
      saleId: philkamSaleId,
      sellerId: philkam,
    });
    assert.equal(scoped.total, 2);
    assert.equal(scoped.allSellers, 2, "the sale is the screen: All sellers cannot leave it");
    assert.equal(scoped.allPlatforms, 2);
    assert.equal(scoped.unfiltered, 2);
  });
});
