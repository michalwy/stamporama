import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  disposeItem,
  restoreItem,
  listItemsPaginated,
  getHoldingsValuation,
} from "../../src/lib/items";
import { countCopiesByStamp } from "../../src/lib/copy-counts";

// The disposal axis (#394) and what it takes out of the books (#396). See the ADR-0009 addendum:
// disposal is orthogonal to delivery and disposition, it never touches the allocation, and what it
// removes from collection value reappears as a write-off rather than vanishing.

async function seedFixtures(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: `test-user-disposal-${suffix}`,
      name: "Disposal",
      email: `test-disposal-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-disposal-${suffix}`,
      name: "Disposal",
      baseCurrency: "EUR",
      ownerId: user.id,
    },
  });
  const stamp = await prisma.stamp.create({
    data: { collectionId: collection.id, name: "Stamp 1" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId: collection.id, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  return { userId: user.id, collectionId: collection.id, stampId: stamp.id, conditionId: condition.id };
}

describe("item disposal (#394)", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;

  before(async () => {
    f = await seedFixtures(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
    await prisma.user.delete({ where: { id: f.userId } });
  });

  async function addCopy(deliveryState = "delivered") {
    return createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      deliveryState,
    });
  }

  it("records the reason, the note and the timestamp", async () => {
    const copy = await addCopy();
    const disposed = await disposeItem(f.userId, copy.id, {
      reason: "other",
      note: "given away",
    });
    assert.notEqual(disposed.disposedAt, null);
    assert.equal(disposed.disposalReason, "other");
    assert.equal(disposed.disposalNote, "given away");
  });

  it("demands a note for `other` — the reason alone says only that the copy is gone", async () => {
    const copy = await addCopy();
    await assert.rejects(() => disposeItem(f.userId, copy.id, { reason: "other", note: "  " }));
    const after = await prisma.item.findUnique({ where: { id: copy.id } });
    assert.equal(after!.disposedAt, null);
  });

  it("refuses a copy that has not arrived — that is the delivery axis's business", async () => {
    const copy = await addCopy("in_transit");
    await assert.rejects(
      () => disposeItem(f.userId, copy.id, { reason: "lost" }),
      /has not arrived/
    );
  });

  it("refuses a copy held by a live offer, naming it", async () => {
    const copy = await addCopy();
    const platform = await prisma.contact.create({
      data: { collectionId: f.collectionId, name: "Marketplace", platform: true },
    });
    const offer = await prisma.offer.create({
      data: {
        collectionId: f.collectionId,
        // Past the collection's counter: this row bypasses `allocateOfferNumber` (#416).
        offerNo: 9001,
        platformId: platform.id,
        name: "Lot 7",
        price: "10.00",
        currency: "EUR",
        state: "active",
        sets: { create: { title: null, items: { create: { itemId: copy.id } } } },
      },
    });
    await assert.rejects(() => disposeItem(f.userId, copy.id, { reason: "lost" }), /Lot 7/);

    // Withdrawn, it holds nothing back any more.
    await prisma.offer.update({ where: { id: offer.id }, data: { state: "withdrawn" } });
    const disposed = await disposeItem(f.userId, copy.id, { reason: "lost" });
    assert.equal(disposed.disposalReason, "lost");
  });

  it("leaves the purchase link and the internal number alone", async () => {
    const copy = await addCopy();
    await prisma.item.update({ where: { id: copy.id }, data: { costBasis: "4.50" } });
    const disposed = await disposeItem(f.userId, copy.id, { reason: "damaged" });
    assert.equal(Number(disposed.costBasis), 4.5);
    assert.equal(disposed.itemNo, copy.itemNo);
  });

  it("reverses completely — a restored copy is indistinguishable from one never disposed of", async () => {
    const copy = await addCopy();
    await disposeItem(f.userId, copy.id, { reason: "lost" });
    const restored = await restoreItem(f.userId, copy.id);
    assert.equal(restored.disposedAt, null);
    assert.equal(restored.disposalReason, null);
    assert.equal(restored.disposalNote, null);
    await assert.rejects(() => restoreItem(f.userId, copy.id), /not marked/);
  });
});

describe("what disposal takes out of the books (#396)", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  let heldId: string;
  let goneId: string;
  let undeliveredId: string;

  before(async () => {
    f = await seedFixtures(`books-${Date.now()}`);
    const mk = async (deliveryState: string, costBasis: string) => {
      const copy = await createItem(f.userId, f.collectionId, {
        stampId: f.stampId,
        conditionId: f.conditionId,
        deliveryState,
      });
      await prisma.item.update({ where: { id: copy.id }, data: { costBasis } });
      return copy.id;
    };
    heldId = await mk("delivered", "10.00");
    goneId = await mk("delivered", "4.00");
    undeliveredId = await mk("damaged", "1.00");
    await disposeItem(f.userId, goneId, { reason: "lost" });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
    await prisma.user.delete({ where: { id: f.userId } });
  });

  it("hides disposed copies from the list, and brings them back on request", async () => {
    const held = await listItemsPaginated(f.userId, f.collectionId, {});
    assert.deepEqual(
      held.items.map((i) => i.id).sort(),
      [heldId, undeliveredId].sort()
    );
    const all = await listItemsPaginated(f.userId, f.collectionId, { includeDisposed: true });
    assert.equal(all.items.length, 3);
  });

  it("counts only held copies towards purchase cost, and the rest as a write-off", async () => {
    const total = await getHoldingsValuation(f.userId, f.collectionId, {});
    // Only the delivered, undisposed copy is still the collector's.
    assert.equal(total.cost.totalCostBasis, "10.00");
    assert.equal(total.cost.knownCount, 1);
    // Both the disposed copy and the damaged one, at what they cost.
    assert.equal(total.writeOff.count, 2);
    assert.equal(total.writeOff.cost.totalCostBasis, "5.00");
  });

  it("drops them from the copies-held badge", async () => {
    const counts = await countCopiesByStamp(f.collectionId, [f.stampId]);
    assert.equal(counts.get(f.stampId)!.total, 1);
  });
});
