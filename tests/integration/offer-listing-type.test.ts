import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  patchOffer,
  setOfferState,
  updateOffer,
} from "../../src/lib/offers";

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
  let stampId: string;
  let conditionId: string;

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
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp A" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
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

  it("stands an auction with no current figure at its starting price", async () => {
    // A listing that is up with nobody bidding does have a price — the one it opened at — so the
    // collector states the starting figure and leaves the current one blank.
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "0.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    const d = await detail(offerId);
    assert.equal(d.price, "5.00", "written into the one column every surface reads");
    assert.equal(d.startingPrice, "5.00");
    assert.ok(d.priceCheckedAt);
  });

  it("carries the current price over when the starting price is set field by field", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    assert.equal((await detail(offerId)).price, "0.00");

    await patchOffer(userId, offerId, { startingPrice: "6.00" });
    assert.equal((await detail(offerId)).price, "6.00", "nobody has bid, so it stands at its opening");

    // Once a bid is recorded, the opening figure is history and must not overwrite it.
    await patchOffer(userId, offerId, { price: "11.00" });
    await patchOffer(userId, offerId, { startingPrice: "4.00" });
    const d = await detail(offerId);
    assert.equal(d.price, "11.00");
    assert.equal(d.startingPrice, "4.00");
  });

  it("refuses to list an auction with no starting price, naming that field", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      // A bid observed without ever recording what the auction opened at: priced, but not listed.
      price: "18.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await newItem()]);

    await assert.rejects(
      () => setOfferState(userId, offerId, "ready"),
      /starting price/i,
      "the starting price is the figure the seller states"
    );

    await patchOffer(userId, offerId, { startingPrice: "5.00" });
    await setOfferState(userId, offerId, "ready");
    assert.equal((await detail(offerId)).state, "ready");
  });

  it("lists an auction on its starting price alone", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: "0.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await newItem()]);

    await setOfferState(userId, offerId, "ready");
    const d = await detail(offerId);
    assert.equal(d.state, "ready");
    assert.equal(d.price, "5.00", "and it is listed at what it opened at");
  });

  it("takes the platform's default listing type when the form states none", async () => {
    // The `defaultOfferPrice` rule (#362): read at creation, then owned by the offer.
    const auctionOnly = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `Auction house ${Date.now()}`,
          platform: true,
          defaultListingType: "auction",
        },
      })
    ).id;

    const offerId = await createOffer(userId, collectionId, {
      platformId: auctionOnly,
      url: null,
      price: "0.00",
      startingPrice: "3.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });

    const d = await detail(offerId);
    assert.equal(d.listingType, "auction");
    assert.equal(d.startingPrice, "3.00");

    // …and anything the form does say outranks it.
    const stated = await createOffer(userId, collectionId, {
      platformId: auctionOnly,
      url: null,
      listingType: "fixed",
      price: "9.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    assert.equal((await detail(stated)).listingType, "fixed");
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
