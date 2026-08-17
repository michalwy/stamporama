import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getQuickCatalogPriceContext, quickSetCatalogPrices } from "../../src/lib/stamps";
import { createFormatFactor } from "../../src/lib/format-factors";

// The quick catalog-value dialog prices the **single**, wherever it is opened from (#343 revisited).
//
// It used to write the row of whatever format the calling screen was showing — a block column on the
// Issue list, a lot line's own format — while the Copies list and the purchase screen wrote the
// single's. Two things were wrong with the format write, and both are invisible afterwards: a figure
// read off a paper catalogue is a *single's* quotation, so filing it as the block's own price states
// something the catalogue never said; and an explicit format row outranks the derivation, so it also
// silently switched that stamp's block off the factor for good. What the collector sees is a block
// priced "correctly" — at the single's figure.
//
// So the rule is pinned here rather than left to the dialog: the write lands on `formatId: null`, the
// read prefills from that same row, and the shown format comes back as *context* — its factor and any
// explicit price already recorded for it — for the line the dialog draws instead of an input.

describe("quick catalog price always lands on the single (#343)", () => {
  let userId: string;
  let collectionId: string;
  let catalogNameId: string;
  let editionId: string;
  let conditionId: string;
  let block4Id: string;
  let stampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-qcp-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User qcp-${ts}`,
        email: `test-qcp-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-qcp-${ts}`, name: `Collection qcp-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    catalogNameId = catalogName.id;
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    block4Id = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });

    await createFormatFactor(userId, collectionId, {
      formatId: block4Id,
      factor: 2.2,
      collectionAreaId: null,
      issueId: null,
      conditionId: null,
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("writes the single's row, and edits it rather than adding a second one", async () => {
    await quickSetCatalogPrices(userId, stampId, conditionId, null, [{ catalogNameId, amount: 12.5 }]);
    await quickSetCatalogPrices(userId, stampId, conditionId, null, [{ catalogNameId, amount: 15 }]);

    const rows = await prisma.stampCatalogPrice.findMany({
      where: { stampId, catalogEditionId: editionId, conditionId },
      select: { formatId: true, price: true },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].formatId, null);
    assert.equal(rows[0].price.toFixed(2), "15.00");
  });

  it("reads back the single's figure even when the caller is showing a block", async () => {
    const context = await getQuickCatalogPriceContext(userId, stampId, conditionId, null, block4Id);
    const primary = context.catalogs.find((c) => c.isPrimary);
    // The input prefills from the single — not from nothing, which is what a block-keyed read
    // returned for a stamp priced here a moment earlier.
    assert.equal(primary?.amount, "15.00");
    assert.equal(primary?.formatAmount, null);
    // …and the block is reported as context, with the factor that derives it.
    assert.deepEqual(context.displayFormat, {
      formatId: block4Id,
      abbreviation: "Blk4",
      factor: 2.2,
    });
    // The row the field writes to is the target it marks, at the single.
    const target = context.otherPrices.find((p) => p.isTarget);
    assert.equal(target?.price, "15.00");
    assert.equal(target?.formatAbbreviation, null);
  });

  it("says nothing about formats when the caller is showing singles", async () => {
    const context = await getQuickCatalogPriceContext(userId, stampId, conditionId, null, null);
    assert.equal(context.displayFormat, null);
    assert.equal(context.catalogs.find((c) => c.isPrimary)?.formatAmount, null);
  });

  it("reports an explicit format price as its own figure, untouched by what is typed here", async () => {
    // Entered on the stamp's Prices tab, which is the only surface that writes one.
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: editionId,
        conditionId,
        certificateStatusId: null,
        formatId: block4Id,
        price: "40.00",
        currency: "EUR",
      },
    });

    await quickSetCatalogPrices(userId, stampId, conditionId, null, [{ catalogNameId, amount: 20 }]);

    const context = await getQuickCatalogPriceContext(userId, stampId, conditionId, null, block4Id);
    const primary = context.catalogs.find((c) => c.isPrimary);
    assert.equal(primary?.amount, "20.00");
    // The explicit block price is reported so the dialog can say the factor does not apply to it —
    // and it is still 40.00, not the 20.00 just typed for the single.
    assert.equal(primary?.formatAmount, "40.00");
    const block = await prisma.stampCatalogPrice.findFirstOrThrow({
      where: { stampId, catalogEditionId: editionId, conditionId, formatId: block4Id },
      select: { price: true },
    });
    assert.equal(block.price.toFixed(2), "40.00");
  });
});
