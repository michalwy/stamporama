import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getIssueCatalogNumberGrid } from "../../src/lib/issue-catalog-numbers";
import { getVariantPriceGrid } from "../../src/lib/variant-prices";
import { listItemsPaginated } from "../../src/lib/items";
import { listOffersForTarget } from "../../src/lib/offers";
import { addStampRangeToIssue } from "../../src/lib/issues";

// **A checklist's branch on the Issues list acts on that checklist's stamps** (#1520).
//
// The branch's `⋮` reaches the issue row's actions narrowed to one checklist: the copies and offers
// of its stamps exactly, the price and catalogue-number grids over its stamps and the ancestors they
// hang under (the branch's own rows), and a stamp range added from it joins that checklist rather
// than the issue's first. A checklist of another issue reaches nothing.

describe("a checklist branch's scoped actions (#1520)", () => {
  const ts = Date.now();
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let issueId: string;
  let otherIssueId: string;
  let redCross: string;
  let vertical: string;
  let foreignChecklist: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let s3v: string;
  let item1: string;
  let item3v: string;
  let itemOff: string;

  before(async () => {
    userId = `test-user-clbranch-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-clbranch-${ts}`, name: "Branches", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogVendorId: vendorId },
      })
    ).id;
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: areaId, catalogVendorId: vendorId },
    });
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 1, collectionAreaId: areaId, name: "Red Cross" },
      })
    ).id;
    otherIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 2, collectionAreaId: areaId, name: "Elsewhere" },
      })
    ).id;

    const stamp = async (name: string, parentId: string | null = null) =>
      (await prisma.stamp.create({ data: { collectionId, name, parentId } })).id;
    s1 = await stamp("1");
    s2 = await stamp("2");
    s3 = await stamp("3");
    s3v = await stamp("3v", s3);
    await prisma.issueMember.createMany({
      data: [s1, s2, s3, s3v].map((stampId, sortOrder) => ({ issueId, stampId, sortOrder })),
    });

    // Red Cross lists 1 and 2; the vertical se-tenants list only `3v`, which hangs under `3`.
    redCross = (
      await prisma.checklist.create({ data: { collectionId, issueId, name: "Red Cross", sortOrder: 0 } })
    ).id;
    vertical = (
      await prisma.checklist.create({
        data: { collectionId, issueId, name: "Vertical se-tenants", sortOrder: 1 },
      })
    ).id;
    foreignChecklist = (
      await prisma.checklist.create({
        data: { collectionId, issueId: otherIssueId, name: "Elsewhere", sortOrder: 0 },
      })
    ).id;
    await prisma.checklistStamp.createMany({
      data: [
        { checklistId: redCross, stampId: s1, sortOrder: 0 },
        { checklistId: redCross, stampId: s2, sortOrder: 1 },
        { checklistId: vertical, stampId: s3v, sortOrder: 0 },
      ],
    });

    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    const copy = async (stampId: string, itemNo: number) =>
      (
        await prisma.item.create({
          data: { collectionId, itemNo, stampId, conditionId, deliveryState: "delivered", inCollection: true },
        })
      ).id;
    item1 = await copy(s1, 1);
    item3v = await copy(s3v, 2);
    // A copy of `3`, the base the vertical set's variant hangs under — not on that checklist.
    itemOff = await copy(s3, 3);

    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    for (const [offerNo, itemId] of [
      [9101, item1],
      [9102, itemOff],
    ] as const) {
      const offer = await prisma.offer.create({
        data: { collectionId, offerNo, platformId, currency: "EUR", price: "5.00", state: "active" },
      });
      const set = await prisma.offerSet.create({ data: { offerId: offer.id } });
      await prisma.offerSetItem.create({ data: { offerSetId: set.id, itemId } });
    }
  });

  after(async () => {
    await prisma.offerSetItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists the copies of the checklist's stamps exactly", async () => {
    const red = await listItemsPaginated(userId, collectionId, { checklistId: redCross });
    assert.deepEqual(red.items.map((i) => i.id), [item1]);
    const vert = await listItemsPaginated(userId, collectionId, { checklistId: vertical });
    // The base `3` is the branch's context, not its member: its copy is not the set's.
    assert.deepEqual(vert.items.map((i) => i.id), [item3v]);
  });

  it("finds the offers holding a copy of the checklist's stamps", async () => {
    const red = await listOffersForTarget(userId, collectionId, { kind: "checklist", checklistId: redCross });
    assert.deepEqual(red.map((o) => o.offerNo), [9101]);
    const vert = await listOffersForTarget(userId, collectionId, { kind: "checklist", checklistId: vertical });
    assert.deepEqual(vert, []);
  });

  it("draws the catalogue-number grid over the branch's rows, named after the checklist", async () => {
    const grid = await getIssueCatalogNumberGrid(userId, issueId, vertical);
    assert.deepEqual(
      grid.rows.map((r) => [r.stampId, r.depth]),
      [
        [s3, 0],
        [s3v, 1],
      ]
    );
    assert.equal(grid.scopeLabel, "Red Cross — Vertical se-tenants");
    const whole = await getIssueCatalogNumberGrid(userId, issueId);
    assert.equal(whole.rows.length, 4);
  });

  it("draws the variant price grid over the branch's rows", async () => {
    const grid = await getVariantPriceGrid(userId, { kind: "issue", issueId, checklistId: redCross });
    assert.deepEqual(grid.rows.map((r) => r.stampId).sort(), [s1, s2].sort());
    assert.equal(grid.scopeLabel, "Red Cross — Red Cross");
  });

  it("refuses a checklist of another issue in either grid", async () => {
    await assert.rejects(() => getIssueCatalogNumberGrid(userId, issueId, foreignChecklist));
    await assert.rejects(() =>
      getVariantPriceGrid(userId, { kind: "issue", issueId, checklistId: foreignChecklist })
    );
  });

  it("puts a stamp range added from a branch on that checklist, and on no other", async () => {
    const created = await addStampRangeToIssue(
      userId,
      collectionId,
      issueId,
      { count: 2, vendors: [{ catalogVendorId: vendorId, numbers: ["10", "11"] }] },
      { checklistId: vertical }
    );
    const onVertical = await prisma.checklistStamp.findMany({
      where: { checklistId: vertical },
      orderBy: { sortOrder: "asc" },
      select: { stampId: true },
    });
    // Appended after what the set already lists, in the order typed.
    assert.deepEqual(onVertical.map((r) => r.stampId), [s3v, ...created]);
    const elsewhere = await prisma.checklistStamp.count({
      where: { stampId: { in: created }, checklistId: { not: vertical } },
    });
    assert.equal(elsewhere, 0);
  });

  it("still puts a range on the issue's first checklist when no checklist is named", async () => {
    const created = await addStampRangeToIssue(userId, collectionId, issueId, {
      count: 1,
      vendors: [{ catalogVendorId: vendorId, numbers: ["20"] }],
    });
    const rows = await prisma.checklistStamp.findMany({
      where: { stampId: { in: created } },
      select: { checklistId: true },
    });
    assert.deepEqual(rows.map((r) => r.checklistId), [redCross]);
  });

  it("refuses a range onto a checklist of another issue, and writes nothing", async () => {
    const before = await prisma.issueMember.count({ where: { issueId } });
    await assert.rejects(() =>
      addStampRangeToIssue(
        userId,
        collectionId,
        issueId,
        { count: 1, vendors: [{ catalogVendorId: vendorId, numbers: ["30"] }] },
        { checklistId: foreignChecklist }
      )
    );
    assert.equal(await prisma.issueMember.count({ where: { issueId } }), before);
  });
});
