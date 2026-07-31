import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemIssueGroups, listItemsPaginated } from "../../src/lib/items";
import { NO_ISSUE } from "../../src/lib/issue-groups";

// Grouping the Copies list by issue (#424). What is worth pinning down here is what the pure half
// cannot answer: that the reading order is the Issues list's own across a real read, that the
// issue-less bucket is a real group, that a stamp in two issues is still counted **once** (under its
// first membership, the answer `ItemListItem.issueId` already gives), that the panel's filters still
// narrow the counts, and that a group's own filters address exactly the copies it counted.

const ts = Date.now();

describe("issue groups", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let chopinIssueId: string;
  let sportIssueId: string;
  let undatedIssueId: string;
  let chopinStampId: string;
  let sharedStampId: string;
  let looseStampId: string;

  before(async () => {
    userId = `test-user-issuegroups-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User issuegroups-${ts}`,
        email: `test-issuegroups-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-issuegroups-${ts}`, name: "Iss", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    // Two dated issues and one carrying no year, so the year-less tail is exercised too. Chopin is
    // created first, which is what makes it the *first* membership of the stamp shared with Sport.
    chopinIssueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9001, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;
    sportIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9002, collectionAreaId: areaId, name: "Sport", year: 1952 },
      })
    ).id;
    undatedIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9003, collectionAreaId: areaId, name: "Overprints", year: null },
      })
    ).id;

    chopinStampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin 1" } })).id;
    sharedStampId = (await prisma.stamp.create({ data: { collectionId, name: "Shared" } })).id;
    looseStampId = (await prisma.stamp.create({ data: { collectionId, name: "Loose" } })).id;
    const undatedStampId = (
      await prisma.stamp.create({ data: { collectionId, name: "Overprint 1" } })
    ).id;

    await prisma.issueMember.createMany({
      data: [
        { issueId: chopinIssueId, stampId: chopinStampId },
        // A stamp in two issues: it is reported under its first membership only, so the groups
        // still partition the list.
        { issueId: chopinIssueId, stampId: sharedStampId },
        { issueId: sportIssueId, stampId: sharedStampId },
        { issueId: undatedIssueId, stampId: undatedStampId },
      ],
    });

    await createItem(userId, collectionId, { stampId: chopinStampId, conditionId });
    await createItem(userId, collectionId, { stampId: chopinStampId, conditionId });
    await createItem(userId, collectionId, { stampId: sharedStampId, conditionId });
    await createItem(userId, collectionId, { stampId: undatedStampId, conditionId });
    // Belongs to no issue at all, plus one for sale so a filter has something to narrow to.
    await createItem(userId, collectionId, { stampId: looseStampId, conditionId });
    await createItem(userId, collectionId, {
      stampId: looseStampId,
      conditionId,
      forSale: true,
    });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("groups by issue in the Issues list's order, year-less then issue-less last", async () => {
    const { groups } = await listItemIssueGroups(userId, collectionId);
    assert.deepEqual(
      groups.map((g) => [g.label, g.count]),
      [
        // Chopin holds three: its own stamp twice, plus the shared stamp, whose *first* membership
        // it is — Sport therefore holds none and does not appear at all.
        ["Chopin (1949)", 3],
        ["Overprints", 1],
        ["No issue", 2],
      ]
    );
    assert.equal(groups[0].issueId, chopinIssueId);
    assert.equal(groups[1].issueId, undatedIssueId);
    assert.equal(groups[2].issueId, null);
  });

  it("counts every copy exactly once across the groups", async () => {
    const { groups } = await listItemIssueGroups(userId, collectionId);
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const { items } = await listItemsPaginated(userId, collectionId, { pageSize: 100 });
    assert.equal(total, items.length);
  });

  it("counts the filtered set, not the whole collection", async () => {
    const { groups } = await listItemIssueGroups(userId, collectionId, { forSale: true });
    assert.deepEqual(
      groups.map((g) => [g.label, g.count]),
      [["No issue", 1]]
    );
  });

  it("pages over a total order", async () => {
    const first = await listItemIssueGroups(userId, collectionId, { pageSize: 2 });
    assert.equal(first.groups.length, 2);
    assert.equal(first.nextCursor, "2");
    const second = await listItemIssueGroups(userId, collectionId, { pageSize: 2, offset: 2 });
    assert.equal(second.nextCursor, null);
    const seen = [...first.groups, ...second.groups].map((g) => g.key);
    assert.equal(new Set(seen).size, 3);
  });

  it("addresses its own members with the issue pinned", async () => {
    const { groups } = await listItemIssueGroups(userId, collectionId);
    const chopin = groups.find((g) => g.issueId === chopinIssueId)!;
    const members = await listItemsPaginated(userId, collectionId, { issueId: chopinIssueId });
    assert.equal(members.items.length, chopin.count);

    const none = groups.find((g) => g.issueId === null)!;
    const noneMembers = await listItemsPaginated(userId, collectionId, { issueId: NO_ISSUE });
    assert.equal(noneMembers.items.length, none.count);
    assert.equal(
      noneMembers.items.every((i) => i.issueId === null),
      true
    );
  });
});
