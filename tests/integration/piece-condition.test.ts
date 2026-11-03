import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItemsByCondition, createItem, listItemsPaginated, updateItem } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { ConditionRequiredError } from "../../src/lib/item-condition";
import { updateStampFormat } from "../../src/lib/stamp-formats";
import { bulkUpdateLotItems, createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { countCopiesByStamp } from "../../src/lib/copy-counts";
import { findWantsSatisfiedBy, loadWantCopyCounts } from "../../src/lib/wants";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { NO_CONDITION } from "../../src/lib/piece-condition";

// **A piece has no condition, and no piece counts towards a stamp's holdings** (#2383; ADR-0079).
// A piece is a copy carrying several stamps, or one stamp on a format of kind on cover or on piece.
// Becoming one drops the condition; ceasing to be one asks for it; and a cover carrying one stamp is
// counted exactly as one carrying several — towards none of them.

const ts = Date.now();

describe("a piece has no condition (#2383)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let coverId: string;
  let issueId: string;
  let mi1: string, mi2: string;
  let lotId: string;

  const conditionOf = async (itemId: string) =>
    (await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { conditionId: true } }))
      .conditionId;

  before(async () => {
    userId = `test-user-piececond-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User piececond-${ts}`,
        email: `test-piececond-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-piececond-${ts}`, name: "Pieces", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalog = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
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
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "cov", sortOrder: 0, pieceKind: "on_cover" },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9383, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;
    const ids: string[] = [];
    for (const n of ["1", "2"]) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Chopin ${n}`,
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number: n }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      ids.push(stamp.id);
    }
    [mi1, mi2] = ids;
    await prisma.issueMember.createMany({
      data: ids.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId,
        name: "Basic",
        sortOrder: 0,
        stamps: { create: ids.map((stampId) => ({ stampId })) },
      },
    });
    const purchaseId = (
      await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-01-01" })
    ).id;
    lotId = await createLot(userId, purchaseId, 10);
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchaseLot.deleteMany({ where: { purchase: { collectionId } } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores no condition for a cover carrying one stamp, even when one is given", async () => {
    const cover = await createItem(userId, collectionId, { stampId: mi1, conditionId, formatId: coverId });
    assert.equal(cover.conditionId, null);
    const bare = await createItem(userId, collectionId, { stampId: mi1, formatId: coverId });
    assert.equal(bare.conditionId, null);
    await prisma.item.deleteMany({ where: { id: { in: [cover.id, bare.id] } } });
  });

  it("refuses a loose stamp without a condition", async () => {
    await assert.rejects(createItem(userId, collectionId, { stampId: mi1 }), ConditionRequiredError);
  });

  it("drops the condition when a second stamp is added, and asks for it to go back to one", async () => {
    const copy = await createItem(userId, collectionId, { stampId: mi1, conditionId });
    await setItemStamps(userId, copy.id, [{ stampId: mi1 }, { stampId: mi2 }]);
    assert.equal(await conditionOf(copy.id), null);

    await assert.rejects(setItemStamps(userId, copy.id, [{ stampId: mi1 }]), ConditionRequiredError);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: copy.id }, select: { stampCount: true } }))
        .stampCount,
      2,
      "the refused save left the piece as it was"
    );

    const { item } = await updateItem(userId, copy.id, { stamps: [{ stampId: mi1 }], conditionId });
    assert.equal(item.conditionId, conditionId);
    await prisma.item.delete({ where: { id: copy.id } });
  });

  it("drops the condition when a cover format is picked, and asks for it when the copy leaves it", async () => {
    const copy = await createItem(userId, collectionId, { stampId: mi1, conditionId });
    const { item: asCover } = await updateItem(userId, copy.id, { formatId: coverId });
    assert.equal(asCover.conditionId, null);

    await assert.rejects(updateItem(userId, copy.id, { formatId: null }), ConditionRequiredError);
    assert.equal(await conditionOf(copy.id), null);

    const { item: loose } = await updateItem(userId, copy.id, { formatId: null, conditionId });
    assert.equal(loose.conditionId, conditionId);
    await prisma.item.delete({ where: { id: copy.id } });
  });

  it("clears its copies' conditions when a format is given a kind, and refuses to take it away under them", async () => {
    const block = await prisma.stampFormat.create({
      data: { collectionId, name: "Fragment", abbreviation: "fr", sortOrder: 1 },
    });
    const copy = await createItem(userId, collectionId, { stampId: mi1, conditionId, formatId: block.id });
    assert.equal(copy.conditionId, conditionId, "no kind yet: a loose stamp in that format");

    await updateStampFormat(userId, block.id, { name: "Fragment", abbreviation: "fr", pieceKind: "on_piece" });
    assert.equal(await conditionOf(copy.id), null);

    await assert.rejects(
      updateStampFormat(userId, block.id, { name: "Fragment", abbreviation: "fr", pieceKind: null }),
      /Move them to another format first/
    );
    assert.equal(
      (await prisma.stampFormat.findUniqueOrThrow({ where: { id: block.id } })).pieceKind,
      "on_piece",
      "the refusal rolled the kind back"
    );
    await prisma.item.delete({ where: { id: copy.id } });
    await prisma.stampFormat.delete({ where: { id: block.id } });
  });

  it("lets a bulk change give a condition to the loose stamps and none to the pieces", async () => {
    const loose = await createItem(userId, collectionId, { stampId: mi1, conditionId, lotId });
    const cover = await createItem(userId, collectionId, { stampId: mi2, formatId: coverId, lotId });
    const other = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 1 },
    });
    await bulkUpdateLotItems(userId, [loose.id, cover.id], { conditionId: other.id });
    assert.equal(await conditionOf(loose.id), other.id);
    assert.equal(await conditionOf(cover.id), null);
    await prisma.item.deleteMany({ where: { id: { in: [loose.id, cover.id] } } });
    await prisma.stampCondition.delete({ where: { id: other.id } });
  });

  it("counts a cover carrying one stamp towards none of that stamp's holdings", async () => {
    const common = { deliveryState: "delivered", forSale: true } as const;
    const loose = await createItem(userId, collectionId, { stampId: mi1, conditionId, ...common });
    const cover = await createItem(userId, collectionId, { stampId: mi2, formatId: coverId, ...common });

    const counts = await countCopiesByStamp(collectionId, [mi1, mi2]);
    assert.equal(counts.get(mi1)?.total, 1);
    assert.equal(counts.get(mi2), undefined, "the cover is no copy of Mi 2");

    const wantCounts = await loadWantCopyCounts(collectionId, [mi1, mi2]);
    assert.equal(wantCounts.get(mi1)?.held, 1);
    assert.equal(wantCounts.get(mi2), undefined);

    const [basic] = (await getIssueCompleteness(userId, collectionId, issueId, false)).checklists;
    const owned = basic.rows.find((row) => row.disposition === "for_sale" && row.conditionId === null)?.owned;
    assert.equal(owned, 1, "Mi 1 loose; the cover completes nothing");

    await prisma.want.create({ data: { collectionId, stampId: mi2 } });
    const matches = await findWantsSatisfiedBy(userId, collectionId, [
      { itemId: cover.id, itemNo: cover.itemNo, stampId: mi2, conditionId: null, certificateStatusId: null, formatId: coverId },
    ]);
    assert.deepEqual(matches, [], "a cover bearing Mi 2 closes no want for Mi 2");
    await prisma.want.deleteMany({ where: { collectionId } });

    await prisma.item.deleteMany({ where: { id: { in: [loose.id, cover.id] } } });
  });

  it("finds the pieces under *No condition* on the Copies list, and only them", async () => {
    const loose = await createItem(userId, collectionId, { stampId: mi1, conditionId });
    const cover = await createItem(userId, collectionId, { stampId: mi2, formatId: coverId });

    const ids = async (conditionIds: string[]) =>
      (await listItemsPaginated(userId, collectionId, { conditionIds })).items.map((i) => i.id).sort();
    assert.deepEqual(await ids([NO_CONDITION]), [cover.id]);
    assert.deepEqual(await ids([conditionId]), [loose.id]);
    assert.deepEqual(await ids([conditionId, NO_CONDITION]), [loose.id, cover.id].sort());

    const byCondition = await countItemsByCondition(userId, collectionId, {});
    assert.equal(byCondition.get(NO_CONDITION), 1);
    assert.equal(byCondition.get(conditionId), 1);

    const [row] = (await listItemsPaginated(userId, collectionId, { conditionIds: [NO_CONDITION] })).items;
    assert.equal(row.conditionName, null);
    await prisma.item.deleteMany({ where: { id: { in: [loose.id, cover.id] } } });
  });
});
