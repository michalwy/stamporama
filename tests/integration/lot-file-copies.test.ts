import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createLot,
  intakeStamps,
  bulkUpdateLotItems,
  bulkUpdateLotItemsScoped,
} from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";
import { getLocationRefUsage } from "../../src/lib/locations";

// Filing sorted copies in one action (#565): a location, an optional in-location ref, and
// `delivered`, written together. The three things pinned here are the ones a collector cannot see
// going wrong until the box is already full — that the ref lands beside the location it belongs to,
// that the counter belongs to the **location** rather than to a lot (the box is shared across every
// purchase), and that "everything matching the current filter" means the filtered set on the server
// rather than whatever rows happened to be loaded.

describe("filing sorted copies (#565)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let boxId: string;
  let albumId: string;

  /** An arrived order with one lot, so its copies are created `to_sort` — the work unit here. */
  async function arrivedLot(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    return createLot(userId, purchase.id, 10);
  }

  async function addCopies(lotId: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [copy] = await intakeStamps(userId, lotId, { stampId, conditionId });
      ids.push(copy.itemId);
    }
    return ids;
  }

  async function readCopies(ids: string[]) {
    return prisma.item.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        locationId: true,
        locationRef: true,
        deliveryState: true,
        inCollection: true,
        forSale: true,
      },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-file-copies-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User file-copies-${ts}`,
        email: `test-file-copies-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-file-copies-${ts}`,
        name: `Collection file-copies-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;

    const box = await prisma.location.create({
      data: { collectionId, name: "Stock box", assignable: true },
    });
    boxId = box.id;
    const album = await prisma.location.create({
      data: { collectionId, name: "Album", assignable: true },
    });
    albumId = album.id;
  });

  it("files a selection into a location under a ref and marks it delivered", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 3);
    // A copy already carrying a disposition, to pin that filing leaves it standing: the work unit
    // is `to sort` whatever the copy is destined for.
    await prisma.item.update({ where: { id: ids[0] }, data: { forSale: true } });

    const result = await bulkUpdateLotItems(userId, ids, {
      markSorted: true,
      keepDisposition: true,
      locationId: boxId,
      locationRef: "A147",
    });
    assert.equal(result.count, 3);

    const copies = await readCopies(ids);
    for (const copy of copies) {
      assert.equal(copy.locationId, boxId);
      assert.equal(copy.locationRef, "A147");
      assert.equal(copy.deliveryState, "delivered");
    }
    assert.equal(copies.find((c) => c.id === ids[0])!.forSale, true);
    assert.equal(copies.find((c) => c.id === ids[1])!.forSale, false);
    // No disposition was written, so nothing was pushed into the collection either.
    assert.equal(copies.every((c) => c.inCollection === false), true);
  });

  it("files into an album with no ref at all", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 2);

    await bulkUpdateLotItems(userId, ids, {
      markSorted: true,
      keepDisposition: true,
      locationId: albumId,
      locationRef: "",
    });

    for (const copy of await readCopies(ids)) {
      assert.equal(copy.locationId, albumId);
      assert.equal(copy.locationRef, null);
      assert.equal(copy.deliveryState, "delivered");
    }
  });

  it("refuses a ref with no location to sit in", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await assert.rejects(
      () => bulkUpdateLotItems(userId, ids, { markSorted: true, locationRef: "A1" }),
      /location is needed/i
    );
  });

  it("clears the ref along with the location", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await bulkUpdateLotItems(userId, ids, { locationId: boxId, locationRef: "A900" });

    await bulkUpdateLotItems(userId, ids, { locationId: null });
    const [copy] = await readCopies(ids);
    assert.equal(copy.locationId, null);
    assert.equal(copy.locationRef, null);
  });

  it("counts the refs a location holds and suggests the next one", async () => {
    const location = await prisma.location.create({
      data: { collectionId, name: `Counter box ${Date.now()}`, assignable: true },
    });
    const lotId = await arrivedLot();
    const first = await addCopies(lotId, 2);
    await bulkUpdateLotItems(userId, first, { locationId: location.id, locationRef: "A10" });

    const afterFirst = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(afterFirst.refs, [{ ref: "A10", count: 2 }]);
    assert.equal(afterFirst.suggestion, "A11");

    // The counter belongs to the **location**, not the lot: a second purchase filing into the same
    // box continues the strip rather than starting its own.
    const otherLotId = await arrivedLot();
    const second = await addCopies(otherLotId, 1);
    await bulkUpdateLotItems(userId, second, { locationId: location.id, locationRef: "A11" });

    const afterSecond = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(afterSecond.refs, [
      { ref: "A10", count: 2 },
      { ref: "A11", count: 1 },
    ]);
    assert.equal(afterSecond.suggestion, "A12");

    // Topping the same card up is the ordinary path, and the count is what the dialog confirms on.
    const third = await addCopies(otherLotId, 3);
    await bulkUpdateLotItems(userId, third, { locationId: location.id, locationRef: "A11" });
    const topped = await getLocationRefUsage(userId, collectionId, location.id);
    assert.equal(topped.refs.find((r) => r.ref === "A11")!.count, 4);
  });

  it("suggests nothing for a location nothing has ever been ref'd in", async () => {
    const location = await prisma.location.create({
      data: { collectionId, name: `Blank album ${Date.now()}`, assignable: true },
    });
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await bulkUpdateLotItems(userId, ids, { locationId: location.id, locationRef: "" });

    const usage = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(usage.refs, []);
    assert.equal(usage.suggestion, null);
  });

  it("files everything matching the list's filter, not just the loaded rows", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 4);
    // Two copies taken out of the `to sort` worklist by hand, exactly as the chip would show.
    await bulkUpdateLotItems(userId, ids.slice(0, 2), { deliveryState: "delivered" });

    const result = await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { lotId, filter: "to-sort" },
      { markSorted: true, keepDisposition: true, locationId: boxId, locationRef: "B1" }
    );
    assert.equal(result.count, 2);

    const copies = await readCopies(ids);
    for (const id of ids.slice(0, 2)) {
      assert.equal(copies.find((c) => c.id === id)!.locationRef, null);
    }
    for (const id of ids.slice(2)) {
      const copy = copies.find((c) => c.id === id)!;
      assert.equal(copy.locationRef, "B1");
      assert.equal(copy.locationId, boxId);
      assert.equal(copy.deliveryState, "delivered");
    }
  });

  it("resolves the unpriced filter, which no column carries", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 3);
    // A copy excluded from the allocation is not a blocker, so the `unpriced` chip skips it — none
    // of these carry a catalog price, so that exclusion is the only thing separating them.
    await bulkUpdateLotItems(userId, ids.slice(0, 1), { deliveryState: "not_delivered" });

    const result = await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { lotId, filter: "unpriced" },
      { locationId: boxId, locationRef: "C1" }
    );
    assert.equal(result.count, 2);

    const copies = await readCopies(ids);
    assert.equal(copies.find((c) => c.id === ids[0])!.locationRef, null);
    assert.equal(copies.find((c) => c.id === ids[1])!.locationRef, "C1");
    assert.equal(copies.find((c) => c.id === ids[2])!.locationRef, "C1");
  });
});
