import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  findOfferCollisions,
  listOffersPaginated,
  publishOffer,
  recordOfferListed,
  setOfferState,
} from "../../src/lib/offers";
import { rejectOfferOrPost } from "../../src/lib/facebook-posts";
import { addSaleLines, createSale, listSellableOffers } from "../../src/lib/sales";

// An offer **waiting for approval** (#1778): submitted to a platform or a Facebook group that holds
// posts for an administrator, so it is neither Ready (it has gone out) nor Active (nobody can see it
// yet). What a database has to answer, and so what is checked here: the moves into and out of
// Pending, what each does to the link and the dates, and that a pending listing protects its copies
// exactly as an active one does. The state machine itself is `tests/unit/offer-rules.test.ts`.

describe("the Pending offer state (#1778)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-pending-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-pending-${ts}`, name: `pending-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })
    ).id;
    otherPlatformId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp P" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A priced `ready` offer over `itemIds` on `platform`. */
  async function readyOffer(itemIds: string[], platform = platformId): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: platform,
      url: null,
      price: "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, itemIds);
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const read = (offerId: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, url: true, listingDate: true, closedAt: true, listingContentChangedAt: true },
    });

  it("submits a ready offer with its pending link, and dates nothing yet", async () => {
    const offerId = await readyOffer([await newItem()]);
    await prisma.offer.update({ where: { id: offerId }, data: { listingContentChangedAt: new Date() } });

    await publishOffer(userId, offerId, "https://example.com/pending/1", "pending");
    const offer = await read(offerId);
    assert.equal(offer.state, "pending");
    assert.equal(offer.url, "https://example.com/pending/1");
    assert.equal(offer.listingDate, null, "nobody can see it yet, so it has not been listed");
    assert.equal(offer.listingContentChangedAt, null, "what was submitted is what the record says");
  });

  it("approves it with the final link, which replaces the pending one and dates the listing", async () => {
    const offerId = await readyOffer([await newItem()]);
    await publishOffer(userId, offerId, "https://example.com/pending/2", "pending");

    await publishOffer(userId, offerId, "https://example.com/listing/2");
    const offer = await read(offerId);
    assert.equal(offer.state, "active");
    assert.equal(offer.url, "https://example.com/listing/2");
    assert.notEqual(offer.listingDate, null, "approval is when it went up");
  });

  it("takes a rejected offer back to Ready, the pending link cleared", async () => {
    const offerId = await readyOffer([await newItem()]);
    await publishOffer(userId, offerId, "https://example.com/pending/3", "pending");

    await rejectOfferOrPost(userId, offerId);
    const offer = await read(offerId);
    assert.equal(offer.state, "ready");
    assert.equal(offer.url, null);
  });

  it("withdraws a pending offer, closing it", async () => {
    const offerId = await readyOffer([await newItem()]);
    await setOfferState(userId, offerId, "pending");
    await setOfferState(userId, offerId, "withdrawn");
    const offer = await read(offerId);
    assert.equal(offer.state, "withdrawn");
    assert.notEqual(offer.closedAt, null);
  });

  it("refuses every other move into or out of Pending", async () => {
    const preparing = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, preparing, [await newItem()]);
    await assert.rejects(() => setOfferState(userId, preparing, "pending"), /Cannot move/);

    const active = await readyOffer([await newItem()]);
    await setOfferState(userId, active, "active");
    await assert.rejects(() => setOfferState(userId, active, "pending"), /Cannot move/);

    const pending = await readyOffer([await newItem()]);
    await setOfferState(userId, pending, "pending");
    for (const to of ["preparing", "paused"] as const) {
      await assert.rejects(() => setOfferState(userId, pending, to), /Cannot move/, `pending → ${to}`);
    }
    assert.equal((await read(pending)).state, "pending");
  });

  it("refuses to submit an offer with nothing in it", async () => {
    const offerId = await readyOffer([await newItem()]);
    await prisma.offerSet.deleteMany({ where: { offerId } });
    await assert.rejects(() => setOfferState(userId, offerId, "pending"), /submitting this offer for approval/);
  });

  it("fills in a blank link the Assistant captures for a pending offer, without approving it", async () => {
    const offerId = await readyOffer([await newItem()]);
    await setOfferState(userId, offerId, "pending");
    assert.equal(await recordOfferListed(userId, offerId, "https://example.com/pending/4"), "url-recorded");
    const offer = await read(offerId);
    assert.equal(offer.state, "pending");
    assert.equal(offer.url, "https://example.com/pending/4");
  });

  it("warns of a second listing of the same copy on the same platform", async () => {
    const itemId = await newItem();
    const pending = await readyOffer([itemId]);
    await setOfferState(userId, pending, "pending");

    const collisions = await findOfferCollisions(userId, collectionId, [itemId], platformId);
    assert.deepEqual(collisions.map((c) => c.offerId), [pending]);
  });

  it("can be sold, and flags a pending listing whose copy sold elsewhere", async () => {
    const itemId = await newItem();
    const pending = await readyOffer([itemId]);
    await setOfferState(userId, pending, "pending");
    const elsewhere = await readyOffer([itemId], otherPlatformId);
    await setOfferState(userId, elsewhere, "pending");

    const sellable = await listSellableOffers(userId, collectionId, { platformId: otherPlatformId });
    assert.ok(sellable.some((o) => o.offerId === elsewhere), "a buyer may answer a post before approval");

    const saleId = await createSale(userId, collectionId, {
      platformId: otherPlatformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const setId = (await prisma.offerSet.findFirstOrThrow({ where: { offerId: elsewhere } })).id;
    await addSaleLines(userId, saleId, [{ offerId: elsewhere, offerSetId: setId, price: "12.50", itemIds: [itemId] }]);
    assert.equal((await read(elsewhere)).state, "sold");

    const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.ok(
      flagged.items.some((o) => o.id === pending && o.needsAction),
      "the pending listing still holds a copy that has gone"
    );
  });
});
