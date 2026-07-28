import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";

// A platform's default offer price (#362) is the *last* fallback: a new offer takes it only when
// nothing was submitted, and it is resolved before the live-status checks — so an offer created
// straight as `ready` on a flat-price platform is not rejected as unpriced.

describe("platform default offer price (#362)", () => {
  let userId: string;
  let collectionId: string;
  /** Lists at one flat price. */
  let flatPlatformId: string;
  /** Prices every listing individually. */
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
          defaultOfferPrice: "5.00",
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

  it("fills an unpriced new offer from the platform's default", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId: flatPlatformId,
      url: null,
      price: "0.00", // what the form action sends for a blank price
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await priceOf(offerId), "5.00");
  });

  it("leaves a submitted price alone — the default is the lowest priority", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId: flatPlatformId,
      url: null,
      price: "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await priceOf(offerId), "12.50");
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
      select: { price: true, state: true },
    });
    assert.equal(offer.state, "ready");
    assert.equal(offer.price.toFixed(2), "5.00");
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
