import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getStampSelectionSubtrees } from "../../src/lib/stamp-selection";
import { selectionReach } from "../../src/lib/stamp-tree-selection";

// What a selection on the Issues list's stamp tree reaches (#808).
//
// The bar's reach is a claim about which stamps a bulk action will touch, so the risks are the same
// two the preset write has: a walk that stops short — at depth one, or at a child filed as a distinct
// entry — and one that runs past the selection. The tree is built so each fails a control of its own:
// `309APa` sits three levels down, `309 Ia` hangs under a plate flaw, and `450` is a leaf nobody
// ticked. A second collection's stamp stands in for an id that must never be reported as existing.

const ts = Date.now();

describe("stamp selection subtrees (#808)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let base: string, a: string, ap: string, apa: string, flaw: string, flawChild: string;
  let outsider: string;
  let stranger: string;

  before(async () => {
    userId = `test-user-selection-${ts}`;
    otherUserId = `test-user-selection-other-${ts}`;
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        name: `Test User ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-selection-${ts}`, name: "Selection", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-selection-other-${ts}`,
          name: "Other",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;

    const distinctSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Plate flaw", actsAsVariant: false, isDefault: false, sortOrder: 0 },
      })
    ).id;

    const stamp = async (
      name: string,
      opts: { parentId?: string; subtypeId?: string; collection?: string } = {}
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId: opts.collection ?? collectionId,
            name,
            parentId: opts.parentId,
            subtypeId: opts.subtypeId,
          },
        })
      ).id;

    base = await stamp("309");
    a = await stamp("309A", { parentId: base });
    ap = await stamp("309AP", { parentId: a });
    apa = await stamp("309APa", { parentId: ap });
    flaw = await stamp("309 I", { parentId: base, subtypeId: distinctSubtypeId });
    flawChild = await stamp("309 Ia", { parentId: flaw });
    outsider = await stamp("450");
    stranger = await stamp("999", { collection: otherCollectionId });
  });

  after(async () => {
    for (const id of [apa, ap, a, flawChild, flaw, base, outsider, stranger]) {
      await prisma.stamp.deleteMany({ where: { id } });
    }
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("carries a ticked stamp's whole subtree, through a distinct entry, and nothing beside it", async () => {
    const answer = await getStampSelectionSubtrees(userId, collectionId, [base]);
    assert.deepEqual(
      new Set(answer.subtrees[base]),
      new Set([a, ap, apa, flaw, flawChild]),
      "every descendant at any depth, the plate flaw and the variant under it included"
    );
    const reach = selectionReach([base], answer.subtrees);
    assert.equal(reach?.size, 6);
    assert.equal(reach?.has(outsider), false, "a stamp nobody ticked is not reached");
  });

  it("goes down from a ticked stamp, never up", async () => {
    const answer = await getStampSelectionSubtrees(userId, collectionId, [ap]);
    assert.deepEqual(answer.subtrees[ap], [apa]);
    assert.equal(selectionReach([ap], answer.subtrees)?.has(base), false);
  });

  it("reports a stamp that is gone, or in another collection, as not existing", async () => {
    const { id: gone } = await prisma.stamp.create({ data: { collectionId, name: "gone" } });
    await prisma.stamp.delete({ where: { id: gone } });

    const answer = await getStampSelectionSubtrees(userId, collectionId, [base, gone, stranger]);
    assert.deepEqual(new Set(answer.asked), new Set([base, gone, stranger]));
    assert.deepEqual(answer.existingIds, [base]);
    assert.equal(answer.subtrees[stranger], undefined, "another collection's subtree is never read");
  });

  it("refuses a collection the caller does not own", async () => {
    await assert.rejects(() => getStampSelectionSubtrees(otherUserId, collectionId, [base]));
  });
});
