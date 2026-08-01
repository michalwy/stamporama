import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createOffer, getOfferDetail, patchOffer, updateOffer } from "../../src/lib/offers";

// An offer is sold either as a quick buy or by auction (#449). The distinction is about the
// **price**: `price` stays the one live figure everything downstream reads — an asking price on a
// quick buy, the standing bid on an auction — and the auction adds what it opened at plus when the
// figure was last checked against the listing (the auction lot's `checkedAt` pattern, #351).
//
// What this pins down is that the two extra columns describe a format the offer is actually in: they
// are written only for an auction, dropped the moment it is not one, and dated only when the figure
// really moved.

describe("offer listing type and its prices (#449)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listingtype-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listingtype-${ts}`,
        email: `test-listingtype-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-listingtype-${ts}`,
        name: `Collection listingtype-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const detail = async (offerId: string) => {
    const d = await getOfferDetail(userId, offerId);
    assert.ok(d, "offer detail");
    return d;
  };

  it("defaults to a quick buy, which carries neither auction figure", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "12.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    const d = await detail(offerId);
    assert.equal(d.listingType, "fixed");
    assert.equal(d.price, "12.00");
    assert.equal(d.startingPrice, null);
    // Nothing moves a quick buy's price behind the seller's back, so there is nothing to re-check.
    assert.equal(d.priceCheckedAt, null);
  });

  it("records an auction's opening figure and dates the price it was created with", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "18.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    const d = await detail(offerId);
    assert.equal(d.listingType, "auction");
    assert.equal(d.price, "18.00", "the live figure is where the bidding stands");
    assert.equal(d.startingPrice, "5.00");
    assert.ok(d.priceCheckedAt, "a figure typed at creation was just read off the listing");
  });

  it("drops a starting price submitted alongside a quick buy", async () => {
    // Storing it would be a figure describing a format this listing is not in.
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "9.00",
      startingPrice: "3.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    assert.equal((await detail(offerId)).startingPrice, null);
  });

  it("dates a bid refresh, but not a price retyped as it already was", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "18.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    const first = (await detail(offerId)).priceCheckedAt;
    assert.ok(first);

    await patchOffer(userId, offerId, { price: "18.00" });
    assert.deepEqual(
      (await detail(offerId)).priceCheckedAt,
      first,
      "an unchanged figure is not an observation — nothing was learned"
    );

    await patchOffer(userId, offerId, { price: "21.00" });
    const second = (await detail(offerId)).priceCheckedAt;
    assert.ok(second && second.getTime() > first.getTime(), "a moved bid is dated afresh");
  });

  it("refuses a starting price on a quick buy", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "9.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    await assert.rejects(
      () => patchOffer(userId, offerId, { startingPrice: "4.00" }),
      /starting price/i,
      "changing format is the header form's job, not a field appearing beside the price"
    );
  });

  it("clears both auction figures when the listing becomes a quick buy", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "18.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    await updateOffer(userId, offerId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "18.00",
      startingPrice: null,
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    const d = await detail(offerId);
    assert.equal(d.listingType, "fixed");
    assert.equal(d.startingPrice, null);
    assert.equal(d.priceCheckedAt, null, "a stale check date on a price nothing moves says nothing");
  });
});
