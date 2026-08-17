import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import {
  valuateCopy,
  aggregateHoldings,
  aggregateMarketHoldings,
  type CopyValuation,
} from "../../src/lib/valuation";

// `RawCatalogPrice.price` is a Prisma Decimal; the code only ever calls Number() on it,
// so a plain number stands in fine at runtime. Cast to satisfy the type in tests.
const D = (n: number): Decimal => n as unknown as Decimal;

const MICHEL = "cat-michel";
const SCOTT = "cat-scott";
const MNH = "cond-mnh";
const USED = "cond-used";
const CERT = "cert-guarantee";

/** One descendant variant's prices, tagged with the variant they belong to (#616). The stamp id is
 *  what a rolled-up valuation reports back as `sourceStampId`. */
function variant(stampId: string, ...prices: RawCatalogPrice[]) {
  return { stampId, prices };
}

function price(
  amount: number,
  opts: {
    currency?: string;
    conditionId?: string;
    certificateStatusId?: string | null;
    formatId?: string | null;
    year?: number;
    catalogNameId?: string;
  } = {}
): RawCatalogPrice {
  return {
    price: D(amount),
    currency: opts.currency ?? "EUR",
    conditionId: opts.conditionId ?? MNH,
    certificateStatusId: opts.certificateStatusId ?? null,
    formatId: opts.formatId ?? null,
    catalogEdition: {
      year: opts.year ?? 2024,
      catalogNameId: opts.catalogNameId ?? MICHEL,
    },
  };
}

const noRates = new Map<string, number | null>();

describe("valuateCopy — identified copy", () => {
  it("uses the variant's own price at the copy's condition/cert", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50)],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "50.00");
    assert.equal(v.currency, "EUR");
    assert.equal(v.baseAmount, 50);
    assert.equal(v.uncertain, false);
    assert.equal(v.unpriced, false);
  });

  it("is unpriced when no price matches the condition", () => {
    const v = valuateCopy({
      conditionId: USED,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50, { conditionId: MNH })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
    assert.equal(v.amount, null);
    assert.equal(v.baseAmount, null);
  });

  it("matches certificate status exactly — no fall-back to cert=none", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: CERT,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50, { certificateStatusId: null })], // only a no-cert price exists
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
  });

  it("picks the certificate-specific price when present", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: CERT,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50, { certificateStatusId: null }), price(80, { certificateStatusId: CERT })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "80.00");
  });

  it("prefers the latest edition of the primary catalog", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(40, { year: 2022 }), price(55, { year: 2024 }), price(48, { year: 2023 })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "55.00");
  });

  it("ignores prices from other catalog names", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(99, { catalogNameId: SCOTT })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
  });

  it("is unpriced when the stamp's area has no primary catalog", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: null,
      ownPrices: [price(50)],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
  });
});

describe("valuateCopy — unknown variant", () => {
  it("uses the base stamp's own price when it has one, flagged uncertain", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(30)],
      variantPrices: [variant("v-a", price(10)), variant("v-b", price(20))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "30.00");
    assert.equal(v.uncertain, true);
    assert.equal(v.unpriced, false);
    // The umbrella's own price, so no variant is named (#616) — which is what makes the listing
    // side keep an item-ID recorded on the umbrella itself.
    assert.equal(v.sourceStampId, null);
  });

  it("falls back to the lowest descendant-variant price when the base is unpriced", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [], // base stamp has no price of its own
      variantPrices: [variant("v-a", price(25)), variant("v-b", price(12)), variant("v-c", price(40))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "12.00");
    assert.equal(v.uncertain, true);
    // …and it names which variant that was (#616).
    assert.equal(v.sourceStampId, "v-b");
  });

  // #617 — the coverage of the rollup, beside its figure. The figure stays the lowest of what is
  // priced; this is what tells a *listing* that the cheapest variant is not actually known yet.
  it("reports which identified variants carry no price at this key", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [variant("v-a", price(25)), variant("v-b"), variant("v-c", price(40))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    // The estimate is unchanged and still marked uncertain — only a sale may not rest on it.
    assert.equal(v.amount, "25.00");
    assert.equal(v.uncertain, true);
    assert.deepEqual(v.unpricedVariantIds, ["v-b"]);
  });

  it("expects no price of an intermediate node — its value is the lowest of its own children", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [
        // `v-a` is itself an umbrella (309A over 309AP…), so it is still underspecified and a catalog
        // prices it through its children rather than directly.
        { ...variant("v-a"), identified: false },
        variant("v-a-1", price(25)),
        variant("v-b", price(40)),
      ],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.deepEqual(v.unpricedVariantIds, []);
    assert.equal(v.sourceStampId, "v-a-1");
  });

  it("reports nothing where the umbrella's own price won — nothing was rolled up", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(30)],
      variantPrices: [variant("v-a"), variant("v-b", price(20))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.deepEqual(v.unpricedVariantIds, []);
  });

  it("compares descendant prices in base currency, not nominal amount", () => {
    // 100 PLN ≈ 25 EUR (rate 0.25) is cheaper than 30 EUR nominal.
    const rates = new Map<string, number | null>([["PLN", 0.25]]);
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [
        variant("v-a", price(30, { currency: "EUR" })),
        variant("v-b", price(100, { currency: "PLN" })),
      ],
      baseCurrency: "EUR",
      rates,
    });
    assert.equal(v.currency, "PLN");
    assert.equal(v.amount, "100.00");
    assert.equal(v.baseAmount, 25);
    assert.equal(v.sourceStampId, "v-b");
  });

  it("considers each descendant's own headline (latest edition) price", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [
        variant("v-a", price(18, { year: 2022 }), price(22, { year: 2024 })), // latest = 22
        variant("v-b", price(19, { year: 2024 })),
      ],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "19.00");
  });

  it("is unpriced (still uncertain) when no descendant has a matching price", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [variant("v-a", price(10, { conditionId: USED }))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
    assert.equal(v.uncertain, true);
    assert.equal(v.sourceStampId, null);
  });
});

describe("valuateCopy — currency conversion", () => {
  it("returns the amount but null base value when the currency has no rate", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(70, { currency: "USD" })],
      baseCurrency: "EUR",
      rates: new Map([["USD", null]]),
    });
    assert.equal(v.amount, "70.00");
    assert.equal(v.currency, "USD");
    assert.equal(v.baseAmount, null);
    assert.equal(v.baseAmountDisplay, null);
    assert.equal(v.unpriced, false);
  });

  it("converts a non-base currency using the rate map", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(40, { currency: "USD" })],
      baseCurrency: "EUR",
      rates: new Map([["USD", 0.9]]),
    });
    assert.equal(v.baseAmount, 36);
    assert.equal(v.baseAmountDisplay, "36.00");
  });
});

describe("aggregateHoldings", () => {
  const certain = (baseAmount: number | null, unpriced = false): CopyValuation => ({
    amount: unpriced ? null : "0.00",
    currency: unpriced ? null : "EUR",
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    uncertain: false,
    unpriced,
    sourceStampId: null,
    unpricedVariantIds: [],
  });
  const uncertain = (baseAmount: number): CopyValuation => ({
    ...certain(baseAmount),
    uncertain: true,
  });

  it("sums convertible values and breaks down the counts", () => {
    const total = aggregateHoldings(
      [
        certain(50),
        uncertain(20),
        certain(null, true), // unpriced
        { ...certain(null), unpriced: false }, // priced but unconvertible (baseAmount null)
      ],
      "EUR"
    );
    assert.equal(total.totalBaseAmount, "70.00");
    assert.equal(total.pricedCount, 2);
    assert.equal(total.unpricedCount, 1);
    assert.equal(total.unconvertibleCount, 1);
    assert.equal(total.uncertainCount, 1);
    assert.equal(total.uncertainBaseAmount, "20.00");
    assert.equal(total.baseCurrency, "EUR");
  });

  it("returns zeros for an empty holdings set", () => {
    const total = aggregateHoldings([], "USD");
    assert.equal(total.totalBaseAmount, "0.00");
    assert.equal(total.pricedCount, 0);
    assert.equal(total.uncertainBaseAmount, "0.00");
    assert.equal(total.baseCurrency, "USD");
  });
});

// The market total over the same held copies (#458; ADR-0022 §8). The one thing it must never do
// is let a partial total read as a complete one, which is what the coverage counts are for.
describe("aggregateMarketHoldings", () => {
  it("sums the medians and counts what had no evidence", () => {
    const total = aggregateMarketHoldings([40, null, 12.5, null, null], "EUR");
    assert.equal(total.totalBaseAmount, "52.50");
    assert.equal(total.valuedCount, 2);
    assert.equal(total.noEvidenceCount, 3);
    assert.equal(total.baseCurrency, "EUR");
  });

  it("counts a copy with no evidence rather than valuing it at zero", () => {
    const total = aggregateMarketHoldings([null, null], "EUR");
    assert.equal(total.totalBaseAmount, "0.00");
    assert.equal(total.valuedCount, 0);
    // The distinction the whole figure rests on: nothing recorded is not "worth nothing", and a
    // reader has to be able to tell the two apart from the counts alone.
    assert.equal(total.noEvidenceCount, 2);
  });

  it("reports full coverage when every copy's key had results", () => {
    const total = aggregateMarketHoldings([10, 20, 30], "PLN");
    assert.equal(total.totalBaseAmount, "60.00");
    assert.equal(total.valuedCount, 3);
    assert.equal(total.noEvidenceCount, 0);
    assert.equal(total.baseCurrency, "PLN");
  });

  it("returns zeros for an empty copy set", () => {
    const total = aggregateMarketHoldings([], "USD");
    assert.equal(total.totalBaseAmount, "0.00");
    assert.equal(total.valuedCount, 0);
    assert.equal(total.noEvidenceCount, 0);
    assert.equal(total.baseCurrency, "USD");
  });

  it("carries a zero median as evidence, not as an absence", () => {
    // A lot really can close at nothing, and that result is as much a datapoint as any other.
    const total = aggregateMarketHoldings([0, 15], "EUR");
    assert.equal(total.totalBaseAmount, "15.00");
    assert.equal(total.valuedCount, 2);
    assert.equal(total.noEvidenceCount, 0);
  });
});

// A copy that is a multiple is valued as that multiple (#343): explicit price first, else the
// single's scaled by the format's multiplier, else unpriced. Never the single's own figure —
// that is a different stamp's price.
const BLK4 = "fmt-blk4";

describe("valuateCopy — physical format (#343)", () => {
  it("prefers an explicit price recorded for the copy's format", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      formatId: BLK4,
      formatFactor: 4.5,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50), price(180, { formatId: BLK4 })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "180.00");
    assert.equal(v.unpriced, false);
  });

  it("derives from the single's price when the format has none of its own", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      formatId: BLK4,
      formatFactor: 4.5,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50)],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "225.00");
    assert.equal(v.currency, "EUR");
  });

  it("is unpriced when no multiplier applies, rather than falling back to the single", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      formatId: BLK4,
      formatFactor: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50)],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
    assert.equal(v.amount, null);
  });

  it("values a single from the single's price, ignoring any format rows", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      formatId: null,
      unknownVariant: false,
      primaryCatalogNameId: MICHEL,
      ownPrices: [price(50), price(180, { formatId: BLK4 })],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "50.00");
  });

  it("scales the lowest variant's price for an unknown-variant multiple", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      formatId: BLK4,
      formatFactor: 4,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [variant("v-a", price(30)), variant("v-b", price(10)), variant("v-c", price(20))],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "40.00");
    assert.equal(v.uncertain, true);
    // The scaled figure still names the variant it was scaled from.
    assert.equal(v.sourceStampId, "v-b");
  });
});
