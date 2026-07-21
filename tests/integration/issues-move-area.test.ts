import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { moveIssueToArea, listIssueReferencedVendors } from "../../src/lib/issues";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-issmove-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-issmove-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-issmove-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

async function createTestArea(collectionId: string, name: string) {
  return prisma.collectionArea.create({ data: { collectionId, name } });
}

async function createTestIssue(collectionId: string, areaId: string, name: string) {
  return prisma.issue.create({
    data: { collectionId, collectionAreaId: areaId, name },
  });
}

describe("moveIssueToArea", () => {
  let userId: string;
  let collectionId: string;
  let areaA: string;
  let areaB: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`${ts}`)).id;
    collectionId = (await createTestCollection(userId, `${ts}`)).id;
    areaA = (await createTestArea(collectionId, "Area A")).id;
    areaB = (await createTestArea(collectionId, "Area B")).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("moves the issue and its exclusive member stamp's area link to the target", async () => {
    const issue = await createTestIssue(collectionId, areaA, "Exclusive");
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "S" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaA, isPrimary: true },
    });
    await prisma.issueMember.create({ data: { issueId: issue.id, stampId: stamp.id } });

    await moveIssueToArea(userId, collectionId, issue.id, areaB);

    const moved = await prisma.issue.findUnique({ where: { id: issue.id } });
    assert.equal(moved?.collectionAreaId, areaB);

    const links = await prisma.stampCollectionArea.findMany({ where: { stampId: stamp.id } });
    assert.equal(links.length, 1);
    assert.equal(links[0].collectionAreaId, areaB);
    assert.equal(links[0].isPrimary, true, "isPrimary should carry to the new area");
  });

  it("keeps the old-area link for a stamp shared with another issue staying in the old area", async () => {
    const issueMoving = await createTestIssue(collectionId, areaA, "Moving");
    const issueStaying = await createTestIssue(collectionId, areaA, "Staying");
    const shared = await prisma.stamp.create({ data: { collectionId, name: "Shared" } });
    await prisma.stampCollectionArea.create({
      data: { stampId: shared.id, collectionAreaId: areaA, isPrimary: true },
    });
    await prisma.issueMember.createMany({
      data: [
        { issueId: issueMoving.id, stampId: shared.id },
        { issueId: issueStaying.id, stampId: shared.id },
      ],
    });

    await moveIssueToArea(userId, collectionId, issueMoving.id, areaB);

    const links = await prisma.stampCollectionArea.findMany({
      where: { stampId: shared.id },
      orderBy: { collectionAreaId: "asc" },
    });
    const areaIds = links.map((l) => l.collectionAreaId).sort();
    assert.deepEqual(areaIds, [areaA, areaB].sort(), "shared stamp keeps A and gains B");
  });

  it("is a no-op when the issue is already in the target area", async () => {
    const issue = await createTestIssue(collectionId, areaA, "Same");
    await moveIssueToArea(userId, collectionId, issue.id, areaA);
    const same = await prisma.issue.findUnique({ where: { id: issue.id } });
    assert.equal(same?.collectionAreaId, areaA);
  });

  it("rejects a target area from a different collection", async () => {
    const otherCollection = await createTestCollection(userId, `other-${Date.now()}`);
    const foreignArea = await createTestArea(otherCollection.id, "Foreign");
    const issue = await createTestIssue(collectionId, areaA, "Guarded");
    await assert.rejects(
      () => moveIssueToArea(userId, collectionId, issue.id, foreignArea.id),
      /Target area not found/
    );
  });
});

describe("listIssueReferencedVendors", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`vend-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `vend-${ts}`)).id;
    areaId = (await createTestArea(collectionId, "Vendor Area")).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns the union of issue and member-stamp catalog vendors", async () => {
    const vendorX = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const vendorY = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    const issue = await createTestIssue(collectionId, areaId, "Priced");
    await prisma.issueCatalogNumber.create({
      data: { issueId: issue.id, catalogVendorId: vendorX.id, firstNumber: "1" },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "S" } });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendorY.id, number: "1a" },
    });
    await prisma.issueMember.create({ data: { issueId: issue.id, stampId: stamp.id } });

    const vendors = await listIssueReferencedVendors(userId, collectionId, issue.id);
    const ids = vendors.map((v) => v.catalogVendorId).sort();
    assert.deepEqual(ids, [vendorX.id, vendorY.id].sort());
    assert.ok(vendors.every((v) => v.name && v.abbreviation));
  });

  it("returns an empty list when the issue references no vendors", async () => {
    const issue = await createTestIssue(collectionId, areaId, "Bare");
    const vendors = await listIssueReferencedVendors(userId, collectionId, issue.id);
    assert.deepEqual(vendors, []);
  });
});
