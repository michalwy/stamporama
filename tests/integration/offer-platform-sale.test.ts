import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  listOffersPaginated,
  offerFilterCounts,
  offersNeedingAction,
  offersWithPlatformSale,
  setOfferState,
  unrecordedPlatformSales,
} from "../../src/lib/offers";
import { getAllegroWorklist } from "../../src/lib/allegro-worklist";

// A listing that sold on Allegro with no sale recorded here (#499).
//
// What needs a real database is the agreement between three readings of one fact: the *Sold on
// Allegro* worklist, the flag on the offer row, and the cascade that flags every other listing
// holding the same copies. They are one derivation seen from three screens, and the whole point of
// sharing `claimCovers` is that they cannot drift apart — including on the case that made this
// necessary, an order Allegro reports as **not paid**.

describe("offers sold on a platform without a recorded sale (#499)", () => {
  let userId: string;
  let collectionId: string;
  let allegroId: string;
  let otherPlatformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-platformsale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User platformsale-${ts}`,
        email: `test-platformsale-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-platformsale-${ts}`,
          name: `Collection platformsale-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    allegroId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformModule: "allegro" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp A" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  /** A live listing holding `items`, on the platform given. */
  async function liveOffer(
    platformId: string,
    name: string,
    itemIds: string[]
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "20.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await prisma.offer.update({ where: { id: offerId }, data: { name } });
    await addOfferSet(userId, offerId, itemIds);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return offerId;
  }

  /** An observed Allegro order against `offerId`, as the sync would have recorded it. */
  async function order(
    offerId: string,
    orderId: string,
    paymentStatus: "paid" | "unpaid" | "cancelled",
    boughtAt = new Date()
  ): Promise<void> {
    const row = await prisma.allegroOrder.create({
      data: {
        collectionId,
        orderId,
        status: paymentStatus === "cancelled" ? "CANCELLED" : "BOUGHT",
        paymentStatus,
        boughtAt,
        currency: "PLN",
        observedAt: new Date(),
      },
    });
    await prisma.allegroOrderLine.create({
      data: {
        collectionId,
        allegroOrderId: row.id,
        lineItemId: `${orderId}-1`,
        platformOfferId: `1000${orderId}`,
        title: "Listing",
        quantity: 1,
        unitPrice: "20.00",
        currency: "PLN",
        boughtAt,
        offerId,
        matchedBy: "external",
        observedAt: new Date(),
      },
    });
  }

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  const flagOn = async (offerId: string) =>
    (await listOffersPaginated(userId, collectionId, {})).items.find((o) => o.id === offerId)
      ?.platformSale ?? null;

  it("flags an unpaid order, which is the case the offer list said nothing about", async () => {
    const item = await newItem();
    const offerId = await liveOffer(allegroId, "Sold, not paid", [item]);
    await order(offerId, "ord-unpaid", "unpaid");

    const flag = await flagOn(offerId);
    assert.equal(flag?.orderId, "ord-unpaid");
    assert.equal(flag?.paymentStatus, "unpaid");
    // The state is deliberately untouched: recording the sale is what makes an offer sold.
    const row = (await listOffersPaginated(userId, collectionId, {})).items.find(
      (o) => o.id === offerId
    );
    assert.equal(row?.state, "active");

    const filtered = await listOffersPaginated(userId, collectionId, { platformSale: true });
    assert.deepEqual(
      filtered.items.map((o) => o.id),
      [offerId]
    );
    assert.equal((await offerFilterCounts(userId, collectionId, {})).platformSale, 1);
  });

  it("flags every other listing holding those copies as needing action", async () => {
    const item = await newItem();
    const soldId = await liveOffer(allegroId, "Sold on Allegro", [item]);
    const twinId = await liveOffer(otherPlatformId, "Still up on Delcampe", [item]);
    await order(soldId, "ord-cascade", "unpaid");

    const flagged = await offersNeedingAction(userId, collectionId, 5);
    const conflicted = flagged["platform-sale-conflict"].offers.map((o) => o.offerId);
    assert.ok(conflicted.includes(twinId), "the listing still up is the one that has to come down");
    assert.ok(!conflicted.includes(soldId), "the listing that sold is not conflicting with itself");

    const rows = (await listOffersPaginated(userId, collectionId, {})).items;
    assert.equal(rows.find((o) => o.id === twinId)?.needsAction, true);
  });

  it("says nothing about a cancelled order — the sale did not happen", async () => {
    const item = await newItem();
    const offerId = await liveOffer(allegroId, "Order cancelled", [item]);
    await order(offerId, "ord-cancelled", "cancelled");
    assert.equal(await flagOn(offerId), null);
  });

  it("clears once a sale carries the order number, exactly as the worklist drops it", async () => {
    const item = await newItem();
    const offerId = await liveOffer(allegroId, "Recorded already", [item]);
    await order(offerId, "ord-recorded", "paid");
    assert.ok(await flagOn(offerId), "flagged before the sale exists");

    const set = await prisma.offerSet.findFirstOrThrow({
      where: { offerId },
      select: { id: true },
    });
    const sale = await prisma.sale.create({
      data: {
        collectionId,
        saleNo: 9001,
        platformId: allegroId,
        soldAt: new Date(),
        currency: "EUR",
        externalRef: "ord-recorded",
      },
    });
    await prisma.saleLine.create({
      data: { saleId: sale.id, offerId, offerSetId: set.id, price: "20.00" },
    });

    assert.equal(await flagOn(offerId), null, "the sale is what clears it");
    // …and the worklist agrees, which is the whole reason the two share `claimCovers`.
    const worklist = await getAllegroWorklist(userId, collectionId);
    assert.ok(!worklist.orders.some((o) => o.orderId === "ord-recorded"));
  });

  it("reports the longest-waiting order first to the notification centre", async () => {
    const older = await liveOffer(allegroId, "Bought a week ago", [await newItem()]);
    await order(
      older,
      "ord-old",
      "unpaid",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    const reported = await offersWithPlatformSale(userId, collectionId, 10);
    const counts = await offerFilterCounts(userId, collectionId, {});
    assert.equal(reported.total, counts.platformSale, "the bell and the chip count one set");
    assert.equal(reported.offers[0].offerId, older);
    assert.equal(reported.offers[0].orderId, "ord-old");
  });

  it("stops looking once the listing itself is closed", async () => {
    const item = await newItem();
    const offerId = await liveOffer(allegroId, "Withdrawn after the order", [item]);
    await order(offerId, "ord-withdrawn", "unpaid");
    assert.ok((await unrecordedPlatformSales(collectionId)).has(offerId));

    await setOfferState(userId, offerId, "withdrawn");
    assert.ok(
      !(await unrecordedPlatformSales(collectionId)).has(offerId),
      "a terminal offer is resolved, whatever the marketplace has since done"
    );
  });
});
