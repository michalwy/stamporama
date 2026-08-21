import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { createItem, listIssueGroupCompleteness } from "../../src/lib/items";
import { getLotSetCompleteness } from "../../src/lib/lot-set-completeness";
import { createPurchase } from "../../src/lib/purchases";
import { previewIssueMissingWants } from "../../src/lib/wants";
import { createLot } from "../../src/lib/lots";

// Copies filed under a variant child count toward the umbrella the checklist names (#661).
//
// The pure rule is one line (`satisfiedMember`); what is pinned here is everything the rule cannot
// see — that the read reaches **below** the membership at all, that the walk follows ADR-0010 §3's
// variant edges to any depth (#239) and stops at a distinct entry, and that the attribution is made
// per checklist, so the same copy is its umbrella on the basic list and itself on the specialized
// one. Every completeness reader in the app goes through it, so all three are asked here.

const ts = Date.now();

describe("checklist completeness rolls variant children up (#661)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let issueId: string;
  /** `226` and its tree: `226y` (variant) → `226yw` (variant), plus `226 I` (a distinct entry). */
  let base: string, mid: string, leaf: string, error: string;
  /** `227`, a plain second member of the basic set, and `228` with a distinct-entry child only. */
  let second: string, distinctBase: string, distinctChild: string;
  let basicId: string, specializedId: string, errorsId: string, distinctId: string;
  let lotId: string;

  async function checklist(id: string) {
    const { checklists } = await getIssueCompleteness(userId, collectionId, issueId);
    const found = checklists.find((c) => c.checklistId === id);
    assert.ok(found, "checklist missing from the grid");
    return found;
  }

  /** One cell of a grid: a disposition against a condition (`null` = any). */
  function row(
    grid: Awaited<ReturnType<typeof checklist>>,
    disposition: "any" | "in_collection" | "for_sale",
    condition: string | null
  ) {
    const found = grid.rows.find(
      (r) => r.disposition === disposition && r.conditionId === condition
    );
    assert.ok(found, "cell missing from the grid");
    return found;
  }

  before(async () => {
    userId = `test-user-varroll-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User varroll-${ts}`,
        email: `test-varroll-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-varroll-${ts}`, name: "Rollup", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Deutschland", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Germany",
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
    const variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Gum variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    const distinctSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Error", actsAsVariant: false, isDefault: false, sortOrder: 1 },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9661, collectionAreaId: areaId, name: "Numeral", year: 1955 },
      })
    ).id;

    const stamp = async (
      number: string,
      opts: { parentId?: string; subtypeId?: string } = {}
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            parentId: opts.parentId,
            subtypeId: opts.subtypeId,
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;

    base = await stamp("226");
    mid = await stamp("226y", { parentId: base, subtypeId: variantSubtypeId });
    leaf = await stamp("226yw", { parentId: mid, subtypeId: variantSubtypeId });
    error = await stamp("226 I", { parentId: base, subtypeId: distinctSubtypeId });
    second = await stamp("227");
    distinctBase = await stamp("228");
    distinctChild = await stamp("228 I", { parentId: distinctBase, subtypeId: distinctSubtypeId });

    await prisma.issueMember.createMany({
      data: [base, second, distinctBase].map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });

    const list = async (name: string, sortOrder: number, stampIds: string[]) =>
      (
        await prisma.checklist.create({
          data: {
            collectionId,
            issueId,
            name,
            sortOrder,
            stamps: { create: stampIds.map((stampId) => ({ stampId })) },
          },
        })
      ).id;
    basicId = await list("Basic", 0, [base, second]);
    specializedId = await list("Specialized", 1, [base, leaf]);
    errorsId = await list("Errors", 2, [error]);
    distinctId = await list("Distinct", 3, [distinctBase]);

    const purchaseId = (
      await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-01-01" })
    ).id;
    lotId = await createLot(userId, purchaseId, 10);

    // The bug as reported: both copies of `226` are filed under variants of it, two levels down.
    await createItem(userId, collectionId, {
      stampId: leaf,
      conditionId,
      inCollection: true,
      deliveryState: "delivered",
    });
    await createItem(userId, collectionId, {
      stampId: leaf,
      conditionId,
      lotId,
      forSale: true,
      deliveryState: "delivered",
    });
    await createItem(userId, collectionId, {
      stampId: second,
      conditionId,
      inCollection: true,
      deliveryState: "delivered",
    });
    // A distinct entry is its own thing to collect, never another way of holding its parent.
    await createItem(userId, collectionId, {
      stampId: error,
      conditionId,
      inCollection: true,
      deliveryState: "delivered",
    });
    await createItem(userId, collectionId, {
      stampId: distinctChild,
      conditionId,
      inCollection: true,
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
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts a copy filed two variant levels down toward the stamp the checklist names", async () => {
    const basic = await checklist(basicId);
    assert.equal(basic.requiredCount, 2);
    // `226` from the two `226yw` copies, `227` from its own: the set is held, once over.
    assert.deepEqual(row(basic, "any", null), {
      disposition: "any",
      conditionId: null,
      owned: 2,
      completeSets: 1,
    });
  });

  it("keeps the disposition axis of the rolled-up copies", async () => {
    const basic = await checklist(basicId);
    // One of the two `226yw` copies is for sale and the other is not, and rolling them up must not
    // blur that: `227` is in the collection only, so the for-sale set is one stamp short.
    assert.equal(row(basic, "in_collection", null).owned, 2);
    assert.equal(row(basic, "for_sale", null).owned, 1);
    assert.equal(row(basic, "for_sale", null).completeSets, 0);
  });

  it("gives the copy to the nearest member when a checklist names both", async () => {
    const specialized = await checklist(specializedId);
    // `226` and `226yw` are both on this list: the copies are `226yw`s, and `226` stays missing —
    // one piece of paper cannot fill two slots of one set.
    assert.equal(specialized.requiredCount, 2);
    assert.equal(row(specialized, "any", null).owned, 1);
    assert.equal(row(specialized, "any", null).completeSets, 0);
  });

  it("counts a distinct entry for itself only", async () => {
    assert.equal(row(await checklist(errorsId), "any", null).owned, 1);
    // `228 I` is an error, not another way of holding `228`, so `228` is still missing.
    assert.equal(row(await checklist(distinctId), "any", null).owned, 0);
  });

  it("rolls up on the Copies list issue group header too (#594)", async () => {
    const byIssue = await listIssueGroupCompleteness(userId, collectionId, [issueId]);
    const basic = byIssue[issueId].find((c) => c.checklistId === basicId);
    assert.ok(basic);
    assert.equal(basic.requiredCount, 2);
    assert.equal(basic.owned, 2);
    assert.deepEqual(
      basic.conditions.map((c) => [c.abbreviation, c.owned]),
      [["U", 2]]
    );
  });

  it("does not want a stamp the card calls held (#548's gap, same rollup)", async () => {
    const gaps = await previewIssueMissingWants(userId, collectionId, issueId);
    const gap = (id: string) => {
      const found = gaps.find((g) => g.checklistId === id);
      assert.ok(found, "checklist missing from the want gap");
      return found;
    };
    // `226` is held through its `226yw` copies and `227` outright: nothing to add.
    assert.deepEqual(gap(basicId).missingStampIds, []);
    // On the specialized list the copies answer as `226yw` themselves, so `226` is a real gap.
    assert.deepEqual(gap(specializedId).missingStampIds, [base]);
    // A distinct-entry child is not a copy of its parent, so `228` is still wanted.
    assert.deepEqual(gap(distinctId).missingStampIds, [distinctBase]);
  });

  it("rolls up on a lot's for-sale set header too (#563)", async () => {
    const byIssue = await getLotSetCompleteness(userId, collectionId, [issueId], { lotId });
    const basic = byIssue[issueId].find((c) => c.checklistId === basicId);
    assert.ok(basic);
    // The for-sale `226yw` out of this lot is a listable `226`; `227` is a keeper, so it is named.
    assert.equal(basic.owned, 1);
    assert.equal(basic.fromHere, 1);
    assert.equal(basic.missingCount, 1);
    assert.ok(basic.missing[0].includes("227"), basic.missing[0]);
  });
});
