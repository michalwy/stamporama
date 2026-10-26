import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addStampsToIssueChecklist,
  createChecklist,
  followIssueOrder,
  getChecklist,
  reorderChecklistStamps,
  setChecklistStamps,
  setStampChecklistsForIssue,
} from "../../src/lib/checklists";
import { reorderIssueMembers, reparentStampNode } from "../../src/lib/issues";

// An issue's checklist follows the issue's stamp order until it is given an order of its own (#2208).
//
// Following is stored, not computed on read: every write that changes the issue's tree or the
// checklist's stamps rewrites the checklist's `sortOrder` in the order the issue's tree reads down the
// page. So what is pinned here is the writes — a reorder of the issue, a stamp ticked, a stamp joining
// from its form, an add, a reparent — each read back through the checklist's ordinary order.

const ts = Date.now();

describe("an issue's checklist follows the issue's stamp order (#2208)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  /** Roots `a`, `b`, `c` in that order; `b1` and `b2` are `b`'s variants. */
  let a: string, b: string, b1: string, b2: string, c: string;
  let following: string;
  let own: string;

  async function order(checklistId: string): Promise<string[]> {
    const checklist = await getChecklist(userId, collectionId, checklistId);
    assert.ok(checklist, "checklist missing");
    return checklist.stampIds;
  }

  async function follows(checklistId: string): Promise<boolean> {
    const checklist = await getChecklist(userId, collectionId, checklistId);
    assert.ok(checklist, "checklist missing");
    return checklist.followsIssueOrder;
  }

  before(async () => {
    userId = `test-user-clfollow-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User clfollow-${ts}`,
        email: `test-clfollow-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-clfollow-${ts}`, name: "Follow", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 92208, collectionAreaId: areaId, name: "Grosik", year: 1928 },
      })
    ).id;
    const stamp = async (name: string, parentId: string | null = null): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            parentId,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    a = await stamp("a");
    b = await stamp("b");
    b1 = await stamp("b1", b);
    b2 = await stamp("b2", b);
    c = await stamp("c");
    await prisma.issueMember.createMany({
      data: [
        { issueId, stampId: a, sortOrder: 0 },
        { issueId, stampId: b, sortOrder: 1 },
        { issueId, stampId: b1, sortOrder: 0 },
        { issueId, stampId: b2, sortOrder: 1 },
        { issueId, stampId: c, sortOrder: 2 },
      ],
    });
    following = await createChecklist(userId, collectionId, { issueId, name: "Basic" });
    own = await createChecklist(userId, collectionId, { issueId, name: "Own" });
  });

  after(async () => {
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("starts an issue's new checklist following the issue, and a spanning one with an order of its own", async () => {
    assert.equal(await follows(following), true);
    const spanning = await createChecklist(userId, collectionId, { issueId: null, name: "Thematic" });
    assert.equal(await follows(spanning), false);
    await assert.rejects(followIssueOrder(userId, spanning), /no issue order to follow/);
  });

  it("reads ticked stamps in the issue's order, not the order ticked", async () => {
    await setChecklistStamps(userId, following, [c, b2, a]);
    assert.deepEqual(await order(following), [a, b2, c]);
  });

  it("puts a stamp ticked later at its place in the issue's order", async () => {
    await setChecklistStamps(userId, following, [a, b2, c, b]);
    assert.deepEqual(await order(following), [a, b, b2, c]);
  });

  it("gives a checklist an order of its own when its stamps are set in an order", async () => {
    await setChecklistStamps(userId, own, [a, b, c]);
    await reorderChecklistStamps(userId, own, [c, a, b]);
    assert.equal(await follows(own), false);
    assert.deepEqual(await order(own), [c, a, b]);
  });

  it("reorders the following checklist with the issue, and leaves the one with its own order alone", async () => {
    await reorderIssueMembers(userId, collectionId, issueId, [c, b, a]);
    assert.deepEqual(await order(following), [c, b, b2, a]);
    await reorderIssueMembers(userId, collectionId, issueId, [b2, b1]);
    assert.deepEqual(await order(following), [c, b, b2, a]);
    assert.deepEqual(await order(own), [c, a, b]);
  });

  it("appends a stamp ticked on a checklist with its own order", async () => {
    await setChecklistStamps(userId, own, [c, a, b, b1]);
    assert.deepEqual(await order(own), [c, a, b, b1]);
  });

  it("places a stamp joining from its form, or added, in the issue's order", async () => {
    // The issue reads c, b, b2, b1, a.
    await setStampChecklistsForIssue(userId, collectionId, issueId, b1, [following], true);
    assert.deepEqual(await order(following), [c, b, b2, b1, a]);
    await setChecklistStamps(userId, following, [c, b, a]);
    assert.equal(await addStampsToIssueChecklist(userId, following, [b1]), 1);
    assert.deepEqual(await order(following), [c, b, b1, a]);
  });

  it("follows a stamp reparented in the tree", async () => {
    // `b1` comes up to the top level and lands last among the roots: c, b, b2, a, b1.
    await reparentStampNode(userId, collectionId, issueId, b1, null);
    assert.deepEqual(await order(following), [c, b, a, b1]);
  });

  it("puts a checklist with its own order back to following the issue", async () => {
    // `b1` left it when its form put it on the following checklist alone.
    await followIssueOrder(userId, own);
    assert.equal(await follows(own), true);
    assert.deepEqual(await order(own), [c, b, a]);
    const stored = await prisma.checklistStamp.findMany({
      where: { checklistId: own },
      orderBy: { sortOrder: "asc" },
      select: { sortOrder: true },
    });
    assert.deepEqual(
      stored.map((r) => r.sortOrder),
      [0, 1, 2]
    );
  });
});
