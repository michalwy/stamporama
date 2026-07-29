import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  addOfferSetsPerCopy,
  addItemsToOfferSet,
  getOfferDetail,
  reorderOfferSets,
  reorderOfferSetItems,
  resetOfferSetItemOrder,
  duplicateOffer,
  OfferActionBlockedError,
} from "../../src/lib/offers";

// Explicit ordering for offer sets and their copies (#306). Sets carry a non-null `sortOrder` the
// collector controls by hand; copies carry a nullable one, where null means "derive from the
// catalog sort key" and a value means hand-corrected. Exercises: derived order out of the box,
// hand correction, where a newly added copy lands, reset, permutation guards, and that duplication
// carries both levels over.

describe("offer set + copy ordering (#306)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  /** Copies of three stamps whose catalog keys are deliberately *not* creation order. */
  let low: string, mid: string, high: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-order-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User order-${ts}`,
        email: `test-order-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-order-${ts}`, name: `Collection order-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });

    // Created high → low, so any catalog ordering is visibly different from creation order.
    const mk = async (name: string, key: number) => {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name, primaryCatalogSortKey: key },
      });
      return (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    };
    high = await mk("Stamp 30", 30);
    mid = await mk("Stamp 20", 20);
    low = await mk("Stamp 10", 10);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newOffer(): Promise<string> {
    return createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
  }

  async function detail(offerId: string) {
    const d = await getOfferDetail(userId, offerId);
    assert.ok(d);
    return d;
  }

  it("orders a fresh set's copies by catalog sort key, not creation order", async () => {
    const offerId = await newOffer();
    await addOfferSet(userId, offerId, [high, mid, low]);
    const d = await detail(offerId);
    assert.deepEqual(d.sets[0].itemIds, [low, mid, high]);
    assert.equal(d.sets[0].manualCopyOrder, false);
  });

  it("gives sets dense, explicit positions in the order they were added", async () => {
    const offerId = await newOffer();
    await addOfferSet(userId, offerId, [low]);
    await addOfferSetsPerCopy(userId, offerId, [mid, high]);
    const rows = await prisma.offerSet.findMany({
      where: { offerId },
      select: { sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);
  });

  it("reorders sets by hand and keeps the order", async () => {
    const offerId = await newOffer();
    await addOfferSetsPerCopy(userId, offerId, [low, mid, high]);
    const before = (await detail(offerId)).sets.map((s) => s.id);
    await reorderOfferSets(userId, offerId, [before[2], before[0], before[1]]);
    const after = (await detail(offerId)).sets.map((s) => s.id);
    assert.deepEqual(after, [before[2], before[0], before[1]]);
  });

  it("rejects a set reorder that is not a full permutation", async () => {
    const offerId = await newOffer();
    await addOfferSetsPerCopy(userId, offerId, [low, mid]);
    const ids = (await detail(offerId)).sets.map((s) => s.id);
    await assert.rejects(
      () => reorderOfferSets(userId, offerId, [ids[0]]),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "bad-order"
    );
    await assert.rejects(
      () => reorderOfferSets(userId, offerId, [ids[0], ids[0]]),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "bad-order"
    );
    // Nothing was half-written.
    assert.deepEqual((await detail(offerId)).sets.map((s) => s.id), ids);
  });

  it("hand-corrects copy order, then appends a later copy at the end", async () => {
    const offerId = await newOffer();
    const setId = await addOfferSet(userId, offerId, [low, high]);
    await reorderOfferSetItems(userId, setId, [high, low]);

    let d = await detail(offerId);
    assert.deepEqual(d.sets[0].itemIds, [high, low]);
    assert.equal(d.sets[0].manualCopyOrder, true);

    // `mid` sorts between the two by catalog key, but the set is hand-ordered: it appends.
    await addItemsToOfferSet(userId, setId, [mid]);
    d = await detail(offerId);
    assert.deepEqual(d.sets[0].itemIds, [high, low, mid]);
  });

  it("slots a copy added to a derived set into its catalog position", async () => {
    const offerId = await newOffer();
    const setId = await addOfferSet(userId, offerId, [low, high]);
    await addItemsToOfferSet(userId, setId, [mid]);
    const d = await detail(offerId);
    assert.deepEqual(d.sets[0].itemIds, [low, mid, high]);
    assert.equal(d.sets[0].manualCopyOrder, false);
  });

  it("resets a hand-corrected set back to derived catalog order", async () => {
    const offerId = await newOffer();
    const setId = await addOfferSet(userId, offerId, [low, mid, high]);
    await reorderOfferSetItems(userId, setId, [high, low, mid]);
    assert.equal((await detail(offerId)).sets[0].manualCopyOrder, true);

    await resetOfferSetItemOrder(userId, setId);
    const d = await detail(offerId);
    assert.deepEqual(d.sets[0].itemIds, [low, mid, high]);
    assert.equal(d.sets[0].manualCopyOrder, false);
    const rows = await prisma.offerSetItem.findMany({ where: { offerSetId: setId }, select: { sortOrder: true } });
    assert.ok(rows.every((r) => r.sortOrder === null));
  });

  it("rejects a copy reorder that is not a full permutation", async () => {
    const offerId = await newOffer();
    const setId = await addOfferSet(userId, offerId, [low, mid]);
    await assert.rejects(
      () => reorderOfferSetItems(userId, setId, [low]),
      (e: unknown) => e instanceof OfferActionBlockedError && e.reason === "bad-order"
    );
    assert.equal((await detail(offerId)).sets[0].manualCopyOrder, false);
  });

  it("carries both orders into a duplicated offer", async () => {
    const offerId = await newOffer();
    const first = await addOfferSet(userId, offerId, [low]);
    const second = await addOfferSet(userId, offerId, [mid, high]);
    await reorderOfferSets(userId, offerId, [second, first]);
    await reorderOfferSetItems(userId, second, [high, mid]);

    const clone = await duplicateOffer(userId, offerId, {
      platformId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const d = await detail(clone.id);
    assert.deepEqual(
      d.sets.map((s) => s.itemIds),
      [[high, mid], [low]]
    );
    assert.deepEqual(d.sets.map((s) => s.manualCopyOrder), [true, false]);
  });
});
