import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getStampMarketValue, getStampMarketValues } from "../../src/lib/market-values";

// Market valuation from recorded auction results (#456; ADR-0022 §7).
//
// The arithmetic is unit-tested in `market-value.test.ts`; what earns a real database here is
// everything the pure module is *given* — that only closed, priced lots of this collection are
// read, that a mixed lot's pro-rata split weighs against the lines pointing at other stamps too,
// and that the catalogue values behind the split and the realization ratio are the copy
// valuation's own (unknown-variant rollup #238, format pricing ADR-0020) rather than a second
// derivation.
//
// The collection's base currency and every sale's are EUR unless a test says otherwise, so no
// exchange rate is fetched: the conversion path has its own coverage in `exchange-rates.test.ts`,
// and a network call in here would make the suite fail offline. The one foreign-currency case uses
// a rate frozen on the lot by hand, which is exactly what closing a lot writes (#354).

describe("market valuation (#456)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let conditionId: string;
  let usedConditionId: string;
  let attestId: string;
  let pairFormatId: string;
  let editionId: string;
  let areaId: string;
  let issueId: string;
  let variantSubtypeId: string;

  /** Priced 50.00 at MNH. */
  let plainStampId: string;
  /** Priced 10.00 at MNH — the cheap half of the mixed lots. */
  let commonStampId: string;
  /** No catalogue price at all. */
  let unpricedStampId: string;

  let lotSeq = 0;

  async function price(
    stampId: string,
    conditionIdArg: string,
    amount: string,
    formatId: string | null = null,
    certificateStatusId: string | null = null
  ) {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: editionId,
        conditionId: conditionIdArg,
        certificateStatusId,
        formatId,
        price: amount,
        currency: "EUR",
      },
    });
  }

  async function stamp(name: string, parentId?: string, subtypeId?: string): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name, parentId, subtypeId } });
    await prisma.stampCollectionArea.create({
      data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.issueMember.create({ data: { issueId, stampId: s.id } });
    return s.id;
  }

  async function sale(currency = "EUR"): Promise<string> {
    const row = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: `Sale ${++lotSeq}`, currency },
    });
    return row.id;
  }

  interface LotSpec {
    saleId: string;
    finalPrice: string | null;
    endsAt: Date;
    status?: string;
    fxRateToBase?: string;
    lines: {
      stampId: string;
      conditionId?: string;
      certificateStatusId?: string | null;
      formatId?: string | null;
      quantity?: number;
    }[];
  }

  async function lot(spec: LotSpec): Promise<string> {
    const row = await prisma.auctionLot.create({
      data: {
        auctionSaleId: spec.saleId,
        auctionLotNo: 9000 + ++lotSeq,
        lotNo: String(lotSeq),
        endsAt: spec.endsAt,
        status: spec.status ?? "closed",
        finalPrice: spec.finalPrice,
        fxRateToBase: spec.fxRateToBase ?? null,
        lines: {
          create: spec.lines.map((l) => ({
            stampId: l.stampId,
            conditionId: l.conditionId ?? conditionId,
            certificateStatusId: l.certificateStatusId ?? null,
            formatId: l.formatId ?? null,
            quantity: l.quantity ?? 1,
          })),
        },
      },
    });
    return row.id;
  }

  // Every test starts from no evidence. Cleared *before* each rather than after, so one failing
  // assertion cannot leave its lots behind and fail the next test for the wrong reason.
  beforeEach(async () => {
    await prisma.auctionLot.deleteMany({ where: { auctionSale: { collectionId } } });
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-market-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User market-${ts}`,
        email: `test-market-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-market-${ts}`,
        name: `Collection market-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
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
    attestId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Fotoattest", abbreviation: "FA", sortOrder: 0 },
      })
    ).id;
    pairFormatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "Pr", sortOrder: 0 },
      })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9101, collectionAreaId: areaId, name: "Definitives", year: 1950 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;

    plainStampId = await stamp("Plain");
    await price(plainStampId, conditionId, "50.00");
    commonStampId = await stamp("Common");
    await price(commonStampId, conditionId, "10.00");
    unpricedStampId = await stamp("Unpriced");

    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race its
    // own cascades — the stamps go one way and the lines the other.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("values a single-line lot per unit, with no catalogue price needed", async () => {
    const saleId = await sale();
    await lot({
      saleId,
      finalPrice: "120.00",
      endsAt: daysAgo(30),
      lines: [{ stampId: unpricedStampId, quantity: 3 }],
    });

    const [value] = await getStampMarketValue(userId, collectionId, unpricedStampId);
    assert.ok(value);
    assert.equal(value.median, "40.00");
    assert.equal(value.n, 1);
    assert.equal(value.splitCount, 0);
    // A single-line lot yields a datapoint whether or not the stamp is priced; the ratio is what
    // goes missing, not the value.
    assert.equal(value.catalogueValue, null);
    assert.equal(value.realizationRatio, null);
    assert.equal(value.baseCurrency, "EUR");
    assert.equal(value.lots.length, 1);
    assert.equal(value.lots[0].amount, "40.00");
    assert.equal(value.lots[0].finalPrice, "120.00");
    assert.equal(value.lots[0].split, false);
    assert.equal(value.lots[0].quantity, 3);

  });

  it("splits a mixed lot pro-rata by catalogue value and reports the ratio", async () => {
    const saleId = await sale();
    // 50 against 2 × 10: the plain stamp takes 50/70 of the hammer price.
    await lot({
      saleId,
      finalPrice: "140.00",
      endsAt: daysAgo(10),
      lines: [
        { stampId: plainStampId },
        { stampId: commonStampId, quantity: 2 },
      ],
    });

    const byStamp = await getStampMarketValues(userId, collectionId, [plainStampId, commonStampId]);
    const plain = byStamp.get(plainStampId)![0];
    assert.equal(plain.median, "100.00");
    assert.equal(plain.splitCount, 1);
    assert.equal(plain.catalogueValue, "50.00");
    assert.equal(plain.realizationRatio, 2);
    assert.equal(plain.lots[0].split, true);

    // 140 × 20/70 = 40, then ÷ 2 for the per-unit figure.
    const common = byStamp.get(commonStampId)![0];
    assert.equal(common.median, "20.00");
    assert.equal(common.realizationRatio, 2);

  });

  it("skips a mixed lot when one of its lines has no catalogue value", async () => {
    const saleId = await sale();
    await lot({
      saleId,
      finalPrice: "140.00",
      endsAt: daysAgo(10),
      lines: [{ stampId: plainStampId }, { stampId: unpricedStampId }],
    });

    // A partial split would silently hand the missing line's share to its neighbour, so the whole
    // lot is dropped — including for the stamp that *is* priced.
    assert.deepEqual(await getStampMarketValue(userId, collectionId, plainStampId), []);
    assert.deepEqual(await getStampMarketValue(userId, collectionId, unpricedStampId), []);

  });

  it("weighs the split against lines pointing at stamps nobody asked about", async () => {
    const saleId = await sale();
    await lot({
      saleId,
      finalPrice: "140.00",
      endsAt: daysAgo(10),
      lines: [{ stampId: plainStampId }, { stampId: commonStampId, quantity: 2 }],
    });

    // Asking only about the plain stamp must not turn its lot into a single-line one: the other
    // line is still two thirds of what the hammer price bought.
    const [value] = await getStampMarketValue(userId, collectionId, plainStampId);
    assert.equal(value.median, "100.00");
    assert.equal(value.lots.length, 1);

  });

  it("ignores open, cancelled and price-less lots, and other collections' lots", async () => {
    const saleId = await sale();
    await lot({
      saleId,
      finalPrice: "100.00",
      endsAt: daysAgo(5),
      status: "open",
      lines: [{ stampId: plainStampId }],
    });
    await lot({
      saleId,
      finalPrice: "100.00",
      endsAt: daysAgo(5),
      status: "cancelled",
      lines: [{ stampId: plainStampId }],
    });
    await lot({ saleId, finalPrice: null, endsAt: daysAgo(5), lines: [{ stampId: plainStampId }] });
    assert.deepEqual(await getStampMarketValue(userId, collectionId, plainStampId), []);

    // A second collection of the same owner: its lots are its own, and a stamp id from here finds
    // nothing there.
    const other = await prisma.collection.create({
      data: {
        slug: `col-market-other-${Date.now()}`,
        name: "Other",
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    await lot({ saleId, finalPrice: "100.00", endsAt: daysAgo(5), lines: [{ stampId: plainStampId }] });
    assert.deepEqual(await getStampMarketValue(userId, other.id, plainStampId), []);
    assert.equal((await getStampMarketValue(userId, collectionId, plainStampId)).length, 1);

    await prisma.collection.delete({ where: { id: other.id } });
  });

  it("refuses a collection the caller does not own", async () => {
    const strangerId = `test-user-market-stranger-${Date.now()}`;
    await prisma.user.create({
      data: {
        id: strangerId,
        name: "Stranger",
        email: `${strangerId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await assert.rejects(() => getStampMarketValue(strangerId, collectionId, plainStampId));
    await prisma.user.delete({ where: { id: strangerId } });
  });

  it("converts a foreign sale at the rate frozen on the lot", async () => {
    const saleId = await sale("PLN");
    await lot({
      saleId,
      finalPrice: "400.00",
      endsAt: daysAgo(20),
      fxRateToBase: "0.25",
      lines: [{ stampId: plainStampId }],
    });
    // A closed lot in a foreign currency with no frozen rate cannot be stated in the base one, so
    // it is not comparable with the ones that can and yields nothing.
    await lot({ saleId, finalPrice: "800.00", endsAt: daysAgo(19), lines: [{ stampId: plainStampId }] });

    const [value] = await getStampMarketValue(userId, collectionId, plainStampId);
    assert.equal(value.n, 1);
    assert.equal(value.median, "100.00");
    assert.equal(value.lots[0].saleCurrency, "PLN");
    assert.equal(value.lots[0].finalPrice, "100.00");

  });

  it("keeps condition, certificate and format apart, in the collector's own order", async () => {
    const saleId = await sale();
    await lot({ saleId, finalPrice: "60.00", endsAt: daysAgo(4), lines: [{ stampId: plainStampId }] });
    await lot({
      saleId,
      finalPrice: "20.00",
      endsAt: daysAgo(3),
      lines: [{ stampId: plainStampId, conditionId: usedConditionId }],
    });
    await lot({
      saleId,
      finalPrice: "200.00",
      endsAt: daysAgo(2),
      lines: [{ stampId: plainStampId, certificateStatusId: attestId }],
    });
    await lot({
      saleId,
      finalPrice: "150.00",
      endsAt: daysAgo(1),
      lines: [{ stampId: plainStampId, formatId: pairFormatId }],
    });

    const values = await getStampMarketValue(userId, collectionId, plainStampId);
    assert.equal(values.length, 4);
    // Condition first, then certificate, then format — the grid's own axes in the grid's own
    // order, each in the collector's configured sort order with the unmarked default ahead of it.
    // So every "no certificate" key comes before the Attest one, whatever format it is.
    assert.deepEqual(
      values.map((v) => [v.conditionAbbreviation, v.certificateStatusAbbreviation, v.formatAbbreviation]),
      [
        ["MNH", null, null],
        ["MNH", null, "Pr"],
        ["MNH", "FA", null],
        ["U", null, null],
      ]
    );
    // The Attest one has no catalogue price at that level — matching is exact, as it is for a copy.
    assert.equal(values[2].catalogueValue, null);

  });

  it("aggregates several results, newest evidence first, and scores the sample", async () => {
    const saleId = await sale();
    for (const [days, price] of [
      [400, "40.00"],
      [200, "80.00"],
      [100, "60.00"],
    ] as const) {
      await lot({ saleId, finalPrice: price, endsAt: daysAgo(days), lines: [{ stampId: plainStampId }] });
    }

    const [value] = await getStampMarketValue(userId, collectionId, plainStampId);
    assert.equal(value.n, 3);
    assert.equal(value.median, "60.00");
    assert.equal(value.mean, "60.00");
    assert.equal(value.min, "40.00");
    assert.equal(value.max, "80.00");
    assert.equal(value.realizationRatio, 1.2);
    // Three whole results inside a year, spread two thirds of the median:
    // 0.4×0.6 + 0.25×1 + 0.2×(1 − (40/60)/2) + 0.15×1 = 0.773.
    assert.equal(value.confidence.score, 77);
    assert.equal(value.confidence.badge, "high");
    assert.deepEqual(
      value.lots.map((l) => l.amount),
      ["60.00", "80.00", "40.00"]
    );

  });

  it("rolls an unknown-variant umbrella up from its cheapest child for the split and the ratio", async () => {
    const umbrellaId = await stamp("Umbrella");
    const variantA = await stamp("Umbrella A", umbrellaId, variantSubtypeId);
    const variantB = await stamp("Umbrella B", umbrellaId, variantSubtypeId);
    await price(variantA, conditionId, "30.00");
    await price(variantB, conditionId, "20.00");

    const saleId = await sale();
    // 20 (the cheapest child, #238) against the common stamp's 10: two thirds of 150.
    await lot({
      saleId,
      finalPrice: "150.00",
      endsAt: daysAgo(6),
      lines: [{ stampId: umbrellaId }, { stampId: commonStampId }],
    });

    const [value] = await getStampMarketValue(userId, collectionId, umbrellaId);
    assert.equal(value.median, "100.00");
    assert.equal(value.catalogueValue, "20.00");
    assert.equal(value.realizationRatio, 5);

  });
});
