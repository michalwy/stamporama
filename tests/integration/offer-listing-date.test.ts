import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";

// Publishing stamps the listing date (#320). `ready → active` is the moment a listing actually goes
// live on the platform, so it is the one transition that writes the date — and the only one. What
// this pins down is as much what it does *not* touch: a resume, a step backwards, and an offer
// created directly as `active` (#257) all keep whatever date they had.

/** Today at UTC midnight — the shape `Offer.listingDate` (`@db.Date`) stores. */
function today(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

describe("offer listing date on publication (#320)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listdate-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listdate-${ts}`,
        email: `test-listdate-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-listdate-${ts}`,
        name: `Collection listdate-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp L" } })).id;
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

  /** A composed `preparing` offer with one set, ready to be walked forward. */
  async function preparedOffer(listingDate: Date | null): Promise<string> {
    const itemId = (
      await createItem(userId, collectionId, { stampId, conditionId, forSale: true })
    ).id;
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [itemId]);
    return offerId;
  }

  const dateOf = async (offerId: string) =>
    (
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { listingDate: true },
      })
    ).listingDate;

  it("stamps today when a ready offer is activated", async () => {
    const offerId = await preparedOffer(null);
    await setOfferState(userId, offerId, "ready");
    assert.equal(await dateOf(offerId), null, "marking ready is not publishing");

    await setOfferState(userId, offerId, "active");
    assert.deepEqual(await dateOf(offerId), today());
  });

  it("overwrites a date carried in from creation, because that offer went live now", async () => {
    const old = new Date("2020-01-02T00:00:00.000Z");
    const offerId = await preparedOffer(old);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    assert.deepEqual(await dateOf(offerId), today());
  });

  it("leaves the date alone on every other transition", async () => {
    const offerId = await preparedOffer(null);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "preparing");
    assert.equal(await dateOf(offerId), null, "stepping back is not publishing");

    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const published = await dateOf(offerId);

    // Resuming is not a first publication: the date the listing actually went up must survive it.
    const backdated = new Date("2019-03-04T00:00:00.000Z");
    await prisma.offer.update({ where: { id: offerId }, data: { listingDate: backdated } });
    await setOfferState(userId, offerId, "paused");
    assert.deepEqual(await dateOf(offerId), backdated);
    await setOfferState(userId, offerId, "active");
    assert.deepEqual(await dateOf(offerId), backdated, "resume leaves the correction standing");

    assert.deepEqual(published, today(), "and the publication itself did stamp it");
  });

  it("keeps the date typed into the creation dialog when the offer is created active", async () => {
    // The exception the issue calls out: created straight as `active` (#257), the offer never passes
    // through `setOfferState`, so what the collector entered stands.
    const typed = new Date("2021-06-07T00:00:00.000Z");
    const itemId = (
      await createItem(userId, collectionId, { stampId, conditionId, forSale: true })
    ).id;
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: typed,
        state: "active",
      },
      { seedItemIds: [itemId] }
    );
    assert.deepEqual(await dateOf(offerId), typed);
  });
});
