import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addStampToIssue,
  listIssueMembers,
  mergeIssues,
  moveStampNode,
  reorderIssueMembers,
} from "../../src/lib/issues";

// Manual ordering of an issue's stamp tree (#549): the default is the order added, a reorder moves
// one sibling group and only that group, and everything arriving from elsewhere lands at the end.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-issorder-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-issorder-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

let nextTestIssueNo = 9501;

describe("issue stamp order", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-issorder-${ts}`,
          name: `Collection ${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Area" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newIssue(name: string) {
    return prisma.issue.create({
      data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name },
    });
  }

  async function addStamp(issueId: string, name: string, parentStampId?: string) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      catalogNumbers: [],
      checklistIds: [],
      parentStampId,
    });
    return stampId;
  }

  async function orderOf(issueId: string) {
    const members = await listIssueMembers(userId, collectionId, issueId);
    return members.map((m) => m.name);
  }

  it("lists stamps in the order they were added, and appends new ones at the end", async () => {
    const issue = await newIssue("Insertion order");
    await addStamp(issue.id, "first");
    await addStamp(issue.id, "second");
    assert.deepEqual(await orderOf(issue.id), ["first", "second"]);

    await addStamp(issue.id, "third");
    assert.deepEqual(await orderOf(issue.id), ["first", "second", "third"]);
  });

  it("reorders the root group and leaves a parent's variants alone", async () => {
    const issue = await newIssue("Reorder roots");
    const a = await addStamp(issue.id, "a");
    const b = await addStamp(issue.id, "b");
    const b1 = await addStamp(issue.id, "b1", b);
    const b2 = await addStamp(issue.id, "b2", b);

    await reorderIssueMembers(userId, collectionId, issue.id, [b, a]);

    const members = await listIssueMembers(userId, collectionId, issue.id);
    const roots = members.filter((m) => m.parentId === null).map((m) => m.name);
    const children = members.filter((m) => m.parentId === b).map((m) => m.name);
    assert.deepEqual(roots, ["b", "a"]);
    // The variants were not named in the request, so their own order is untouched.
    assert.deepEqual(children, ["b1", "b2"]);

    await reorderIssueMembers(userId, collectionId, issue.id, [b2, b1]);
    const after = await listIssueMembers(userId, collectionId, issue.id);
    assert.deepEqual(
      after.filter((m) => m.parentId === b).map((m) => m.name),
      ["b2", "b1"]
    );
    assert.deepEqual(
      after.filter((m) => m.parentId === null).map((m) => m.name),
      ["b", "a"]
    );
  });

  it("appends a new stamp after a reorder rather than into the middle", async () => {
    const issue = await newIssue("Append after reorder");
    const a = await addStamp(issue.id, "a");
    const b = await addStamp(issue.id, "b");
    await reorderIssueMembers(userId, collectionId, issue.id, [b, a]);
    await addStamp(issue.id, "c");
    assert.deepEqual(await orderOf(issue.id), ["b", "a", "c"]);
  });

  it("refuses a partial group, a mixed-level group, and a stranger", async () => {
    const issue = await newIssue("Refusals");
    const a = await addStamp(issue.id, "a");
    const b = await addStamp(issue.id, "b");
    const b1 = await addStamp(issue.id, "b1", b);

    // The filtered-tree case: dropping "a" would move "b" past a sibling nobody could see.
    await assert.rejects(() => reorderIssueMembers(userId, collectionId, issue.id, [b]));
    await assert.rejects(() => reorderIssueMembers(userId, collectionId, issue.id, [a, b1]));
    await assert.rejects(() =>
      reorderIssueMembers(userId, collectionId, issue.id, [a, b, "no-such-stamp"])
    );

    // Refused means unchanged.
    assert.deepEqual(await orderOf(issue.id), ["a", "b", "b1"]);
  });

  it("lands a moved subtree at the end of the target issue", async () => {
    const source = await newIssue("Source");
    const target = await newIssue("Target");
    await addStamp(target.id, "t1");
    await addStamp(target.id, "t2");
    const s = await addStamp(source.id, "s");
    await addStamp(source.id, "s1", s);

    await moveStampNode(userId, collectionId, source.id, s, target.id);

    assert.deepEqual(await orderOf(target.id), ["t1", "t2", "s", "s1"]);
  });

  it("lands a merged issue's stamps at the end, in the order they had", async () => {
    const source = await newIssue("Merge source");
    const target = await newIssue("Merge target");
    await addStamp(target.id, "t1");
    const m1 = await addStamp(source.id, "m1");
    const m2 = await addStamp(source.id, "m2");
    await reorderIssueMembers(userId, collectionId, source.id, [m2, m1]);

    await mergeIssues(userId, collectionId, source.id, target.id);

    assert.deepEqual(await orderOf(target.id), ["t1", "m2", "m1"]);
  });
});
