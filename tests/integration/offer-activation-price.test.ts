import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  setOfferState,
  patchOffer,
  updateOffer,
  duplicateOffer,
} from "../../src/lib/offers";

// Being prepared or live requires an asking price (#336). The `price` column is a non-null Decimal,
// so an offer with no price yet carries 0 — which used to sail straight through `preparing → ready
// → active`. What this pins down is the whole invariant, not just the one transition: an offer
// cannot *become* ready or active unpriced (by transition, by direct creation, or by duplication),
// and one already there cannot have its price cleared back out from under it.

describe("ready / active offers require a price (#336)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offerprice-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offerprice-${ts}`,
        email: `test-offerprice-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-offerprice-${ts}`,
        name: `Collection offerprice-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp P" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A composed `preparing` offer with one set, at the given asking price. */
  async function preparedOffer(price: string): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price,
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await newItem()]);
    return offerId;
  }

  const stateOf = async (offerId: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { state: true } })).state;

  it("blocks preparing → ready while the offer has no price, and allows it once set", async () => {
    const offerId = await preparedOffer("0.00");

    await assert.rejects(
      () => setOfferState(userId, offerId, "ready"),
      /asking price/i,
      "an unpriced offer is not prepared"
    );
    assert.equal(await stateOf(offerId), "preparing", "and the offer stays where it was");

    await patchOffer(userId, offerId, { price: "7.50" });
    await setOfferState(userId, offerId, "ready");
    assert.equal(await stateOf(offerId), "ready");
  });

  it("blocks ready → active when the price was cleared in between", async () => {
    const offerId = await preparedOffer("7.50");
    await setOfferState(userId, offerId, "ready");

    // Stepping back is the only way to lose the price again: `ready` freezes it (see below).
    await setOfferState(userId, offerId, "preparing");
    await patchOffer(userId, offerId, { price: "0.00" });
    await assert.rejects(() => setOfferState(userId, offerId, "ready"), /asking price/i);

    await patchOffer(userId, offerId, { price: "9.00" });
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    assert.equal(await stateOf(offerId), "active");
  });

  it("blocks creating an offer directly as ready or active with no price", async () => {
    const itemId = await newItem();
    for (const state of ["ready", "active"] as const) {
      await assert.rejects(
        () =>
          createOffer(
            userId,
            collectionId,
            {
              platformId,
              url: null,
              price: "0.00",
              currency: "EUR",
              listingDate: null,
              state,
            },
            { seedItemIds: [itemId] }
          ),
        /asking price/i
      );
    }
    // Nothing half-open left behind: the copy is still free to be listed.
    const offers = await prisma.offer.count({ where: { collectionId, sets: { some: { items: { some: { itemId } } } } } });
    assert.equal(offers, 0);
  });

  it("blocks duplicating an offer straight into an unpriced active listing", async () => {
    const sourceId = await preparedOffer("5.00");
    const other = (
      await prisma.contact.create({ data: { collectionId, name: `Ebay-${Date.now()}`, platform: true } })
    ).id;
    await assert.rejects(
      () =>
        duplicateOffer(userId, sourceId, {
          platformId: other,
          url: null,
          price: "0.00",
          currency: "EUR",
          listingDate: null,
          state: "active",
        }),
      /asking price/i
    );
  });

  it("refuses to clear the price of an offer already ready or active", async () => {
    const offerId = await preparedOffer("9.00");
    await setOfferState(userId, offerId, "ready");
    await assert.rejects(() => patchOffer(userId, offerId, { price: "0.00" }), /asking price/i);

    await setOfferState(userId, offerId, "active");
    await assert.rejects(() => patchOffer(userId, offerId, { price: "0.00" }), /asking price/i);
    await assert.rejects(
      () =>
        updateOffer(userId, offerId, {
          platformId,
          url: null,
          price: "0.00",
          currency: "EUR",
          listingDate: null,
          state: "active",
        }),
      /asking price/i
    );

    const row = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { price: true } });
    assert.equal(row.price.toFixed(2), "9.00");
  });

  it("leaves a paused offer's price editable — it is not live", async () => {
    const offerId = await preparedOffer("9.00");
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    await setOfferState(userId, offerId, "paused");

    await patchOffer(userId, offerId, { price: "0.00" });
    await assert.rejects(() => setOfferState(userId, offerId, "active"), /asking price/i);
  });
});
