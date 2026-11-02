import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { seedDefaultFormats } from "../../src/lib/stamp-formats";
import { getStampFormatPricing } from "../../src/lib/format-pricing";
import { getStampListItem } from "../../src/lib/stamps";
import { getVariantPriceGrid } from "../../src/lib/variant-prices";
import { setAreaStillValidForPostage } from "../../src/lib/areas";
import { setIssueStillValidForPostage } from "../../src/lib/issues";
import { getStampConditions, updateStampCondition } from "../../src/lib/conditions";

// **Stamps still valid for postage get their on-cover prices from Michel's rule (#2358).** The rule's
// arithmetic is in `tests/unit/still-valid-postage.test.ts`; this file holds the rest of the *Done
// when* as calls: a mark on an area reaching its stamps, an issue unmarked under it, the rule's
// figure on the stamp's price grid, on the lists' `as` column and on the variant grid — derived, and
// giving way to a typed price — and nothing derived while a condition is unchosen.

const ts = Date.now();

describe("stamps still valid for postage (#2358)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let issueId: string;
  let stampId: string;
  let editionId: string;
  let usedId: string;
  let mintId: string;
  let mifId: string;
  let pieceId: string;

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
    await seedDefaultFormats(collectionId, prisma as never);
    const formats = await prisma.stampFormat.findMany({ where: { collectionId, coverKind: { not: null } } });
    mifId = formats.find((f) => f.coverKind === "cover_mif")!.id;
    pieceId = formats.find((f) => f.coverKind === "on_piece")!.id;

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
    mintId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0, priceRole: "never_hinged" },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1, priceRole: "used" },
      })
    ).id;
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
  });

  after(async () => {
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampFormatFactor.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const listMif = () =>
    getStampListItem(userId, stampId, { displayConditionId: usedId, displayFormatId: mifId });

  it("derives nothing for a stamp nothing marks", async () => {
    assert.equal((await getStampFormatPricing(userId, stampId)).stillValid, null);
    assert.equal((await listMif()).mainCatalogPrice, null);
  });

  it("prices a marked area's stamps on cover by the rule — capped by the never-hinged price — as derived", async () => {
    await setAreaStillValidForPostage(userId, areaId, true);
    assert.deepEqual((await getStampFormatPricing(userId, stampId)).stillValid, {
      usedConditionId: usedId,
      neverHingedConditionId: mintId,
    });
    const item = await listMif();
    // 2 + 20 % is 2.40, capped at the never-hinged 2.20.
    assert.equal(item.mainCatalogPrice?.amount, "2.20");
    assert.equal(item.mainCatalogPriceDerived, true);
  });

  it("fills the variant grid's cover cells in the used condition, and leaves on piece to its multiplier", async () => {
    await prisma.stampFormatFactor.create({ data: { collectionId, formatId: pieceId, factor: 1.5 } });
    const grid = await getVariantPriceGrid(userId, { kind: "stamp", stampId });
    const derivation = (formatId: string, conditionId: string) =>
      grid.formatFactors.find((f) => f.stampId === stampId && f.formatId === formatId && f.conditionId === conditionId)
        ?.factor;
    assert.deepEqual(derivation(mifId, usedId), { usedConditionId: usedId, neverHingedConditionId: mintId });
    assert.equal(derivation(pieceId, usedId), 1.5);
    await prisma.stampFormatFactor.deleteMany({ where: { collectionId } });
  });

  it("lets a typed cover price win", async () => {
    await prisma.stampCatalogPrice.create({
      data: { stampId, catalogEditionId: editionId, conditionId: usedId, formatId: mifId, price: 7, currency: "EUR" },
    });
    const item = await listMif();
    assert.equal(item.mainCatalogPrice?.amount, "7.00");
    assert.equal(item.mainCatalogPriceDerived, false);
    await prisma.stampCatalogPrice.deleteMany({ where: { stampId, formatId: mifId } });
  });

  it("lets an issue be unmarked under a marked area", async () => {
    await setIssueStillValidForPostage(userId, issueId, false);
    assert.equal((await getStampFormatPricing(userId, stampId)).stillValid, null);
    assert.equal((await listMif()).mainCatalogPrice, null);
    await setIssueStillValidForPostage(userId, issueId, null);
    assert.equal((await listMif()).mainCatalogPrice?.amount, "2.20");
  });

  it("moves a role to the condition chosen for it, and derives nothing while one is unchosen", async () => {
    // Choosing *never hinged* for Used takes the role from MNH — and leaves *used* unchosen, since a
    // condition plays one part.
    await updateStampCondition(userId, usedId, { name: "Used", abbreviation: "U", priceRole: "never_hinged" });
    const roles = new Map((await getStampConditions(userId, collectionId)).map((c) => [c.id, c.priceRole]));
    assert.equal(roles.get(mintId), null);
    assert.equal(roles.get(usedId), "never_hinged");
    assert.equal((await getStampFormatPricing(userId, stampId)).stillValid, null);
    assert.equal((await listMif()).mainCatalogPrice, null);

    await updateStampCondition(userId, mintId, { name: "Mint Never Hinged", abbreviation: "MNH", priceRole: "never_hinged" });
    await updateStampCondition(userId, usedId, { name: "Used", abbreviation: "U", priceRole: "used" });
    assert.equal((await listMif()).mainCatalogPrice?.amount, "2.20");
  });
});
