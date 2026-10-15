import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, deleteItem, disposeItem } from "../../src/lib/items";
import { createOffer, addOfferSet } from "../../src/lib/offers";
import {
  cancelReplacement,
  listCopyReplacements,
  listReplacementCandidates,
  listReplacements,
  recordReplacement,
  settleReplacements,
} from "../../src/lib/replacements";

// Replacement pairs (#1936, ADR-0070): recorded from a copy, listed on Replacements, cancelled,
// settled onto the current card, and closed as moot when a copy leaves first.

async function seedFixtures(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: `test-user-replacements-${suffix}`,
      name: "Replacements",
      email: `test-replacements-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-replacements-${suffix}`, name: "Replacements", baseCurrency: "EUR", ownerId: user.id },
  });
  const stamp = await prisma.stamp.create({
    data: { collectionId: collection.id, name: "Stamp 1" },
  });
  const otherStamp = await prisma.stamp.create({
    data: { collectionId: collection.id, name: "Stamp 2" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId: collection.id, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const album = await prisma.location.create({
    data: { collectionId: collection.id, name: "Album", assignable: true },
  });
  const stock = await prisma.location.create({
    data: { collectionId: collection.id, name: "Sale stock", assignable: true },
  });
  const shelf = await prisma.location.create({
    data: { collectionId: collection.id, name: "Shelf", assignable: false },
  });
  const platform = await prisma.contact.create({
    data: { collectionId: collection.id, name: "Delcampe", platform: true, platformCurrency: "EUR" },
  });
  return {
    userId: user.id,
    collectionId: collection.id,
    stampId: stamp.id,
    otherStampId: otherStamp.id,
    conditionId: condition.id,
    albumId: album.id,
    stockId: stock.id,
    shelfId: shelf.id,
    platformId: platform.id,
  };
}

describe("replacement pairs (#1936)", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;

  before(async () => {
    f = await seedFixtures(`${Date.now()}`);
  });

  after(async () => {
    // A sold copy's rows restrict its item, so they go first.
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId: f.collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId: f.collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId: f.collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
    await prisma.user.delete({ where: { id: f.userId } });
  });

  async function addCopy(opts: { stampId?: string; inCollection?: boolean } = {}) {
    const copy = await createItem(f.userId, f.collectionId, {
      stampId: opts.stampId ?? f.stampId,
      conditionId: f.conditionId,
      inCollection: opts.inCollection ?? true,
      forSale: false,
      locationId: f.albumId,
      locationRef: "P3",
    });
    return copy;
  }

  async function pairStatus(id: string) {
    return prisma.itemReplacement.findUniqueOrThrow({ where: { id } });
  }

  it("records a pair that moves nothing, lists it, and shows it on both copies", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const { id } = await recordReplacement(f.userId, f.collectionId, {
      newItemId: newCopy.id,
      oldItemId: oldCopy.id,
    });

    const old = await prisma.item.findUniqueOrThrow({ where: { id: oldCopy.id } });
    assert.equal(old.locationId, f.albumId);
    assert.equal(old.inCollection, true);

    const { open } = await listReplacements(f.userId, f.collectionId);
    const listed = open.find((p) => p.id === id);
    assert.ok(listed, "the pair is listed as open");
    assert.equal(listed.oldCopy?.locationPath, "Album");
    assert.equal(listed.oldCopy?.locationRef, "P3");

    const onNew = await listCopyReplacements(f.userId, f.collectionId, newCopy.id);
    const onOld = await listCopyReplacements(f.userId, f.collectionId, oldCopy.id);
    assert.deepEqual(onNew.map((p) => p.id), [id]);
    assert.deepEqual(onOld.map((p) => p.id), [id]);

    await cancelReplacement(f.userId, f.collectionId, id);
  });

  it("allows one open pair per copy on each side", async () => {
    const a = await addCopy();
    const b = await addCopy();
    const c = await addCopy();
    const { id } = await recordReplacement(f.userId, f.collectionId, { newItemId: b.id, oldItemId: a.id });
    await assert.rejects(
      () => recordReplacement(f.userId, f.collectionId, { newItemId: c.id, oldItemId: a.id }),
      /already being replaced/
    );
    await assert.rejects(
      () => recordReplacement(f.userId, f.collectionId, { newItemId: b.id, oldItemId: c.id }),
      /already replaces another copy/
    );
    // …but a copy may be new in one pair and old in another.
    await recordReplacement(f.userId, f.collectionId, { newItemId: c.id, oldItemId: b.id });

    // The candidate list shows the taken copy as unavailable, with the reason.
    const candidates = await listReplacementCandidates(f.userId, f.collectionId, c.id, "new");
    const forA = candidates.find((x) => x.id === a.id);
    assert.match(forA?.unavailable ?? "", /Already being replaced/);

    // Cancelling frees the side again, and touches neither copy.
    await cancelReplacement(f.userId, f.collectionId, id);
    assert.equal((await pairStatus(id)).status, "cancelled");
    await recordReplacement(f.userId, f.collectionId, { newItemId: b.id, oldItemId: a.id });
  });

  it("refuses a copy replacing itself", async () => {
    const a = await addCopy();
    await assert.rejects(
      () => recordReplacement(f.userId, f.collectionId, { newItemId: a.id, oldItemId: a.id }),
      /cannot replace itself/
    );
  });

  it("offers only held copies of the same stamp as candidates", async () => {
    const a = await addCopy();
    const sameStamp = await addCopy();
    const otherStamp = await addCopy({ stampId: f.otherStampId });
    const gone = await addCopy();
    await disposeItem(f.userId, gone.id, { reason: "lost", note: null });
    const ids = (await listReplacementCandidates(f.userId, f.collectionId, a.id, "new")).map((c) => c.id);
    assert.ok(ids.includes(sameStamp.id));
    assert.ok(!ids.includes(a.id), "never the copy itself");
    assert.ok(!ids.includes(otherStamp.id), "never another stamp's copy");
    assert.ok(!ids.includes(gone.id), "never a copy no longer held");
  });

  it("Done moves the old copy to the current card, out of the collection and for sale", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const other = await addCopy();
    const otherNew = await addCopy();
    const p1 = await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: oldCopy.id });
    const p2 = await recordReplacement(f.userId, f.collectionId, { newItemId: otherNew.id, oldItemId: other.id });

    const result = await settleReplacements(f.userId, f.collectionId, [p1.id, p2.id], {
      locationId: f.stockId,
      locationRef: " A147 ",
    });
    assert.deepEqual(result, { done: 2, skipped: 0 });

    for (const id of [oldCopy.id, other.id]) {
      const moved = await prisma.item.findUniqueOrThrow({ where: { id } });
      assert.equal(moved.locationId, f.stockId);
      assert.equal(moved.locationRef, "A147");
      assert.equal(moved.inCollection, false);
      assert.equal(moved.forSale, true);
      assert.equal(moved.conditionId, f.conditionId, "the condition stays");
    }
    const kept = await prisma.item.findUniqueOrThrow({ where: { id: newCopy.id } });
    assert.equal(kept.locationId, f.albumId, "the new copy stays where it is");
    assert.equal(kept.inCollection, true);

    const settled = await pairStatus(p1.id);
    assert.equal(settled.status, "done");
    assert.notEqual(settled.closedAt, null);

    // Done again is a no-op on a closed pair.
    const again = await settleReplacements(f.userId, f.collectionId, [p1.id], {
      locationId: f.stockId,
      locationRef: "A148",
    });
    assert.deepEqual(again, { done: 0, skipped: 1 });
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: oldCopy.id } })).locationRef, "A147");
  });

  it("refuses a grouping location as the current card", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const p = await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: oldCopy.id });
    await assert.rejects(
      () => settleReplacements(f.userId, f.collectionId, [p.id], { locationId: f.shelfId, locationRef: null }),
      /only groups others/
    );
    assert.equal((await pairStatus(p.id)).status, "open");
    await cancelReplacement(f.userId, f.collectionId, p.id);
  });

  it("closes a pair as moot when the old copy is disposed of, and frees the new copy", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const p = await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: oldCopy.id });
    await disposeItem(f.userId, oldCopy.id, { reason: "lost", note: null });

    const { open, closed } = await listReplacements(f.userId, f.collectionId);
    assert.ok(!open.some((x) => x.id === p.id));
    const moot = closed.find((x) => x.id === p.id);
    assert.equal(moot?.status, "moot");
    assert.equal(moot?.mootReason, "disposed");
    assert.equal(moot?.mootSide, "old");

    // The new copy can be paired again.
    const another = await addCopy();
    await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: another.id });
  });

  it("closes a pair as moot when a copy is deleted, and keeps it on the other copy's history", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const p = await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: oldCopy.id });
    await deleteItem(f.userId, newCopy.id);

    const history = await listCopyReplacements(f.userId, f.collectionId, oldCopy.id);
    const pair = history.find((x) => x.id === p.id);
    assert.equal(pair?.status, "moot");
    assert.equal(pair?.mootReason, "deleted");
    assert.equal(pair?.mootSide, "new");
    assert.equal(pair?.newCopy, null);
    assert.equal(pair?.newItemNo, newCopy.itemNo, "the deleted copy is still named by number");
  });

  it("closes a pair as moot when the old copy is sold", async () => {
    const oldCopy = await addCopy();
    const newCopy = await addCopy();
    const p = await recordReplacement(f.userId, f.collectionId, { newItemId: newCopy.id, oldItemId: oldCopy.id });

    await prisma.item.update({ where: { id: oldCopy.id }, data: { forSale: true } });
    const offerId = await createOffer(f.userId, f.collectionId, {
      platformId: f.platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(f.userId, offerId, [oldCopy.id]);
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true } });
    const sale = await prisma.sale.create({
      data: { collectionId: f.collectionId, saleNo: 9801, platformId: f.platformId, soldAt: new Date(), currency: "EUR" },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId, offerSetId: set.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId: oldCopy.id } });

    // Done on it now settles nothing: the sweep closes it first.
    const result = await settleReplacements(f.userId, f.collectionId, [p.id], {
      locationId: f.stockId,
      locationRef: null,
    });
    assert.deepEqual(result, { done: 0, skipped: 1 });
    const pair = await pairStatus(p.id);
    assert.equal(pair.status, "moot");
    assert.equal(pair.mootReason, "sold");
  });

  it("refuses another collection's owner", async () => {
    await assert.rejects(() => listReplacements("someone-else", f.collectionId), /access denied/);
  });
});
