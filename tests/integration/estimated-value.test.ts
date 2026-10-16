import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getStampEstimatedValue,
  getChecklistEstimatedValue,
} from "../../src/lib/estimated-values";
import { readLearnedCatalogueFactors } from "../../src/lib/realization-ratios";

// Estimated value from the learned realization ratio (#602; ADR-0022 §6 as revised).
//
// The ladder itself is unit-tested in `realization-ratio.test.ts`. What earns a real database here
// is everything this read *decides*: which keys exist at all, that a key the market has actually
// measured is left to Market value, that the catalogue value multiplied is `valuateItemRows`'s (so
// the figure agrees with the bid recommendation on the lots screen), and that the fallback rung
// still answers while nothing has been learned.
//
// Base currency and every sale's currency are EUR, so no exchange rate is fetched and the suite
// runs offline — the same arrangement `market-value.test.ts` makes beside it.

describe("estimated value (#602)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let conditionId: string;
  let usedConditionId: string;
  let editionId: string;
  let catalogNameId: string;
  let areaId: string;
  /** A second area priced from the same Michel book (#1828) — results here share the plain stamp's
   * catalogue but never its area. */
  let germanyAreaId: string;
  /** A third area priced from a different book, Fischer. */
  let fischerAreaId: string;
  let fischerEditionId: string;
  let issueId: string;

  /** Priced 50.00 MNH and 8.00 used. Never in a lot, so everything about it is estimated. */
  let plainStampId: string;
  /** Priced 10.00 MNH — the stamp the recorded ratios are learned from. */
  let commonStampId: string;
  /** No catalogue price at all: nothing to multiply, so no cell. */
  let unpricedStampId: string;

  let seq = 0;

  async function price(
    stampId: string,
    conditionIdArg: string,
    amount: string,
    edition = editionId
  ): Promise<void> {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: edition,
        conditionId: conditionIdArg,
        certificateStatusId: null,
        formatId: null,
        price: amount,
        currency: "EUR",
      },
    });
  }

  async function stamp(name: string): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.issueMember.create({ data: { issueId, stampId: s.id } });
    return s.id;
  }

  /** A stamp in another area, priced 10.00 MNH in that area's book. */
  async function stampElsewhere(name: string, area: string, edition: string): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: s.id, collectionAreaId: area, isPrimary: true },
    });
    await price(s.id, conditionId, "10.00", edition);
    return s.id;
  }

  /** Three MNH results at 40% of catalogue for a stamp outside the plain stamp's area. */
  async function learnFortyPercentOf(stampId: string): Promise<void> {
    const saleId = await sale();
    for (let i = 0; i < 3; i++) await lot(saleId, stampId, "4.00");
  }

  async function setManualFactor(factor: string | null): Promise<void> {
    await prisma.catalogName.update({ where: { id: catalogNameId }, data: { manualFactor: factor } });
  }

  async function sale(): Promise<string> {
    const row = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: `Sale ${++seq}`, currency: "EUR" },
    });
    return row.id;
  }

  /** One closed, priced lot of one line — a datapoint, and so a ratio. */
  async function lot(
    saleId: string,
    stampId: string,
    finalPrice: string,
    conditionIdArg = conditionId
  ): Promise<string> {
    const row = await prisma.auctionLot.create({
      data: {
        auctionSaleId: saleId,
        auctionLotNo: 8000 + ++seq,
        lotNo: String(seq),
        endsAt: new Date(Date.now() - seq * 24 * 60 * 60 * 1000),
        status: "closed",
        finalPrice,
        lines: {
          create: [
            {
              stampId,
              conditionId: conditionIdArg,
              certificateStatusId: null,
              formatId: null,
              quantity: 1,
            },
          ],
        },
      },
    });
    return row.id;
  }

  /** Three MNH results at 40% of catalogue — enough to carry a bucket (MIN_RATIO_SAMPLE = 3). */
  async function learnFortyPercent(): Promise<string> {
    const saleId = await sale();
    await lot(saleId, commonStampId, "4.00");
    await lot(saleId, commonStampId, "4.00");
    await lot(saleId, commonStampId, "4.00");
    return saleId;
  }

  // Every test starts from no evidence, cleared *before* rather than after so one failing
  // assertion cannot fail the next test for the wrong reason.
  beforeEach(async () => {
    await prisma.auctionLot.deleteMany({ where: { auctionSale: { collectionId } } });
    await setManualFactor(null);
  });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-estimate-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User estimate-${ts}`,
        email: `test-estimate-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-estimate-${ts}`,
        name: `Collection estimate-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
        // Distinguishable from the 100% default, so the fallback rung can be told apart from a
        // ratio that happened to come out at 1.
        bidFallbackPercent: 60,
      },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    catalogNameId = catalogName.id;
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    const fischerVendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    const fischerName = await prisma.catalogName.create({
      data: { vendorId: fischerVendor.id, name: "Katalog", currency: "EUR" },
    });
    fischerEditionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: fischerName.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedConditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    germanyAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    fischerAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland (Fischer)", primaryCatalogNameId: fischerName.id },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: {
          collectionId,
          issueNo: 9301,
          collectionAreaId: areaId,
          name: "Definitives",
          year: 1950,
        },
      })
    ).id;

    plainStampId = await stamp("Plain");
    await price(plainStampId, conditionId, "50.00");
    await price(plainStampId, usedConditionId, "8.00");
    commonStampId = await stamp("Common");
    await price(commonStampId, conditionId, "10.00");
    unpricedStampId = await stamp("Unpriced");

    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro" } })
    ).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race
    // its own cascades.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("multiplies the catalogue value by the ratio learned elsewhere, and names the bucket", async () => {
    await learnFortyPercent();

    const value = await getStampEstimatedValue(userId, plainStampId);
    assert.equal(value.baseCurrency, "EUR");

    const mnh = value.cells.find((c) => c.conditionAbbreviation === "MNH");
    assert.ok(mnh, "the priced MNH key is estimated");
    assert.equal(mnh.catalogueValue, "50.00");
    assert.equal(mnh.estimate, "20.00");

    const row = value.rows.find((r) => r.conditionId === conditionId);
    assert.ok(row);
    // No issue year on these stamps, so the period rung is skipped and area × condition answers.
    assert.equal(row.level, "area-condition");
    assert.equal(row.ratio, 0.4);
    assert.equal(row.n, 3);
    assert.equal(row.bucketLabel, "Poland, MNH");
  });

  it("expands into the lots the bucket was learned from — other stamps' lots", async () => {
    await learnFortyPercent();

    const value = await getStampEstimatedValue(userId, plainStampId);
    const row = value.rows.find((r) => r.conditionId === conditionId);
    assert.ok(row);
    assert.equal(row.lots.length, 3);
    // The evidence is about the *other* stamp — that is what a bucket is.
    assert.ok(row.lots.every((l) => l.stampName === "Common"));
    assert.ok(row.lots.every((l) => l.conditionAbbreviation === "MNH"));
    assert.ok(row.lots.every((l) => l.ratio === 0.4));
    assert.ok(row.lots.every((l) => l.split === false));
    // Newest first, the order a collector reads evidence in.
    assert.deepEqual(
      row.lots.map((l) => l.endsAt.getTime()),
      [...row.lots.map((l) => l.endsAt.getTime())].sort((a, b) => b - a)
    );
  });

  it("leaves a key with a measured median to Market value, and still estimates the rest", async () => {
    const saleId = await learnFortyPercent();
    // The stamp's own MNH result — a measurement, so that cell is not estimated.
    await lot(saleId, plainStampId, "33.00");

    const value = await getStampEstimatedValue(userId, plainStampId);
    assert.equal(value.cells.find((c) => c.conditionAbbreviation === "MNH"), undefined);

    const used = value.cells.find((c) => c.conditionAbbreviation === "U");
    assert.ok(used, "the used key has no results of its own and is still estimated");
    assert.equal(used.catalogueValue, "8.00");

    // Nothing has been recorded at *used*, so the ladder drops the condition axis before the area.
    const row = value.rows.find((r) => r.conditionId === usedConditionId);
    assert.ok(row);
    assert.equal(row.level, "area");
    assert.equal(row.bucketLabel, "Poland");
  });

  it("has nothing to say about a stamp with no catalogue value", async () => {
    await learnFortyPercent();
    const value = await getStampEstimatedValue(userId, unpricedStampId);
    assert.deepEqual(value.cells, []);
    assert.deepEqual(value.rows, []);
  });

  it("still answers at the fallback rung, labelled as policy rather than evidence", async () => {
    // No lots at all: nothing has been learned, so `bidFallbackPercent` answers.
    const value = await getStampEstimatedValue(userId, plainStampId);

    const mnh = value.cells.find((c) => c.conditionAbbreviation === "MNH");
    assert.ok(mnh);
    assert.equal(mnh.estimate, "30.00");

    const row = value.rows.find((r) => r.conditionId === conditionId);
    assert.ok(row);
    assert.equal(row.level, "fallback");
    assert.equal(row.ratio, 0.6);
    assert.equal(row.n, 0);
    assert.equal(row.bucketLabel, "No recorded results");
    // A policy percentage has no evidence to expand into.
    assert.deepEqual(row.lots, []);
  });

  describe("the catalogue rungs (#1828)", () => {
    it("learns from the catalogue's results when the area has none, and says so", async () => {
      await learnFortyPercentOf(await stampElsewhere("German", germanyAreaId, editionId));

      const value = await getStampEstimatedValue(userId, plainStampId);
      const row = value.rows.find((r) => r.conditionId === conditionId);
      assert.ok(row);
      assert.equal(row.level, "catalogue");
      assert.equal(row.ratio, 0.4);
      assert.equal(row.n, 3);
      assert.equal(row.bucketLabel, "Michel / Michel Europa results");
      assert.equal(value.cells.find((c) => c.conditionAbbreviation === "MNH")?.estimate, "20.00");
    });

    it("uses the manual factor with nothing recorded, and names it as the collector's", async () => {
      await setManualFactor("4");

      const value = await getStampEstimatedValue(userId, plainStampId);
      const row = value.rows.find((r) => r.conditionId === conditionId);
      assert.ok(row);
      assert.equal(row.level, "catalogue-factor");
      assert.equal(row.ratio, 0.25);
      assert.equal(row.n, 0);
      assert.equal(row.bucketLabel, "Michel / Michel Europa — your factor, catalogue ÷ 4");
      assert.deepEqual(row.lots, []);
      assert.equal(value.cells.find((c) => c.conditionAbbreviation === "MNH")?.estimate, "12.50");
    });

    it("puts the manual factor ahead of another catalogue's results", async () => {
      await learnFortyPercentOf(await stampElsewhere("Fischer-priced", fischerAreaId, fischerEditionId));

      // Without a factor the collection bucket — all Fischer — still answers, as it did before.
      const before = await getStampEstimatedValue(userId, plainStampId);
      assert.equal(before.rows.find((r) => r.conditionId === conditionId)?.level, "collection");

      await setManualFactor("10");
      const after = await getStampEstimatedValue(userId, plainStampId);
      const row = after.rows.find((r) => r.conditionId === conditionId);
      assert.equal(row?.level, "catalogue-factor");
      assert.equal(row?.ratio, 0.1);
    });

    it("reports each catalogue's learned factor with its n, for the settings", async () => {
      await learnFortyPercentOf(await stampElsewhere("German", germanyAreaId, editionId));

      const learned = await readLearnedCatalogueFactors(collectionId);
      const michel = learned.get(catalogNameId);
      assert.ok(michel);
      assert.equal(michel.n, 3);
      assert.ok(michel.factor !== null && Math.abs(michel.factor - 2.5) < 1e-9);
      // A catalogue nothing was recorded against says so rather than inventing a figure.
      const others = [...learned].filter(([id]) => id !== catalogNameId);
      assert.ok(others.every(([, f]) => f.factor === null && f.n === 0));
    });
  });

  it("sums a checklist's members per key, counting only the ones it estimated", async () => {
    const saleId = await learnFortyPercent();
    // The common stamp's MNH key is measured now, so the set total leaves it out here — it is
    // counted by the Market value total instead.
    await lot(saleId, commonStampId, "4.00");

    const checklist = await prisma.checklist.create({
      data: {
        collectionId,
        issueId,
        name: "Complete set",
        stamps: {
          create: [
            { stampId: plainStampId },
            { stampId: commonStampId },
            { stampId: unpricedStampId },
          ],
        },
      },
    });

    try {
      const set = await getChecklistEstimatedValue(userId, collectionId, checklist.id);
      assert.equal(set.checklistName, "Complete set");
      assert.equal(set.requiredCount, 3);

      const mnh = set.cells.find((c) => c.conditionAbbreviation === "MNH");
      assert.ok(mnh);
      // Only the plain stamp: the common one is measured and the unpriced one has nothing to
      // multiply.
      assert.equal(mnh.estimate, "20.00");
      assert.equal(mnh.stampCount, 1);

      // A set does not expand — its evidence is every bucket of every member.
      assert.ok(set.rows.every((r) => r.lots.length === 0));
    } finally {
      await prisma.checklist.delete({ where: { id: checklist.id } });
    }
  });
});
