import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addStampToIssue,
  listIssueMembers,
  moveStampNode,
  reparentStampNode,
} from "../../src/lib/issues";
import { createItem } from "../../src/lib/items";

// Reassigning a stamp to a different parent (#656) — the correction beside #54's move-to-another-
// issue, one level down. What matters here is that only the tree edge changes: the stamp keeps
// everything it carries, its own branch comes with it, the refusals hold, and the answers derived
// from the tree — the ones #656 calls out — are different for the old parent and the new one the
// moment the row lands, because they are read off `parentId` rather than stored.

let nextTestIssueNo = 9701;

describe("reassigning a stamp to another parent (#656)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  /** The collection default: a subtype that *acts as a variant*, so a child of a stamp makes that
   *  stamp an unknown-variant umbrella (ADR-0010 §3). */
  let variantSubtypeId: string;
  /** A child that is its own entry rather than another way of holding its parent. */
  let distinctSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-reparent-${ts}`,
          name: `Test User reparent-${ts}`,
          email: `test-reparent-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-reparent-${ts}`,
          name: `Collection ${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Area" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Gum variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    distinctSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Error", actsAsVariant: false, isDefault: false, sortOrder: 1 },
      })
    ).id;
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

  async function addStamp(
    issueId: string,
    name: string,
    opts: { parentStampId?: string; subtypeId?: string } = {}
  ) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      catalogNumbers: [],
      checklistIds: [],
      ...opts,
    });
    return stampId;
  }

  const membersOf = (issueId: string) => listIssueMembers(userId, collectionId, issueId);

  async function parentOf(stampId: string) {
    return (
      await prisma.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { parentId: true },
      })
    ).parentId;
  }

  it("files a root stamp under another one, bringing its own branch with it", async () => {
    const issue = await newIssue("Refile");
    const base = await addStamp(issue.id, "base");
    const stray = await addStamp(issue.id, "stray");
    const strayChild = await addStamp(issue.id, "stray child", { parentStampId: stray });

    await reparentStampNode(userId, collectionId, issue.id, stray, base);

    assert.equal(await parentOf(stray), base);
    // Nothing was written to the branch below it: it was already filed under `stray`, and where
    // `stray` itself hangs is not its children's business.
    assert.equal(await parentOf(strayChild), stray);
  });

  it("takes a child back to the top level", async () => {
    const issue = await newIssue("Detach");
    const base = await addStamp(issue.id, "base");
    const child = await addStamp(issue.id, "child", { parentStampId: base });

    await reparentStampNode(userId, collectionId, issue.id, child, null);

    assert.equal(await parentOf(child), null);
  });

  it("keeps everything the stamp carries — only the tree position changes", async () => {
    const issue = await newIssue("Keeps");
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: `Michel ${nextTestIssueNo}`, abbreviation: "Mi" },
    });
    const base = await addStamp(issue.id, "base");
    const wrongParent = await addStamp(issue.id, "wrong parent");
    // A child, because only a child carries a subtype at all (ADR-0010 §2a) — which is what makes
    // "it keeps the one it has" a claim worth checking.
    const stray = await addStampToIssue(userId, collectionId, issue.id, {
      name: "stray",
      catalogNumbers: [{ catalogVendorId: vendor.id, number: "12a" }],
      checklistIds: [],
      parentStampId: wrongParent,
      subtypeId: distinctSubtypeId,
    });
    const itemId = (
      await createItem(userId, collectionId, {
        stampId: stray.stampId,
        conditionId,
        inCollection: true,
        deliveryState: "delivered",
      })
    ).id;

    await reparentStampNode(userId, collectionId, issue.id, stray.stampId, base);

    const moved = await prisma.stamp.findUniqueOrThrow({
      where: { id: stray.stampId },
      select: { name: true, subtypeId: true, catalogNumbers: true },
    });
    assert.equal(moved.name, "stray");
    // The subtype is the collector's own classification of this stamp, not a fact about where it
    // hangs — a stamp that already carries one keeps it rather than being re-defaulted.
    assert.equal(moved.subtypeId, distinctSubtypeId);
    assert.deepEqual(
      moved.catalogNumbers.map((n) => n.number),
      ["12a"]
    );
    // The copy points at the stamp, so it never noticed.
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { stampId: true },
    });
    assert.equal(item.stampId, stray.stampId);
  });

  it("gives a stamp arriving at a parent the default subtype when it has none", async () => {
    const issue = await newIssue("Default subtype");
    const base = await addStamp(issue.id, "base");
    const root = await addStamp(issue.id, "root");
    assert.equal((await prisma.stamp.findUniqueOrThrow({ where: { id: root } })).subtypeId, null);

    await reparentStampNode(userId, collectionId, issue.id, root, base);

    assert.equal(
      (await prisma.stamp.findUniqueOrThrow({ where: { id: root } })).subtypeId,
      variantSubtypeId
    );
  });

  it("lands the stamp at the end of its new sibling group", async () => {
    const issue = await newIssue("Position");
    const base = await addStamp(issue.id, "base");
    await addStamp(issue.id, "b1", { parentStampId: base });
    await addStamp(issue.id, "b2", { parentStampId: base });
    const stray = await addStamp(issue.id, "stray");

    await reparentStampNode(userId, collectionId, issue.id, stray, base);

    const members = await membersOf(issue.id);
    assert.deepEqual(
      members.filter((m) => m.parentId === base).map((m) => m.name),
      ["b1", "b2", "stray"]
    );
  });

  it("refuses itself, its own descendant, and a stamp from another issue", async () => {
    const issue = await newIssue("Refusals");
    const elsewhere = await newIssue("Elsewhere");
    const base = await addStamp(issue.id, "base");
    const child = await addStamp(issue.id, "child", { parentStampId: base });
    const grandchild = await addStamp(issue.id, "grandchild", { parentStampId: child });
    const outsider = await addStamp(elsewhere.id, "outsider");

    await assert.rejects(
      () => reparentStampNode(userId, collectionId, issue.id, base, base),
      /own parent/
    );
    await assert.rejects(
      () => reparentStampNode(userId, collectionId, issue.id, base, grandchild),
      /own variant/
    );
    await assert.rejects(
      () => reparentStampNode(userId, collectionId, issue.id, base, outsider),
      /not a member/
    );

    // Refused means unchanged.
    assert.equal(await parentOf(base), null);
    assert.equal(await parentOf(grandchild), child);
  });

  it("moves the copies counted under the old parent to the new one (#528/#661)", async () => {
    // The point of "recompute for old and new parent": nothing is recomputed, because nothing was
    // stored. Both answers are read off `parentId`, so both are different on the next read.
    const issue = await newIssue("Rollup");
    const from = await addStamp(issue.id, "from");
    const to = await addStamp(issue.id, "to");
    const variant = await addStamp(issue.id, "variant", {
      parentStampId: from,
      subtypeId: variantSubtypeId,
    });
    await createItem(userId, collectionId, {
      stampId: variant,
      conditionId,
      inCollection: true,
      deliveryState: "delivered",
    });

    const before = await membersOf(issue.id);
    assert.equal(before.find((m) => m.stampId === from)?.variantCopies.inCollection, 1);
    assert.equal(before.find((m) => m.stampId === to)?.variantCopies.inCollection, 0);
    // …and the umbrella flag, read the same way (#239): a variant child makes its parent one.
    assert.equal(before.find((m) => m.stampId === variant)?.actsAsVariant, true);

    await reparentStampNode(userId, collectionId, issue.id, variant, to);

    const after = await membersOf(issue.id);
    assert.equal(after.find((m) => m.stampId === from)?.variantCopies.inCollection, 0);
    assert.equal(after.find((m) => m.stampId === to)?.variantCopies.inCollection, 1);
  });

  it("is the other half of #54: move the node, then say where it hangs", async () => {
    const source = await newIssue("Move source");
    const target = await newIssue("Move target");
    const base = await addStamp(target.id, "target base");
    const stray = await addStamp(source.id, "arriving");

    await moveStampNode(userId, collectionId, source.id, stray, target.id);
    await reparentStampNode(userId, collectionId, target.id, stray, base);

    assert.equal(await parentOf(stray), base);
    const members = await membersOf(target.id);
    assert.deepEqual(
      members.filter((m) => m.parentId === base).map((m) => m.name),
      ["arriving"]
    );
  });
});
