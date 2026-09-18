import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getIssueCatalogNumberGrid,
  setIssueStampCatalogNumber,
} from "../../src/lib/issue-catalog-numbers";

// **Every stamp of an issue has its catalogue numbers edited in one grid** (#1346).
//
// The grid's rows are the issue's tree in its own order, its columns the catalogues the stamp form
// offers for the area, and a cell is one `StampCatalogNumber` row: typed sets it, emptied removes
// it. Each write recomputes the issue's declared range for that catalogue from its checklist stamps
// — widening, narrowing, creating and removing, unlike #333's widen-only proposal. A repeat inside
// the issue is accepted (the dialog flags it); a collection that blocks duplicates (#85) is refused.

describe("issue catalogue-number grid (#1346)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let issueId: string;
  let michelId: string;
  let fischerId: string;
  let baseA: string;
  let baseB: string;
  let variantA1: string;
  let extraBlock: string;
  let outsider: string;

  async function range(vendorId: string) {
    return prisma.issueCatalogNumber.findUnique({
      where: { issueId_catalogVendorId: { issueId, catalogVendorId: vendorId } },
      select: { firstNumber: true, lastNumber: true },
    });
  }
  async function number(stampId: string, vendorId: string) {
    const row = await prisma.stampCatalogNumber.findUnique({
      where: { stampId_catalogVendorId: { stampId, catalogVendorId: vendorId } },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-cngrid-${ts}`;
    otherUserId = `test-user-cngrid-other-${ts}`;
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
        data: { slug: `col-cngrid-${ts}`, name: `Collection cngrid-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    fischerId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } })).id;
    // A vendor of the collection the area does not number in: no column for it.
    await prisma.catalogVendor.create({ data: { collectionId, name: "Scott", abbreviation: "Sc" } });

    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogVendorId: michelId },
      })
    ).id;
    await prisma.collectionAreaVendor.createMany({
      data: [
        { collectionAreaId: areaId, catalogVendorId: michelId },
        { collectionAreaId: areaId, catalogVendorId: fischerId },
      ],
    });

    issueId = (
      await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: areaId, name: "Castles" } })
    ).id;
    await prisma.issueCatalogNumber.create({
      data: { issueId, catalogVendorId: michelId, firstNumber: "100", lastNumber: "101" },
    });

    const stamp = async (name: string, parentId: string | null = null) =>
      (await prisma.stamp.create({ data: { collectionId, name, parentId } })).id;
    baseB = await stamp("B");
    baseA = await stamp("A");
    variantA1 = await stamp("A1", baseA);
    extraBlock = await stamp("Block");
    outsider = await stamp("Elsewhere");
    // The collector's order puts A before B, whatever order they were created in.
    await prisma.issueMember.createMany({
      data: [
        { issueId, stampId: baseA, sortOrder: 0 },
        { issueId, stampId: baseB, sortOrder: 1 },
        { issueId, stampId: variantA1, sortOrder: 2 },
        { issueId, stampId: extraBlock, sortOrder: 3 },
      ],
    });
    await prisma.stampCatalogNumber.createMany({
      data: [
        { stampId: baseA, catalogVendorId: michelId, number: "100" },
        { stampId: baseB, catalogVendorId: michelId, number: "101" },
        { stampId: variantA1, catalogVendorId: michelId, number: "100a" },
      ],
    });
    // Only the two bases are on the checklist — the variant and the block are optional extras.
    const checklist = await prisma.checklist.create({ data: { collectionId, issueId, name: "Castles" } });
    await prisma.checklistStamp.createMany({
      data: [
        { checklistId: checklist.id, stampId: baseA, sortOrder: 0 },
        { checklistId: checklist.id, stampId: baseB, sortOrder: 1 },
      ],
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("draws every member in the tree's own order, a column per catalogue of the area", async () => {
    const grid = await getIssueCatalogNumberGrid(userId, issueId);
    assert.deepEqual(
      grid.rows.map((r) => [r.stampId, r.depth]),
      [
        [baseA, 0],
        [variantA1, 1],
        [baseB, 0],
        [extraBlock, 0],
      ]
    );
    assert.deepEqual(
      grid.columns.map((c) => c.catalogVendorId),
      [michelId, fischerId]
    );
    assert.equal(grid.rows.find((r) => r.stampId === extraBlock)?.onChecklist, false);
    assert.equal(grid.numbers.length, 3);
  });

  it("refuses another owner", async () => {
    await assert.rejects(() => getIssueCatalogNumberGrid(otherUserId, issueId));
    await assert.rejects(() =>
      setIssueStampCatalogNumber(otherUserId, { issueId, stampId: baseA, catalogVendorId: fischerId, number: "1" })
    );
  });

  it("refuses a stamp that is not a member of the issue", async () => {
    await assert.rejects(
      () => setIssueStampCatalogNumber(userId, { issueId, stampId: outsider, catalogVendorId: michelId, number: "5" }),
      /no longer part of the issue/
    );
  });

  it("adds a second catalogue's numbers and creates its declared range", async () => {
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseA, catalogVendorId: fischerId, number: " 2895 " });
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseB, catalogVendorId: fischerId, number: "2896" });
    assert.equal(await number(baseA, fischerId), "2895");
    assert.deepEqual(await range(fischerId), { firstNumber: "2895", lastNumber: "2896" });
  });

  it("widens and narrows the range as numbers change, and ignores extras", async () => {
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseB, catalogVendorId: michelId, number: "104" });
    assert.deepEqual(await range(michelId), { firstNumber: "100", lastNumber: "104" });
    // A block on no checklist never defines the range.
    await setIssueStampCatalogNumber(userId, { issueId, stampId: extraBlock, catalogVendorId: michelId, number: "150" });
    assert.deepEqual(await range(michelId), { firstNumber: "100", lastNumber: "104" });
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseB, catalogVendorId: michelId, number: "101" });
    assert.deepEqual(await range(michelId), { firstNumber: "100", lastNumber: "101" });
  });

  it("accepts a number repeated within the issue in warn mode", async () => {
    await setIssueStampCatalogNumber(userId, { issueId, stampId: extraBlock, catalogVendorId: michelId, number: "101" });
    assert.equal(await number(extraBlock, michelId), "101");
  });

  it("refuses a duplicate identity when the collection blocks duplicates", async () => {
    await prisma.collection.update({ where: { id: collectionId }, data: { duplicateCatalogMode: "block" } });
    try {
      await assert.rejects(() =>
        setIssueStampCatalogNumber(userId, { issueId, stampId: variantA1, catalogVendorId: michelId, number: "100" })
      );
      assert.equal(await number(variantA1, michelId), "100a");
    } finally {
      await prisma.collection.update({ where: { id: collectionId }, data: { duplicateCatalogMode: "warn" } });
    }
  });

  it("removes the number when the cell is emptied, and the range with the last one", async () => {
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseA, catalogVendorId: fischerId, number: "" });
    assert.equal(await number(baseA, fischerId), null);
    assert.deepEqual(await range(fischerId), { firstNumber: "2896", lastNumber: null });
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseB, catalogVendorId: fischerId, number: null });
    assert.equal(await range(fischerId), null);
  });

  it("keeps the stamp's sort key in step with its numbers", async () => {
    await setIssueStampCatalogNumber(userId, { issueId, stampId: baseA, catalogVendorId: michelId, number: "99" });
    const stamp = await prisma.stamp.findUniqueOrThrow({
      where: { id: baseA },
      select: { primaryCatalogSortKey: true },
    });
    assert.equal(stamp.primaryCatalogSortKey, "0000000099");
  });
});
