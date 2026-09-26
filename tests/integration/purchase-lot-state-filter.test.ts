import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getPurchaseIntakePage, getPurchaseIntakeSummary } from "../../src/lib/items";

// A purchase order's copies narrowed to open or to closed lots (#1394), through the two order-level
// reads the flat and grouped views page and head their lists with. What is pinned: the paged read
// narrows in both of its branches — the SQL page and the whole-set fallback a catalog sort takes —
// which matters because the lot state rides inside the scope's own `lot` clause, where a second
// `lot` key would have replaced the order it belongs to; it combines with *to sort*; and the summary
// heads only what the list shows while its chip counts stay the whole order's.

const TS = Date.now();

describe("purchase order lot-state filter (#1394)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let purchaseId: string;
  let openIds: string[];
  let closedIds: string[];

  before(async () => {
    userId = `test-user-lotstate-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lotstate-${TS}`, name: "Lot state", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Priced" } })).id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
    // Priced, so the closed lot can be closed at all.
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: null,
        price: "2.00",
        currency: "EUR",
      },
    });

    purchaseId = (
      await createPurchase(userId, collectionId, {
        purchasedAt: "2026-09-01",
        currency: "EUR",
        status: "arrived",
      })
    ).id;

    async function lotOf(copies: number): Promise<{ lotId: string; itemIds: string[] }> {
      const lotId = await createLot(userId, purchaseId, 10, null);
      const itemIds: string[] = [];
      for (let i = 0; i < copies; i++) {
        const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
        itemIds.push(copy.itemId);
      }
      return { lotId, itemIds };
    }

    // Closed first, open second: the open lot's copies are the newer ones either way the list sorts.
    const closed = await lotOf(1);
    assert.equal((await closeLot(userId, closed.lotId)).ok, true);
    closedIds = closed.itemIds;
    openIds = (await lotOf(2)).itemIds;

    // One copy of each lot waiting on the sort pass, the rest filed. Set outright rather than left to
    // intake, whose starting state follows the order's delivery status.
    await prisma.item.updateMany({
      where: { id: { in: [...openIds, ...closedIds] } },
      data: { deliveryState: "delivered" },
    });
    await prisma.item.updateMany({
      where: { id: { in: [openIds[0], closedIds[0]] } },
      data: { deliveryState: "to_sort" },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id).sort();

  it("shows every copy of the order with no lot state chosen", async () => {
    const page = await getPurchaseIntakePage(userId, collectionId, purchaseId);
    assert.deepEqual(ids(page), [...openIds, ...closedIds].sort());
  });

  it("narrows the SQL page to one state's lots, and to this order's", async () => {
    const open = await getPurchaseIntakePage(userId, collectionId, purchaseId, { lotState: "open" });
    assert.deepEqual(ids(open), [...openIds].sort());
    const closed = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
      lotState: "closed",
    });
    assert.deepEqual(ids(closed), [...closedIds].sort());
  });

  it("narrows the whole-set fallback a catalog sort takes", async () => {
    const page = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
      lotState: "closed",
      sort: "catalog",
    });
    assert.deepEqual(ids(page), [...closedIds].sort());
  });

  it("combines with to sort: open and to sort is what is left to do", async () => {
    const page = await getPurchaseIntakePage(userId, collectionId, purchaseId, {
      lotState: "open",
      filter: "to-sort",
    });
    assert.deepEqual(ids(page), [openIds[0]]);
  });

  it("heads only what the list shows, and keeps the chip counts whole", async () => {
    const summary = await getPurchaseIntakeSummary(userId, collectionId, purchaseId, {
      lotState: "closed",
      groupBy: ["issue"],
    });
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.filteredCount, 1);
    // The chip is pressed from this count, so it is the order's whatever is filtered (#623).
    assert.equal(summary.toSortCount, 2);
    const headed = summary.groupTree.reduce((sum, node) => sum + node.count, 0);
    assert.equal(headed, 1);
    // A closed lot's copies take no tick, so its heading offers no box.
    assert.equal(
      summary.groupTree.reduce((sum, node) => sum + node.openCount, 0),
      0
    );
  });
});
