import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, getIntakeIssueIds } from "../../src/lib/items";
import { getLotSetCompleteness } from "../../src/lib/lot-set-completeness";
import { createPurchase } from "../../src/lib/purchases";
import { createLot } from "../../src/lib/lots";

// Per-checklist for-sale completeness on a lot's issue groups (#563). What the pure rule cannot
// answer is what is pinned here — every one of these is a *counting set* decision, and each of them
// silently changes the sentence a collector acts on:
//
//   - the figure ranges over the whole collection, not the lot, while `fromHere` is the lot's share;
//   - **in hand** means `delivered` or `to_sort` — a copy still in the post cannot be listed;
//   - **for sale** only, and sold or disposed-of copies are not stock;
//   - **per checklist**, never over an issue's union (ADR-0031);
//   - the missing stamps are named against the *collection*, since that is an instruction to go and
//     look in the box.

const ts = Date.now();

describe("lot for-sale set completeness (#563)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let issueId: string;
  let vendorId: string;
  /** Mi 1-4 on the basic checklist; Mi 3-5 on the specialized one, so 3 and 4 are shared. */
  let s1: string, s2: string, s3: string, s4: string, s5: string;
  let basicId: string, specializedId: string;
  let purchaseId: string;
  let lotId: string;

  async function complete() {
    return (await getLotSetCompleteness(userId, collectionId, [issueId], { lotId }))[issueId];
  }

  before(async () => {
    userId = `test-user-setcompl-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User setcompl-${ts}`,
        email: `test-setcompl-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-setcompl-${ts}`, name: "Set", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = vendor.id;
    const catalog = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9101, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;

    const ids: string[] = [];
    for (const n of ["1", "2", "3", "4", "5"]) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Chopin ${n}`,
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number: n }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      ids.push(stamp.id);
    }
    [s1, s2, s3, s4, s5] = ids;
    await prisma.issueMember.createMany({
      data: ids.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });

    basicId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Basic",
          sortOrder: 0,
          stamps: { create: [{ stampId: s1 }, { stampId: s2 }, { stampId: s3 }, { stampId: s4 }] },
        },
      })
    ).id;
    specializedId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Specialized",
          sortOrder: 1,
          stamps: { create: [{ stampId: s3 }, { stampId: s4 }, { stampId: s5 }] },
        },
      })
    ).id;

    purchaseId = (
      await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-01-01" })
    ).id;
    lotId = await createLot(userId, purchaseId, 10);

    // In the lot and listable: 1 and 2 sorted, 3 still on the desk — all three count.
    await createItem(userId, collectionId, {
      stampId: s1,
      conditionId,
      lotId,
      forSale: true,
      deliveryState: "delivered",
    });
    await createItem(userId, collectionId, {
      stampId: s2,
      conditionId,
      lotId,
      forSale: true,
      deliveryState: "to_sort",
    });
    await createItem(userId, collectionId, {
      stampId: s3,
      conditionId,
      lotId,
      forSale: true,
      deliveryState: "to_sort",
    });
    // In the lot but still in the post: bought, and not something that can go out.
    await createItem(userId, collectionId, {
      stampId: s5,
      conditionId,
      lotId,
      forSale: true,
      deliveryState: "in_transit",
    });
    // In the lot, in hand, but a keeper rather than stock.
    await createItem(userId, collectionId, {
      stampId: s4,
      conditionId,
      lotId,
      inCollection: true,
      deliveryState: "delivered",
    });
    // Not in the lot at all — the box, six months ago. This is what makes the leading figure
    // different from the lot's own, and it is why the missing stamps are named against it.
    await createItem(userId, collectionId, {
      stampId: s4,
      conditionId,
      forSale: true,
      deliveryState: "delivered",
    });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchaseLot.deleteMany({ where: { purchase: { collectionId } } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("leads with the whole collection's for-sale stock and states the lot's share beside it", async () => {
    const [basic] = await complete();
    assert.equal(basic.checklistId, basicId);
    // 1, 2 and 3 came out of this parcel; 4 was already in the box, and it is the difference
    // between "one more and it is complete" and "complete, go and get it".
    assert.equal(basic.requiredCount, 4);
    assert.equal(basic.owned, 4);
    assert.equal(basic.fromHere, 3);
    assert.equal(basic.missingCount, 0);
    assert.deepEqual(basic.missingLabels, []);
  });

  it("counts per checklist, never over the issue's union", async () => {
    const [, specialized] = await complete();
    assert.equal(specialized.checklistId, specializedId);
    // Mi 3 and 4 are on both lists, and are counted for each — a union would report one figure
    // answering neither set (ADR-0031).
    assert.equal(specialized.requiredCount, 3);
    assert.equal(specialized.owned, 2);
    assert.equal(specialized.fromHere, 1);
  });

  it("names the missing stamps, collapsed the way a lot label is", async () => {
    const [, specialized] = await complete();
    // Mi 5 is in the lot and for sale, but still in transit: bought, and not listable.
    assert.equal(specialized.missingCount, 1);
    assert.deepEqual(specialized.missingLabels, ["Mi 5"]);
  });

  it("carries the gap as collapsed runs, so the chip can print three and the popover all", async () => {
    // Mi 1, 2 and 4 gone from stock: two runs, not three numbers. The chip truncates *these*
    // entries (#563), which is why the collapsing happens before the payload is built and not
    // after — `Mi 1-2` is one thing to print, and slicing raw stamps would have split it.
    await prisma.item.updateMany({
      where: { collectionId, stampId: { in: [s1, s2, s4] } },
      data: { forSale: false },
    });
    const [basic] = await complete();
    assert.equal(basic.missingCount, 3);
    assert.deepEqual(basic.missingLabels, ["Mi 1-2", "Mi 4"]);
    await prisma.item.updateMany({
      where: { collectionId, stampId: { in: [s1, s2] } },
      data: { forSale: true },
    });
    // Mi 4's two copies are a keeper and stock; only the one outside the lot was ever for sale.
    await prisma.item.updateMany({
      where: { collectionId, stampId: s4, lotId: null },
      data: { forSale: true },
    });
  });

  it("does not count a copy still in the post", async () => {
    await prisma.item.updateMany({
      where: { collectionId, stampId: s5 },
      data: { deliveryState: "delivered" },
    });
    const [, specialized] = await complete();
    assert.equal(specialized.owned, 3);
    assert.deepEqual(specialized.missingLabels, []);
    await prisma.item.updateMany({
      where: { collectionId, stampId: s5 },
      data: { deliveryState: "in_transit" },
    });
  });

  it("does not count a copy that is not for sale", async () => {
    // Mi 4 is on the checklist twice over: a keeper in the lot and stock in the box. Drop the
    // stock and only the keeper is left, which is not something to list.
    await prisma.item.deleteMany({ where: { collectionId, stampId: s4, lotId: null } });
    const [basic] = await complete();
    assert.equal(basic.owned, 3);
    assert.equal(basic.fromHere, 3);
    assert.deepEqual(basic.missingLabels, ["Mi 4"]);
    await createItem(userId, collectionId, {
      stampId: s4,
      conditionId,
      forSale: true,
      deliveryState: "delivered",
    });
  });

  it("does not count a copy that is gone", async () => {
    await prisma.item.updateMany({
      where: { collectionId, stampId: s1 },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
    const [basic] = await complete();
    assert.equal(basic.owned, 3);
    assert.deepEqual(basic.missingLabels, ["Mi 1"]);
    await prisma.item.updateMany({
      where: { collectionId, stampId: s1 },
      data: { disposedAt: null, disposalReason: null },
    });
  });

  it("scopes `from here` to the order in the by-issue view across its lots", async () => {
    // A second lot of the same parcel: its copies are not *this* lot's, but they did arrive in
    // this order, which is what the order-level view is grouped by.
    const otherLot = await createLot(userId, purchaseId, 5);
    await createItem(userId, collectionId, {
      stampId: s5,
      conditionId,
      lotId: otherLot,
      forSale: true,
      deliveryState: "delivered",
    });
    const lotScoped = (
      await getLotSetCompleteness(userId, collectionId, [issueId], { lotId })
    )[issueId][1];
    const orderScoped = (
      await getLotSetCompleteness(userId, collectionId, [issueId], { purchaseId })
    )[issueId][1];
    assert.equal(lotScoped.owned, orderScoped.owned, "the leading figure is the same collection");
    assert.equal(lotScoped.fromHere, 1);
    assert.equal(orderScoped.fromHere, 2);
    await prisma.item.deleteMany({ where: { lotId: otherLot } });
    await prisma.purchaseLot.delete({ where: { id: otherLot } });
  });

  it("answers an issue with no checklists as an empty list, not an absence", async () => {
    const bare = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9102, collectionAreaId: areaId, name: "Bare" },
      })
    ).id;
    const byIssue = await getLotSetCompleteness(userId, collectionId, [issueId, bare], { lotId });
    assert.deepEqual(byIssue[bare], []);
    await prisma.issue.delete({ where: { id: bare } });
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(() =>
      getLotSetCompleteness("someone-else", collectionId, [issueId], { lotId })
    );
  });

  it("reads a lot's issue groups the way the intake view groups them", async () => {
    // The read and the headers must cover exactly the same issues, or a group appears with no
    // figure behind it (or the other way round).
    assert.deepEqual(await getIntakeIssueIds(userId, collectionId, { lotId }), [issueId]);
  });
});
