import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { deleteIssue, previewIssueDeletion } from "../../src/lib/issues";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-issdel-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-issdel-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-issdel-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

async function createTestArea(collectionId: string, name: string) {
  return prisma.collectionArea.create({
    data: { collectionId, name },
  });
}

async function createTestIssue(collectionId: string, areaId: string, name: string) {
  return prisma.issue.create({
    data: { collectionId, collectionAreaId: areaId, name },
  });
}

describe("deleteIssue with stamp cascade", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dc-${ts}`)).id;
    areaId = (await createTestArea(collectionId, "Test Area")).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes stamps exclusive to the issue", async () => {
    const issue = await createTestIssue(collectionId, areaId, "Issue A");
    const stamp1 = await prisma.stamp.create({ data: { collectionId, name: "S1" } });
    const stamp2 = await prisma.stamp.create({ data: { collectionId, name: "S2" } });
    await prisma.issueMember.createMany({
      data: [
        { issueId: issue.id, stampId: stamp1.id },
        { issueId: issue.id, stampId: stamp2.id },
      ],
    });

    await deleteIssue(userId, collectionId, issue.id);

    assert.equal(await prisma.issue.findUnique({ where: { id: issue.id } }), null);
    assert.equal(await prisma.stamp.findUnique({ where: { id: stamp1.id } }), null);
    assert.equal(await prisma.stamp.findUnique({ where: { id: stamp2.id } }), null);
  });

  it("keeps stamps that belong to other issues", async () => {
    const issueA = await createTestIssue(collectionId, areaId, "Issue Keep A");
    const issueB = await createTestIssue(collectionId, areaId, "Issue Keep B");
    const sharedStamp = await prisma.stamp.create({ data: { collectionId, name: "Shared" } });
    const exclusiveStamp = await prisma.stamp.create({ data: { collectionId, name: "Exclusive" } });
    await prisma.issueMember.createMany({
      data: [
        { issueId: issueA.id, stampId: sharedStamp.id },
        { issueId: issueA.id, stampId: exclusiveStamp.id },
        { issueId: issueB.id, stampId: sharedStamp.id },
      ],
    });

    await deleteIssue(userId, collectionId, issueA.id);

    assert.equal(await prisma.issue.findUnique({ where: { id: issueA.id } }), null);
    assert.equal(await prisma.stamp.findUnique({ where: { id: exclusiveStamp.id } }), null);
    const kept = await prisma.stamp.findUnique({ where: { id: sharedStamp.id } });
    assert.ok(kept, "Shared stamp should still exist");
    const membership = await prisma.issueMember.findUnique({
      where: { issueId_stampId: { issueId: issueB.id, stampId: sharedStamp.id } },
    });
    assert.ok(membership, "Shared stamp should still be a member of issue B");
  });

  it("deletes stamps with parent-child relationships depth-first", async () => {
    const issue = await createTestIssue(collectionId, areaId, "Issue Tree");
    const parent = await prisma.stamp.create({ data: { collectionId, name: "Parent" } });
    const child = await prisma.stamp.create({ data: { collectionId, parentId: parent.id, name: "Child" } });
    await prisma.issueMember.createMany({
      data: [
        { issueId: issue.id, stampId: parent.id },
        { issueId: issue.id, stampId: child.id },
      ],
    });

    await deleteIssue(userId, collectionId, issue.id);

    assert.equal(await prisma.stamp.findUnique({ where: { id: parent.id } }), null);
    assert.equal(await prisma.stamp.findUnique({ where: { id: child.id } }), null);
  });

  it("deletes an issue with no stamps", async () => {
    const issue = await createTestIssue(collectionId, areaId, "Empty Issue");

    await deleteIssue(userId, collectionId, issue.id);

    assert.equal(await prisma.issue.findUnique({ where: { id: issue.id } }), null);
  });
});

describe("previewIssueDeletion", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`pv-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `pv-${ts}`)).id;
    areaId = (await createTestArea(collectionId, "Preview Area")).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns correct counts for mixed exclusive and shared stamps", async () => {
    const issueA = await createTestIssue(collectionId, areaId, "Preview A");
    const issueB = await createTestIssue(collectionId, areaId, "Preview B");
    const exclusive1 = await prisma.stamp.create({ data: { collectionId, name: "E1" } });
    const exclusive2 = await prisma.stamp.create({ data: { collectionId, name: "E2" } });
    const shared1 = await prisma.stamp.create({ data: { collectionId, name: "SH1" } });
    await prisma.issueMember.createMany({
      data: [
        { issueId: issueA.id, stampId: exclusive1.id },
        { issueId: issueA.id, stampId: exclusive2.id },
        { issueId: issueA.id, stampId: shared1.id },
        { issueId: issueB.id, stampId: shared1.id },
      ],
    });

    const preview = await previewIssueDeletion(userId, collectionId, issueA.id);
    assert.equal(preview.totalMembers, 3);
    assert.equal(preview.exclusiveCount, 2);
    assert.equal(preview.sharedCount, 1);
  });

  it("returns all zeros for an empty issue", async () => {
    const issue = await createTestIssue(collectionId, areaId, "Empty Preview");

    const preview = await previewIssueDeletion(userId, collectionId, issue.id);
    assert.equal(preview.totalMembers, 0);
    assert.equal(preview.exclusiveCount, 0);
    assert.equal(preview.sharedCount, 0);
  });
});
