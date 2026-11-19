import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot } from "../../src/lib/lots";
import { countPurchases, createPurchase, listPurchasesPaginated } from "../../src/lib/purchases";
import { discardTile, identifyTileAsNewCopy, parkTile } from "../../src/lib/scan-tiles";

// The Intake documents list's *To identify* (#2582): the documents holding work waiting for
// identification — a tile still to identify, parked ones included, or a scan not yet cut — and the
// row's *N to identify* / *N scans to cut*, which show whatever the filter. What needs a database
// is the two relation counts and the `where` that must agree with them.

describe("Intake documents list — documents with scans still to identify (#2582)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let supplierId: string;
  let otherSupplierId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-intake-to-identify-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User intake-to-identify-${ts}`,
        email: `test-intake-to-identify-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-intake-to-identify-${ts}`, name: "Intake to identify", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp" } })).id;
    supplierId = (await prisma.contact.create({ data: { collectionId, name: "Seller A" } })).id;
    otherSupplierId = (await prisma.contact.create({ data: { collectionId, name: "Seller B" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function sheet(purchaseId: string, batchNo: number, side: "front" | "back" = "front") {
    return prisma.scanSheet.create({
      data: {
        collectionId,
        purchaseId,
        batchNo,
        side,
        storageKey: `test/${purchaseId}/${batchNo}-${side}`,
        mime: "image/png",
        width: 100,
        height: 100,
        viewWidth: 100,
        viewHeight: 100,
        sizeBytes: 1,
      },
    });
  }

  /** A cut card of `count` tiles still waiting, on one lot so identification lands there. */
  async function cutCard(purchaseId: string, batchNo: number, count: number): Promise<string[]> {
    const front = await sheet(purchaseId, batchNo);
    const ids: string[] = [];
    for (let position = 1; position <= count; position++) {
      const tile = await prisma.scanTile.create({
        data: { collectionId, purchaseId, batchNo, position, frontSheetId: front.id },
      });
      ids.push(tile.id);
    }
    return ids;
  }

  async function order(day: string, contactId: string | null = null) {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: day,
      status: "arrived",
      contactId,
    });
    await createLot(userId, purchase.id, 10);
    return purchase.id;
  }

  async function listed(filters: Parameters<typeof listPurchasesPaginated>[2] = {}) {
    const { items } = await listPurchasesPaginated(userId, collectionId, { pageSize: 200, ...filters });
    return items;
  }

  it("lists the document with tiles waiting and the one with an uncut scan, not the finished one", async () => {
    const waiting = await order("2026-11-01", supplierId);
    const tiles = await cutCard(waiting, 1, 14);
    const uncut = await order("2026-11-02", supplierId);
    await sheet(uncut, 1);
    const finished = await order("2026-11-03", supplierId);
    const [first, second] = await cutCard(finished, 1, 2);
    await identifyTileAsNewCopy(userId, first, { stampId, conditionId });
    await discardTile(userId, second, "junk");

    const filtered = await listed({ toIdentify: true });
    assert.deepEqual(
      filtered.map((p) => p.id).sort(),
      [waiting, uncut].sort(),
      "the filter lists the two documents with work waiting"
    );
    assert.equal(await countPurchases(userId, collectionId, { toIdentify: true }), 2);

    // The figures show with the filter off too.
    const all = await listed();
    const row = (id: string) => all.find((p) => p.id === id)!;
    assert.equal(row(waiting).tilesToIdentify, 14);
    assert.equal(row(waiting).scansToCut, 0);
    assert.equal(row(uncut).tilesToIdentify, 0);
    assert.equal(row(uncut).scansToCut, 1);
    assert.equal(row(finished).tilesToIdentify, 0);
    assert.equal(row(finished).scansToCut, 0);

    // Identifying the last waiting tile takes the document off the filtered list.
    for (const [i, tileId] of tiles.entries()) {
      await identifyTileAsNewCopy(userId, tileId, { stampId, conditionId });
      const still = (await listed({ toIdentify: true })).some((p) => p.id === waiting);
      assert.equal(still, i < tiles.length - 1, `after ${i + 1} of ${tiles.length} identified`);
    }
  });

  it("counts a parked tile as waiting, and an uncut back as a scan to cut", async () => {
    const id = await order("2026-11-04");
    const [parked, done] = await cutCard(id, 1, 2);
    await parkTile(userId, parked, "need the catalogue");
    await discardTile(userId, done);
    await sheet(id, 1, "back");

    const row = (await listed({ toIdentify: true })).find((p) => p.id === id);
    assert.ok(row, "a parked tile is still to be identified");
    assert.equal(row.tilesToIdentify, 1);
    assert.equal(row.scansToCut, 1);
  });

  it("ignores the document's status — a completed one with a tile left is listed", async () => {
    const id = await order("2026-11-05");
    await cutCard(id, 1, 1);
    await prisma.purchase.update({ where: { id }, data: { status: "completed" } });
    assert.ok((await listed({ toIdentify: true })).some((p) => p.id === id));
    assert.ok((await listed({ toIdentify: true, statuses: ["completed"] })).some((p) => p.id === id));
  });

  it("combines with Arrived and with a supplier", async () => {
    const mine = await order("2026-11-06", otherSupplierId);
    await cutCard(mine, 1, 3);
    const notArrived = await order("2026-11-07", otherSupplierId);
    await prisma.purchase.update({ where: { id: notArrived }, data: { status: "in_transit" } });
    await cutCard(notArrived, 1, 1);
    const otherSupplier = await order("2026-11-08", supplierId);
    await cutCard(otherSupplier, 1, 1);
    const nothingWaiting = await order("2026-11-09", otherSupplierId);

    const ids = (
      await listed({ toIdentify: true, statuses: ["arrived"], supplierIds: [otherSupplierId] })
    ).map((p) => p.id);
    assert.ok(ids.includes(mine));
    assert.ok(!ids.includes(notArrived));
    assert.ok(!ids.includes(otherSupplier));
    assert.ok(!ids.includes(nothingWaiting));
  });

  it("covers an opening balance as a purchase", async () => {
    const opening = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "Klaser",
      currency: "EUR",
      purchasedAt: "2026-11-10",
    });
    await createLot(userId, opening.id, null);
    await cutCard(opening.id, 1, 2);
    const row = (await listed({ toIdentify: true, type: "opening_balance" })).find(
      (p) => p.id === opening.id
    );
    assert.equal(row?.tilesToIdentify, 2);
  });
});
