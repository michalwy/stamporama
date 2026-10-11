import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  OfferActionBlockedError,
  removeOfferSetsSoldElsewhere,
  setOfferState,
} from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";

// *Remove sets sold elsewhere* (#1805), against a real database: of an active offer's sets it removes
// exactly the ones whose copy sold through another offer — not a set sold through this offer, not one
// still for sale, not one the confirmation did not list — and leaves the listing flagged out of step.
// With nothing left to sell it removes nothing.

describe("removing an offer's sets sold elsewhere (#1805)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let saleId: string;

  const newItem = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  const newOffer = async () => {
    const id = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "10.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    return id;
  };
  const goLive = async (id: string) => {
    await setOfferState(userId, id, "ready");
    await setOfferState(userId, id, "active");
  };
  const setIdsOf = async (offerId: string) =>
    (await prisma.offerSet.findMany({ where: { offerId }, select: { id: true } })).map((s) => s.id).sort();

  before(async () => {
    const ts = Date.now();
    userId = `test-user-soldelsewhere-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User soldelsewhere-${ts}`,
        email: `test-soldelsewhere-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-soldelsewhere-${ts}`, name: `Collection soldelsewhere-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Copernicus", issuedYear: 1973 } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** An active offer of four sets: one sold through it, one for sale, two whose copy sold through
   *  another active offer. */
  async function scenario() {
    const [soldHereCopy, keptCopy, elsewhereA, elsewhereB] = [
      await newItem(),
      await newItem(),
      await newItem(),
      await newItem(),
    ];
    const offerId = await newOffer();
    const soldHere = await addOfferSet(userId, offerId, [soldHereCopy]);
    const kept = await addOfferSet(userId, offerId, [keptCopy]);
    const goneA = await addOfferSet(userId, offerId, [elsewhereA]);
    const goneB = await addOfferSet(userId, offerId, [elsewhereB]);
    const other = await newOffer();
    const otherA = await addOfferSet(userId, other, [elsewhereA]);
    const otherB = await addOfferSet(userId, other, [elsewhereB]);
    await goLive(offerId);
    await goLive(other);
    await addSaleLines(userId, saleId, [
      { offerId, offerSetId: soldHere, price: "10.00", itemIds: [soldHereCopy] },
      { offerId: other, offerSetId: otherA, price: "10.00", itemIds: [elsewhereA] },
      { offerId: other, offerSetId: otherB, price: "10.00", itemIds: [elsewhereB] },
    ]);
    // Start from a listing in step, so the flag afterwards is this action's.
    await prisma.offer.update({ where: { id: offerId }, data: { listingContentChangedAt: null } });
    return { offerId, soldHere, kept, goneA, goneB };
  }

  it("names each set sold elsewhere with the sale that took it", async () => {
    const { offerId, soldHere, kept, goneA, goneB } = await scenario();
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(detail);
    const byId = new Map(detail.sets.map((s) => [s.id, s]));
    const saleNo = (await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).saleNo;
    for (const id of [goneA, goneB]) {
      assert.equal(byId.get(id)!.soldElsewhere, true);
      assert.deepEqual(byId.get(id)!.soldElsewhereSale, { id: saleId, saleNo });
    }
    for (const id of [soldHere, kept]) {
      assert.equal(byId.get(id)!.soldElsewhere, false);
      assert.equal(byId.get(id)!.soldElsewhereSale, null);
    }
  });

  it("removes exactly the sets sold elsewhere and flags the listing out of step", async () => {
    const { offerId, soldHere, kept, goneA, goneB } = await scenario();
    const result = await removeOfferSetsSoldElsewhere(userId, offerId, [goneA, goneB]);
    assert.equal(result.removed, 2);
    assert.deepEqual(await setIdsOf(offerId), [soldHere, kept].sort());
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    assert.ok(offer.listingContentChangedAt, "the listing is out of step with the offer");
  });

  it("removes only what the confirmation listed, and nothing it did not", async () => {
    const { offerId, soldHere, kept, goneA, goneB } = await scenario();
    // A set id that is not sold elsewhere is ignored even when sent.
    const result = await removeOfferSetsSoldElsewhere(userId, offerId, [goneA, kept, soldHere]);
    assert.equal(result.removed, 1);
    assert.deepEqual(await setIdsOf(offerId), [soldHere, kept, goneB].sort());
  });

  it("refuses when nothing would be left to sell", async () => {
    const elsewhere = await newItem();
    const offerId = await newOffer();
    const gone = await addOfferSet(userId, offerId, [elsewhere]);
    const other = await newOffer();
    const otherSet = await addOfferSet(userId, other, [elsewhere]);
    await goLive(offerId);
    await goLive(other);
    await addSaleLines(userId, saleId, [{ offerId: other, offerSetId: otherSet, price: "10.00", itemIds: [elsewhere] }]);

    await assert.rejects(
      removeOfferSetsSoldElsewhere(userId, offerId, [gone]),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "sold-elsewhere"
    );
    assert.deepEqual(await setIdsOf(offerId), [gone]);
  });

  it("refuses when no listed set is sold elsewhere", async () => {
    const { offerId, kept } = await scenario();
    await assert.rejects(
      removeOfferSetsSoldElsewhere(userId, offerId, [kept]),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "sold-elsewhere"
    );
  });

  it("refuses another collector's offer", async () => {
    const { offerId, goneA } = await scenario();
    await assert.rejects(removeOfferSetsSoldElsewhere("someone-else", offerId, [goneA]));
    assert.ok((await setIdsOf(offerId)).includes(goneA));
  });
});
