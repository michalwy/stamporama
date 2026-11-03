import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { valuateItemRows, type ValuationRow } from "../../src/lib/item-valuation";
import { getVariantPriceGrid } from "../../src/lib/variant-prices";
import { setAreaStillValidForPostage } from "../../src/lib/areas";
import { setIssueStillValidForPostage } from "../../src/lib/issues";
import { setValuationMethodRole } from "../../src/lib/valuation-methods";

// **Michel's rule for stamps still valid for postage (#2358) is part of the Michel method (#2375).**
// The rule's arithmetic is in `tests/unit/still-valid-postage.test.ts`; this file holds the rest as
// calls: a mark on an area reaching its stamps, an issue unmarked under it, the rule working from the
// conditions the Michel method maps as used and never hinged where its cover EF condition has no
// price — shown as derived, never written to the stamp's prices or shown on the grid — a typed price
// winning, and the value saying which role is not set up while one is not.

const ts = Date.now();

describe("stamps still valid for postage, under the Michel method (#2358, #2375)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let issueId: string;
  let stampId: string;
  let editionId: string;
  let usedId: string;
  let mintId: string;
  let efId: string;
  let coverId: string;

  before(async () => {
    userId = `test-user-still-valid-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User still-valid-${ts}`,
        email: `test-still-valid-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-still-valid-${ts}`, name: "Still valid", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "Cov", sortOrder: 0, pieceKind: "on_cover" },
      })
    ).id;

    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const book = await prisma.catalogName.create({ data: { vendorId: michel.id, name: "Michel Polen", currency: "EUR" } });
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: book.id, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: book.id,
          primaryCatalogVendorId: michel.id,
          collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: null }] },
        },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: areaId, catalogNameId: book.id } });
    const condition = async (abbreviation: string, sortOrder: number, priceOnly = false) =>
      (
        await prisma.stampCondition.create({
          data: { collectionId, name: abbreviation, abbreviation, sortOrder, priceOnly },
        })
      ).id;
    mintId = await condition("MNH", 0);
    usedId = await condition("U", 1);
    efId = await condition("EF", 2, true);
    issueId = (
      await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: areaId, name: "Definitives", year: 2015 } })
    ).id;
    stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Stamp 4700",
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number: "4700" }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.issueMember.create({ data: { issueId, stampId, sortOrder: 0 } });
    await prisma.stampCatalogPrice.createMany({
      data: [
        { stampId, catalogEditionId: editionId, conditionId: usedId, price: 2, currency: "EUR" },
        { stampId, catalogEditionId: editionId, conditionId: mintId, price: 2.2, currency: "EUR" },
      ],
    });
    for (const [role, conditionId] of [
      ["used", usedId],
      ["cover_ef", efId],
    ] as const) {
      await setValuationMethodRole(userId, collectionId, { method: "michel", role, conditionId });
    }
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** The stamp alone on a cover — a line in the Cover format, valued as a piece of it (#2375). */
  const onCover = async () => {
    const row: ValuationRow = {
      id: "cover",
      stampId,
      conditionId: usedId,
      certificateStatusId: null,
      formatId: coverId,
      unknownVariant: false,
      copy: null,
      faultReductionPercent: null,
      valueModifier: null,
      candidateStampIds: null,
    };
    return (await valuateItemRows(collectionId, [row])).get("cover")!;
  };

  it("works nothing out for a stamp nothing marks: its EF price is simply missing", async () => {
    const v = await onCover();
    // The rule has no figure; the value is the used price it is never below (#2397).
    assert.equal(v.piece?.floor?.ruleAmount, null);
    assert.equal(v.amount, "2.00");
    assert.deepEqual(v.piece?.missing.map((m) => m.price), ["cover_ef"]);
    assert.deepEqual(v.piece?.unmapped, []);
  });

  it("says which role it lacks while never hinged is not mapped", async () => {
    await setAreaStillValidForPostage(userId, areaId, true);
    const v = await onCover();
    assert.equal(v.piece?.floor?.ruleAmount, null);
    assert.equal(v.amount, "2.00");
    assert.deepEqual(v.piece?.unmapped, [{ method: "michel", role: "never_hinged" }]);
  });

  it("works a marked area's stamp out by the rule — capped by the never-hinged price — as derived", async () => {
    await setValuationMethodRole(userId, collectionId, { method: "michel", role: "never_hinged", conditionId: mintId });
    const v = await onCover();
    // 2 + 20 % is 2.40, capped at the never-hinged 2.20.
    assert.equal(v.amount, "2.20");
    assert.equal(v.piece?.partial, false);
    assert.deepEqual(v.piece?.components[0].derived, ["cover_ef"]);
    // The method's working, not a catalogue figure: nothing written, nothing on the grid.
    assert.equal(await prisma.stampCatalogPrice.count({ where: { stampId, conditionId: efId } }), 0);
    const grid = await getVariantPriceGrid(userId, { kind: "stamp", stampId });
    assert.deepEqual(grid.formatFactors, []);
  });

  it("is a Michel rule only: another method reads its cover price as missing", async () => {
    await prisma.collection.update({ where: { id: collectionId }, data: { valuationMethod: "fischer_fp_fw_fm" } });
    await setValuationMethodRole(userId, collectionId, { method: "fischer_fp_fw_fm", role: "used", conditionId: usedId });
    await setValuationMethodRole(userId, collectionId, { method: "fischer_fp_fw_fm", role: "fp", conditionId: efId });
    const v = await onCover();
    assert.equal(v.piece?.floor?.ruleAmount, null);
    assert.equal(v.amount, "2.00");
    assert.equal(v.piece?.components[0].derived, undefined);
    await prisma.collection.update({ where: { id: collectionId }, data: { valuationMethod: "michel" } });
  });

  it("lets a typed cover price win", async () => {
    await prisma.stampCatalogPrice.create({
      data: { stampId, catalogEditionId: editionId, conditionId: efId, price: 7, currency: "EUR" },
    });
    const v = await onCover();
    assert.equal(v.amount, "7.00");
    assert.equal(v.piece?.components[0].derived, undefined);
    await prisma.stampCatalogPrice.deleteMany({ where: { stampId, conditionId: efId } });
  });

  it("lets an issue be unmarked under a marked area", async () => {
    await setIssueStillValidForPostage(userId, issueId, false);
    assert.equal((await onCover()).piece?.floor?.ruleAmount, null);
    await setIssueStillValidForPostage(userId, issueId, null);
    assert.equal((await onCover()).amount, "2.20");
  });
});
