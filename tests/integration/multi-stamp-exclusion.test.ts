import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import {
  countCopiesByStamp,
  countCopiesByStampAndCondition,
  countHeldCopyRowsByStamp,
  countVariantDescendantCopies,
  loadStampCopyCounts,
  stampConditionKey,
} from "../../src/lib/copy-counts";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { getLotSetCompleteness } from "../../src/lib/lot-set-completeness";
import {
  createWantsForMissing,
  findWantsSatisfiedBy,
  loadWantCopyCounts,
  listWantsPaginated,
} from "../../src/lib/wants";
import { createPurchase } from "../../src/lib/purchases";
import { createLot } from "../../src/lib/lots";

// **A carrier bearing more than one stamp is a copy of none of them** (#745, ADR-0044 §3) — read
// back through every count that claims to say what the collection holds of a stamp.
//
// One collection, three stamps on one checklist, and three pieces that differ only in what they
// carry:
//
//   - **Mi 1** — an ordinary loose single.
//   - **Mi 2** — a cover bearing **one** stamp. This is the control, and it is the reason the rule is
//     tested rather than assumed: a cover is just as indivisible as the carrier below, and it is
//     *correctly* a copy of Mi 2 "on cover" — catalogues price exactly that. What the rule tests is
//     **unambiguity**, never indivisibility, and a predicate that had reached for `formatId` instead
//     of `stampCount` would pass every other assertion here and fail this one.
//   - **Mi 3** — a cover franked with Mi 3, Mi 1 and Mi 2. It is the copy that must disappear from
//     every count, and its further entries are there to prove the rule is **symmetric**: the leading
//     stamp is excluded on exactly the same terms as the rest, and the rest are not smuggled *in* to
//     the counts of Mi 1 and Mi 2 either, whose figures stay at the one copy each genuinely has.
//
// So every figure below reads 1 for Mi 1, 1 for Mi 2 and nothing at all for Mi 3 — and Mi 3 is
// therefore the stamp the want generator still finds missing, and the want a piece *bearing* it does
// not close.

const ts = Date.now();

describe("a multi-stamp copy is a copy of none of its stamps (#745)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let conditionId: string;
  let coverId: string;
  let issueId: string;
  let checklistId: string;
  let mi1: string, mi2: string, mi3: string;
  /** The three pieces: a loose single, a one-stamp cover, and the carrier. */
  let singleId: string, oneStampCoverId: string, carrierId: string;
  let purchaseId: string;
  let lotId: string;

  before(async () => {
    userId = `test-user-multistamp-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User multistamp-${ts}`,
        email: `test-multistamp-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-multistamp-${ts}`,
          name: "Carriers",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const catalog = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    areaId = (
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
    // The carrier type is an ordinary format row (ADR-0044 §5), which is what lets a one-stamp cover
    // be a copy of its stamp with nothing new built.
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "cov", sortOrder: 0 },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9301, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;

    const ids: string[] = [];
    for (const n of ["1", "2", "3"]) {
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
    [mi1, mi2, mi3] = ids;
    await prisma.issueMember.createMany({
      data: ids.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });
    checklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Basic",
          sortOrder: 0,
          stamps: { create: ids.map((stampId) => ({ stampId })) },
        },
      })
    ).id;

    purchaseId = (
      await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-01-01" })
    ).id;
    lotId = await createLot(userId, purchaseId, 10);

    // All three are for sale and in hand, so the only thing that can separate them in any count
    // below is what they carry.
    const common = { conditionId, lotId, forSale: true, deliveryState: "delivered" } as const;
    singleId = (await createItem(userId, collectionId, { stampId: mi1, ...common })).id;
    oneStampCoverId = (
      await createItem(userId, collectionId, { stampId: mi2, formatId: coverId, ...common })
    ).id;
    carrierId = (
      await createItem(userId, collectionId, { stampId: mi3, formatId: coverId, ...common })
    ).id;
    await setItemStamps(userId, carrierId, [
      { stampId: mi3 },
      { stampId: mi1 },
      { stampId: mi2 },
    ]);
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

  it("was set up as three pieces, one of which carries three stamps", async () => {
    const rows = await prisma.item.findMany({
      where: { collectionId },
      select: { id: true, stampCount: true, formatId: true },
      orderBy: { itemNo: "asc" },
    });
    assert.deepEqual(
      rows.map((row) => [row.id, row.stampCount, row.formatId]),
      [
        [singleId, 1, null],
        [oneStampCoverId, 1, coverId],
        [carrierId, 3, coverId],
      ]
    );
  });

  // -------------------------------------------------------------------------
  // Copy counts — the badge on the Issues tree and the Stamps list
  // -------------------------------------------------------------------------

  it("leaves the carrier out of the copy-count badge, and the one-stamp cover in", async () => {
    const counts = await countCopiesByStamp(collectionId, [mi1, mi2, mi3]);
    assert.equal(counts.get(mi1)?.total, 1, "its own loose single, and nothing off the cover");
    assert.equal(counts.get(mi2)?.total, 1, "a cover bearing one stamp is a copy of that stamp");
    assert.equal(counts.get(mi3), undefined, "the carrier is a copy of none of its stamps");
    // The markers go with the total rather than being counted over a wider set.
    assert.equal(counts.get(mi1)?.forSale, 1);
    assert.equal(counts.get(mi2)?.forSale, 1);
  });

  it("leaves it out of the condition breakdown and the held-copy rows too", async () => {
    const byCondition = await countCopiesByStampAndCondition(collectionId, [mi1, mi2, mi3]);
    assert.equal(byCondition.get(stampConditionKey(mi1, conditionId)), 1);
    assert.equal(byCondition.get(stampConditionKey(mi2, conditionId)), 1);
    assert.equal(byCondition.get(stampConditionKey(mi3, conditionId)), undefined);

    const heldRows = await countHeldCopyRowsByStamp(collectionId, [mi1, mi2, mi3]);
    assert.equal(heldRows.get(mi1)?.length, 1);
    assert.equal(heldRows.get(mi2)?.length, 1);
    assert.equal(heldRows.get(mi3), undefined);
  });

  it("leaves it out of a variant rollup, at the level the copy is actually linked to", async () => {
    // A variant under Mi 3, with the carrier re-pointed at it: the rollup reads the *descendant's*
    // copies, so this is the same exclusion asked one level down — where a count that had been
    // rolled up from somewhere else would show it again.
    const subtype = await prisma.stampSubtype.create({
      data: { collectionId, name: "Perforation", actsAsVariant: true, sortOrder: 0 },
    });
    const variant = await prisma.stamp.create({
      data: { collectionId, name: "Chopin 3 II", parentId: mi3, subtypeId: subtype.id },
    });
    const variantCarrier = await createItem(userId, collectionId, {
      stampId: variant.id,
      conditionId,
      formatId: coverId,
    });
    await setItemStamps(userId, variantCarrier.id, [{ stampId: variant.id }, { stampId: mi1 }]);

    const { direct, variant: rolled } = await loadStampCopyCounts(collectionId, [mi3]);
    assert.equal(direct.get(mi3), undefined);
    assert.equal(rolled.get(mi3), undefined, "a carrier under a variant rolls up as nothing");

    // An ordinary copy of the same variant does roll up, which is what says the exclusion above is
    // about the carrier rather than about the variant tree.
    const ordinary = await createItem(userId, collectionId, {
      stampId: variant.id,
      conditionId,
    });
    assert.equal((await countVariantDescendantCopies(collectionId, [mi3])).get(mi3)?.total, 1);

    await prisma.item.deleteMany({ where: { id: { in: [variantCarrier.id, ordinary.id] } } });
    await prisma.stamp.delete({ where: { id: variant.id } });
    await prisma.stampSubtype.delete({ where: { id: subtype.id } });
  });

  // -------------------------------------------------------------------------
  // Completeness
  // -------------------------------------------------------------------------

  it("counts two of the issue's three stamps as held, the carrier completing nothing", async () => {
    const { checklists } = await getIssueCompleteness(userId, collectionId, issueId);
    const [basic] = checklists;
    assert.equal(basic.checklistId, checklistId);
    assert.equal(basic.requiredCount, 3);
    const anyCondition = basic.rows.find(
      (row) => row.disposition === "for_sale" && row.conditionId === null
    );
    assert.equal(anyCondition?.owned, 2, "Mi 1 loose and Mi 2 on its own cover");
    assert.equal(anyCondition?.completeSets, 0, "Mi 3 is not supplied by the piece bearing it");
  });

  it("counts the same two as for-sale stock on the lot's set figure", async () => {
    const [basic] = (await getLotSetCompleteness(userId, collectionId, [issueId], { lotId }))[
      issueId
    ];
    assert.equal(basic.requiredCount, 3);
    assert.equal(basic.owned, 2);
    assert.equal(basic.fromHere, 2, "both came out of this parcel; the carrier supplies neither");
    assert.equal(basic.missingCount, 1);
    // Named by catalog number, which is what a collector goes back to the box with.
    assert.equal(basic.missing.length, 1);
    assert.match(basic.missing[0], /3/);
  });

  // -------------------------------------------------------------------------
  // Wants
  // -------------------------------------------------------------------------

  it("counts no copies against a want for a stamp only a carrier bears", async () => {
    const counts = await loadWantCopyCounts(collectionId, [mi1, mi2, mi3]);
    assert.equal(counts.get(mi1)?.held, 1);
    assert.equal(counts.get(mi2)?.held, 1);
    assert.equal(counts.get(mi3), undefined);
  });

  it("still generates the want the carrier looks like it should have closed", async () => {
    const result = await createWantsForMissing(userId, collectionId, checklistId);
    assert.equal(result.missing, 1, "Mi 1 and Mi 2 are held; Mi 3 is not");
    assert.equal(result.created, 1);
    const wants = await prisma.want.findMany({
      where: { collectionId },
      select: { stampId: true },
    });
    assert.deepEqual(
      wants.map((want) => want.stampId),
      [mi3]
    );

    // And the want's own badge says nothing is held of it, from the same predicate.
    const { items } = await listWantsPaginated(userId, collectionId, {});
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].copies, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });
  });

  it("does not offer to close that want when the piece bearing the stamp arrives", async () => {
    const arriving = {
      itemId: carrierId,
      itemNo: 3,
      stampId: mi3,
      conditionId,
      certificateStatusId: null,
      formatId: coverId,
    };
    assert.deepEqual(
      await findWantsSatisfiedBy(userId, collectionId, [arriving]),
      [],
      "a cover franked with Mi 3 satisfies no want for Mi 3"
    );

    // The control, and the whole reason the previous assertion is not simply "wants never match":
    // an ordinary copy of Mi 3, described identically, does answer the want.
    const ordinary = await createItem(userId, collectionId, { stampId: mi3, conditionId });
    const matches = await findWantsSatisfiedBy(userId, collectionId, [
      {
        itemId: ordinary.id,
        itemNo: ordinary.itemNo,
        stampId: mi3,
        conditionId,
        certificateStatusId: null,
        formatId: null,
      },
    ]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].itemId, ordinary.id);
    await prisma.item.delete({ where: { id: ordinary.id } });
  });

  // -------------------------------------------------------------------------
  // Coming back
  // -------------------------------------------------------------------------

  it("puts the piece back into every count when it is taken down to one stamp", async () => {
    // The counts follow the facts, with no conversion of its own (ADR-0044 §7): this is the same
    // ordinary edit that made it a carrier, run the other way.
    await setItemStamps(userId, carrierId, [{ stampId: mi3 }]);

    assert.equal((await countCopiesByStamp(collectionId, [mi3])).get(mi3)?.total, 1);
    assert.equal(
      (await countCopiesByStampAndCondition(collectionId, [mi3])).get(
        stampConditionKey(mi3, conditionId)
      ),
      1
    );
    const [basic] = (await getIssueCompleteness(userId, collectionId, issueId)).checklists;
    assert.equal(
      basic.rows.find((row) => row.disposition === "for_sale" && row.conditionId === null)?.owned,
      3
    );
    assert.equal((await loadWantCopyCounts(collectionId, [mi3])).get(mi3)?.held, 1);
  });
});
