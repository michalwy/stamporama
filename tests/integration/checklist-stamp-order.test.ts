import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getChecklist,
  reorderChecklistStamps,
  setChecklistStamps,
  setStampChecklistsForIssue,
} from "../../src/lib/checklists";

// The order a checklist's stamps read in (#764).
//
// What is pinned here is everything the column itself cannot say: that a reorder densely renumbers
// the whole flat list, that ids the client never saw are neither dropped nor renumbered past what
// it did send, and — the part that is easy to lose — that **membership and order are separate
// writes**. Ticking a box in the picker replaces the set; it must leave the places of the stamps
// that survive alone, or an order the collector dragged into shape is undone by an unrelated edit.

const ts = Date.now();

describe("checklist stamp order (#764)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let checklistId: string;
  /** Four stamps of one issue, created in catalog order. */
  let a: string, b: string, c: string, d: string;

  /** The checklist's membership, in the order the set reads. */
  async function order(): Promise<string[]> {
    const checklist = await getChecklist(userId, collectionId, checklistId);
    assert.ok(checklist, "checklist missing");
    return checklist.stampIds;
  }

  /** The stored numbers, to catch a write that leaves gaps or collisions behind an order that
   *  happens to read right. */
  async function sortOrders(): Promise<number[]> {
    const rows = await prisma.checklistStamp.findMany({
      where: { checklistId },
      orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
      select: { sortOrder: true },
    });
    return rows.map((r) => r.sortOrder);
  }

  before(async () => {
    userId = `test-user-clorder-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User clorder-${ts}`,
        email: `test-clorder-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-clorder-${ts}`, name: "Order", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polska", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9764, collectionAreaId: areaId, name: "Grosik", year: 1928 },
      })
    ).id;

    const stamp = async (number: string): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    a = await stamp("240");
    b = await stamp("241");
    c = await stamp("242");
    d = await stamp("243");
    await prisma.issueMember.createMany({
      data: [a, b, c, d].map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });

    checklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Complete set",
          sortOrder: 0,
          stamps: {
            create: [a, b, c].map((stampId, i) => ({ stampId, sortOrder: i })),
          },
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("reads the membership in the stored order", async () => {
    assert.deepEqual(await order(), [a, b, c]);
  });

  it("renumbers the whole list densely on a reorder", async () => {
    await reorderChecklistStamps(userId, checklistId, [c, a, b]);
    assert.deepEqual(await order(), [c, a, b]);
    assert.deepEqual(await sortOrders(), [0, 1, 2]);
  });

  it("keeps a member the client left out, after the ones it named", async () => {
    // A stale list must be able to move what it names without dropping what it never saw.
    await reorderChecklistStamps(userId, checklistId, [b]);
    assert.deepEqual(await order(), [b, c, a]);
    assert.deepEqual(await sortOrders(), [0, 1, 2]);
  });

  it("ignores an id that is not on the checklist", async () => {
    await reorderChecklistStamps(userId, checklistId, [d, a, c, b]);
    // `d` is not a member, so the order it asked for is read off the three that are.
    assert.deepEqual(await order(), [a, c, b]);
  });

  it("leaves the surviving stamps' places alone when the membership is replaced", async () => {
    // The picker hands over the ticked boxes of the whole tree, in tree order — which is not this
    // checklist's order, and must not become it.
    await setChecklistStamps(userId, checklistId, [a, b, c, d]);
    assert.deepEqual(await order(), [a, c, b, d]);
    assert.deepEqual(await sortOrders(), [0, 1, 2, 3]);
  });

  it("closes the gap a removed stamp leaves", async () => {
    await setChecklistStamps(userId, checklistId, [a, b, d]);
    assert.deepEqual(await order(), [a, b, d]);
    assert.deepEqual(await sortOrders(), [0, 1, 2]);
  });

  it("appends a stamp that joins through the stamp form, and keeps one already on", async () => {
    // `c` joins: it lands last, whatever place it held before it was taken off.
    await setStampChecklistsForIssue(userId, collectionId, issueId, c, [checklistId]);
    assert.deepEqual(await order(), [a, b, d, c]);
    // `a` is re-saved on the same checklist: editing a stamp says nothing about the set's order.
    await setStampChecklistsForIssue(userId, collectionId, issueId, a, [checklistId]);
    assert.deepEqual(await order(), [a, b, d, c]);
  });
});
