import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { describeMissingCost, type CostGaps } from "../../src/lib/offer-cost";
import { addOfferSet, createOffer, getOfferDetail, readPrepareOffers } from "../../src/lib/offers";

// An offer's Cost is never `—` without saying why (#2436). The wording has its unit test; what this
// covers is that both offer reads count the copies no longer held by why — they are left out of the
// holdings summary, so nothing else can — and the copies an offer holds at all.
//
//  - an offer whose one copy was marked not delivered;
//  - an offer of a copy marked damaged, one disposed of after it was listed, and one held at 2.00;
//  - an offer with no copies.

const TS = Date.now();

describe("an offer's cost says why it is missing (#2436)", () => {
  let userId: string;
  let collectionId: string;
  let notDeliveredOfferId: string;
  let mixedOfferId: string;
  let emptyOfferId: string;

  before(async () => {
    userId = `test-user-costwhy-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-costwhy-${TS}`, name: "Cost why", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Eagle" } })).id;
    let itemNo = 900;
    const copy = async (data: { deliveryState?: string; disposedAt?: Date; costBasis?: string }) =>
      (await prisma.item.create({ data: { collectionId, itemNo: itemNo++, stampId, ...data } })).id;

    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
    const offer = () =>
      createOffer(userId, collectionId, { platformId, url: null, price: "10.00", currency: "EUR", listingDate: null });

    notDeliveredOfferId = await offer();
    await addOfferSet(userId, notDeliveredOfferId, [await copy({ deliveryState: "not_delivered" })]);

    mixedOfferId = await offer();
    await addOfferSet(userId, mixedOfferId, [await copy({ deliveryState: "damaged" })]);
    // A disposed copy cannot be added to an offer (#394), so it is disposed of once listed.
    const disposed = await copy({});
    await addOfferSet(userId, mixedOfferId, [disposed, await copy({ costBasis: "2.00" })]);
    await prisma.item.update({ where: { id: disposed }, data: { disposedAt: new Date("2026-10-01") } });

    emptyOfferId = await offer();
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // The Cost row's note, as the price table and strip compose it.
  const why = (o: {
    costUnconvertible: boolean;
    baseCurrency: string;
    currency: string;
    setsTotals: { costGaps: CostGaps; copyCount: number };
  }) =>
    describeMissingCost({
      unconvertible: o.costUnconvertible ? { from: o.baseCurrency, to: o.currency } : null,
      gaps: o.setsTotals.costGaps,
      copyCount: o.setsTotals.copyCount,
    });

  it("names an offer's only copy, not delivered, beside a Cost of —", async () => {
    const detail = (await getOfferDetail(userId, notDeliveredOfferId))!;
    assert.equal(detail.costPrice, null);
    assert.equal(detail.costUnconvertible, false);
    assert.deepEqual(why(detail), ["1 copy not delivered"]);

    const [row] = await readPrepareOffers(userId, collectionId, [notDeliveredOfferId], ["preparing"]);
    assert.equal(row.costPrice, null);
    assert.deepEqual(why(row), ["1 copy not delivered"]);
  });

  it("leaves the copies no longer held out of a figure, and counts them by why", async () => {
    const detail = (await getOfferDetail(userId, mixedOfferId))!;
    const [damaged, rest] = detail.sets;
    assert.equal(damaged.cost.amount, null);
    assert.deepEqual(damaged.cost.notHeld, { notDelivered: 0, damaged: 1, disposed: 0 });
    assert.equal(rest.cost.amount, "2.00");
    assert.deepEqual(rest.cost.notHeld, { notDelivered: 0, damaged: 0, disposed: 1 });
    assert.equal(detail.costPrice, "2.00");
    assert.deepEqual(detail.setsTotals.costGaps, {
      unrecorded: 0,
      unestimated: 0,
      noOpeningValue: 0,
      notDelivered: 0,
      damaged: 1,
      disposed: 1,
    });

    const [row] = await readPrepareOffers(userId, collectionId, [mixedOfferId], ["preparing"]);
    assert.deepEqual(row.setsTotals.costGaps, detail.setsTotals.costGaps);
    assert.equal(row.setsTotals.copyCount, 3);
  });

  it("says no copies on an offer with none", async () => {
    const detail = (await getOfferDetail(userId, emptyOfferId))!;
    assert.equal(detail.costPrice, null);
    assert.equal(detail.setsTotals.copyCount, 0);
    assert.deepEqual(why(detail), ["no copies"]);

    const [row] = await readPrepareOffers(userId, collectionId, [emptyOfferId], ["preparing"]);
    assert.deepEqual(why(row), ["no copies"]);
  });
});
