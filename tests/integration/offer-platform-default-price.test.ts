import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";

// A platform's default starting price (#362, narrowed to auctions in #449) is the server's *last*
// fallback: a new auction takes it only when nothing was submitted (which is the whole rule here —
// #553 reordered the *dialog's* pre-fill, where the default now outranks the suggestions read off
// the goods, and so the form submits it rather than leaving it to this fallback). It is resolved
// before the live-status
// checks — so an auction created straight as `ready` on a house that always opens at the same figure
// is not rejected as unpriced. An auction's current price then follows from its opening one, so the
// default reaches `price` too, without any of it applying to a quick buy.

describe("platform default starting price (#362/#449)", () => {
  let userId: string;
  let collectionId: string;
  /** An auction house that always opens at the same figure. */
  let flatPlatformId: string;
  /** States no default at all. */
  let plainPlatformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-platformprice-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User platformprice-${ts}`,
        email: `test-platformprice-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-platformprice-${ts}`,
        name: `Collection platformprice-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    flatPlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "FlatMarket",
          platform: true,
          platformCurrency: "EUR",
          defaultListingType: "auction",
          defaultStartingPrice: "5.00",
        },
      })
    ).id;
    plainPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "PlainMarket", platform: true, platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  async function priceOf(offerId: string): Promise<string> {
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { price: true },
    });
    return offer.price.toFixed(2);
  }

  async function startingPriceOf(offerId: string): Promise<string | null> {
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { startingPrice: true },
    });
    return offer.startingPrice?.toFixed(2) ?? null;
  }

  it("opens a new auction at the platform's default", async () => {
    // The listing type comes from the same platform (#449), so a bare create is an auction here.
    const offerId = await createOffer(userId, collectionId, {
      platformId: flatPlatformId,
      url: null,
      price: "0.00", // what the form action sends for a blank price
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await startingPriceOf(offerId), "5.00");
    // …and nothing is invented for the current price: nobody has bid yet.
    assert.equal(await priceOf(offerId), "0.00");
  });

  it("leaves a submitted starting price alone — the default is the lowest priority", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId: flatPlatformId,
      url: null,
      startingPrice: "12.50",
      price: "0.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await startingPriceOf(offerId), "12.50");
  });

  it("never prices a quick buy from it", async () => {
    // The narrowing of #449: a quick buy's price follows from the goods, so the platform default is
    // not a fallback for it — and the column would not be there to read on a fixed platform anyway.
    const offerId = await createOffer(userId, collectionId, {
      platformId: flatPlatformId,
      url: null,
      listingType: "fixed",
      price: "0.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await priceOf(offerId), "0.00");
    assert.equal(await startingPriceOf(offerId), null);
  });

  it("leaves an offer on a platform with no default unpriced", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId: plainPlatformId,
      url: null,
      price: "0.00", // what the form action sends for a blank price
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await priceOf(offerId), "0.00");
  });

  it("satisfies the ready-needs-a-price rule when the default supplies it", async () => {
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: flatPlatformId,
        url: null,
        price: "0.00", // what the form action sends for a blank price
        currency: "EUR",
        listingDate: null,
        state: "ready",
      },
      { seedItemIds: [await newItem()] }
    );
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { price: true, startingPrice: true, state: true },
    });
    assert.equal(offer.state, "ready");
    assert.equal(offer.startingPrice?.toFixed(2), "5.00");
    assert.equal(offer.price.toFixed(2), "0.00", "which is what a listed auction with no bids is");
  });

  it("still refuses a ready offer when neither the form nor the platform prices it", async () => {
    await assert.rejects(
      createOffer(
        userId,
        collectionId,
        {
          platformId: plainPlatformId,
          url: null,
          price: "0.00", // what the form action sends for a blank price
          currency: "EUR",
          listingDate: null,
          state: "ready",
        },
        { seedItemIds: [await newItem()] }
      ),
      /asking price/
    );
  });
});
