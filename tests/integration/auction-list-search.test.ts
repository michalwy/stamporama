import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  auctionLotFilterCounts,
  createAuctionLot,
  createAuctionSale,
  listAuctionLots,
  listAuctionSales,
} from "../../src/lib/auctions";

// Free-text search on the two auction lists (#484). What is worth a real database here is that the
// search reaches **through the sale** to its seller and platform, that it composes with the other
// filters rather than replacing them, and that the toolbar's counts are counted over the searched
// set — a badge describing the whole collection under a search would send you to the wrong screen.

describe("auction list search (#484)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let otherSellerId: string;
  let platformId: string;
  let saleId: string;
  let otherSaleId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-auctionsearch-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auctionsearch-${ts}`,
        email: `test-auctionsearch-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-auctionsearch-${ts}`,
          name: `Collection auctionsearch-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    otherSellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Köhler", seller: true } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;

    saleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: "Philkam · Allegro",
      url: null,
      endsAt: null,
      currency: "PLN",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    otherSaleId = await createAuctionSale(userId, collectionId, {
      sellerId: otherSellerId,
      platformId,
      name: "Köhler 385",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });

    await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "A-77",
      url: "https://allegro.pl/oferta/12345",
      title: "Poland 1919 overprints",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: "torn corner on the 5f",
    });
    await createAuctionLot(userId, collectionId, {
      auctionSaleId: otherSaleId,
      lotNo: "31",
      url: null,
      title: "Danzig airmails",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });
  });

  const lotTitles = async (search: string, extra = {}) =>
    (await listAuctionLots(userId, collectionId, { search, ...extra })).items
      .map((l) => l.title)
      .sort();

  it("matches a lot by its title, its notes and the house's lot number", async () => {
    assert.deepEqual(await lotTitles("overprint"), ["Poland 1919 overprints"]);
    assert.deepEqual(await lotTitles("torn corner"), ["Poland 1919 overprints"]);
    assert.deepEqual(await lotTitles("a-77"), ["Poland 1919 overprints"]);
  });

  it("reaches through the sale to the seller and the platform", async () => {
    assert.deepEqual(await lotTitles("köhler"), ["Danzig airmails"]);
    // Both lots are on the same platform, so the platform's name finds the pair.
    assert.deepEqual(await lotTitles("allegro"), ["Danzig airmails", "Poland 1919 overprints"]);
  });

  it("finds a lot by its own short number, and by the listing address", async () => {
    const [lot] = (await listAuctionLots(userId, collectionId, { search: "overprint" })).items;
    assert.deepEqual(await lotTitles(`#${lot.auctionLotNo}`), ["Poland 1919 overprints"]);
    // A bare number is matched **in addition to** the text, never instead of it — so it finds this
    // lot, and anything whose house number happens to contain those digits comes along with it.
    assert.ok((await lotTitles(String(lot.auctionLotNo))).includes("Poland 1919 overprints"));
    assert.deepEqual(await lotTitles("allegro.pl/oferta/12345"), ["Poland 1919 overprints"]);
  });

  it("composes with the other filters rather than replacing them", async () => {
    // The seller select and the box narrow together: nothing of Köhler's says "overprints".
    assert.deepEqual(await lotTitles("overprint", { sellerId: otherSellerId }), []);
    assert.deepEqual(await lotTitles("overprint", { sellerId }), ["Poland 1919 overprints"]);
  });

  it("counts the toolbar's facets over the searched set", async () => {
    const all = await auctionLotFilterCounts(userId, collectionId, {});
    const searched = await auctionLotFilterCounts(userId, collectionId, { search: "köhler" });
    assert.equal(all.total, 2);
    assert.equal(searched.total, 1);
    // …including the facets that ignore their own dimension: the seller badge under this search
    // must say one, not two, or clicking it would show a different list than it promised.
    assert.equal(searched.sellers[otherSellerId], 1);
    assert.equal(searched.sellers[sellerId] ?? 0, 0);
  });

  it("searches the settlement list by name and by either party", async () => {
    const names = async (search?: string) =>
      (await listAuctionSales(userId, collectionId, { search })).map((s) => s.name).sort();
    assert.deepEqual(await names(), ["Köhler 385", "Philkam · Allegro"]);
    // A sale's identifier is part of its name, so either half of `Köhler 385` finds it.
    assert.deepEqual(await names("385"), ["Köhler 385"]);
    assert.deepEqual(await names("philkam"), ["Philkam · Allegro"]);
    // And the status filter still applies alongside it.
    assert.deepEqual(
      (await listAuctionSales(userId, collectionId, { search: "philkam", status: "settled" })).map(
        (s) => s.name
      ),
      []
    );
  });
});
