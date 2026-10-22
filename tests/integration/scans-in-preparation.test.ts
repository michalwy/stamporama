import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { scansInPreparation } from "../../src/lib/scan-notices";

/**
 * What the panel of card scans being added reads from the server (#2099): every scan of the
 * collection waiting its turn to be prepared or being prepared, across its orders, in the queue's
 * order — and nothing that is still uploading (the sending tab draws those), ready, failed or
 * interrupted (the order's own section does).
 *
 * The places in the queue are the instance's, and other files of the suite share the database, so
 * only their order is asserted, not their numbers.
 */
describe("scans in preparation (#2099)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let orderId: string;
  let balanceId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-prep-${ts}`;
    otherUserId = `test-user-prep-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-prep-${ts}`, name: `Prep ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-prep-other-${ts}`,
          name: `Prep other ${ts}`,
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    orderId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: 12, purchasedAt: new Date("2026-10-01"), currency: "EUR" },
      })
    ).id;
    balanceId = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 3,
          kind: "opening_balance",
          title: "Shelf",
          status: "arrived",
          purchasedAt: new Date("2026-10-01"),
          currency: "EUR",
        },
      })
    ).id;
    const otherOrderId = (
      await prisma.purchase.create({
        data: {
          collectionId: otherCollectionId,
          purchaseNo: 1,
          purchasedAt: new Date("2026-10-01"),
          currency: "EUR",
        },
      })
    ).id;

    const base = { mime: "image/png", totalBytes: 1, chunkBytes: 1 };
    const at = (s: number) => new Date(Date.UTC(2000, 0, 1, 10, 0, s));
    await prisma.scanUpload.createMany({
      data: [
        { ...base, id: `prep-${ts}-a`, collectionId, purchaseId: orderId, side: "front", label: "Klaser 1", status: "preparing", queuedAt: at(1) },
        { ...base, id: `prep-${ts}-b`, collectionId, purchaseId: balanceId, side: "back", batchNo: 4, status: "queued", queuedAt: at(2) },
        { ...base, id: `prep-${ts}-c`, collectionId, purchaseId: orderId, side: "front", status: "queued", queuedAt: at(3) },
        { ...base, id: `prep-${ts}-d`, collectionId, purchaseId: orderId, side: "front", status: "uploading" },
        { ...base, id: `prep-${ts}-e`, collectionId, purchaseId: orderId, side: "front", status: "failed", queuedAt: at(0) },
        { ...base, id: `prep-${ts}-f`, collectionId, purchaseId: orderId, side: "front", status: "interrupted" },
        { ...base, id: `prep-${ts}-g`, collectionId, purchaseId: orderId, side: "front", status: "done", queuedAt: at(0) },
        { ...base, id: `prep-${ts}-h`, collectionId: otherCollectionId, purchaseId: otherOrderId, side: "front", status: "queued", queuedAt: at(0) },
      ],
    });
  });

  after(async () => {
    await prisma.scanUpload.deleteMany({ where: { collectionId: { in: [collectionId, otherCollectionId] } } });
    await prisma.purchase.deleteMany({ where: { collectionId: { in: [collectionId, otherCollectionId] } } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("lists the collection's waiting and preparing scans, in the queue's order, named for the panel", async () => {
    const scans = await scansInPreparation(userId, collectionId);
    assert.deepEqual(
      scans.map((s) => [s.status, s.title, s.documentName, s.purchaseId]),
      [
        ["preparing", "New card · Klaser 1", "Order #12", orderId],
        ["queued", "Back of batch 4", "Opening balance #3", balanceId],
        ["queued", "New card", "Order #12", orderId],
      ]
    );
    assert.equal(scans[0].ahead, null);
    // The other collection's scan joined the instance's queue first, so it is ahead of both.
    assert.ok(scans[1].ahead != null && scans[1].ahead >= 2);
    assert.equal(scans[2].ahead, (scans[1].ahead as number) + 1);
  });

  it("is refused to anyone but the collection's owner", async () => {
    await assert.rejects(() => scansInPreparation(otherUserId, collectionId));
  });
});
