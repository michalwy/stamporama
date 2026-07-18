import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import {
  valuateCopy,
  aggregateHoldings,
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

function price(
  amount: number,
  opts: {
    currency?: string;
    conditionId?: string;
    certificateStatusId?: string | null;
    year?: number;
    catalogNameId?: string;
  } = {}
): RawCatalogPrice {
  return {
    price: D(amount),
    currency: opts.currency ?? "EUR",
    conditionId: opts.conditionId ?? MNH,
    certificateStatusId: opts.certificateStatusId ?? null,
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
      variantPrices: [[price(10)], [price(20)]],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "30.00");
    assert.equal(v.uncertain, true);
    assert.equal(v.unpriced, false);
  });

  it("falls back to the lowest descendant-variant price when the base is unpriced", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [], // base stamp has no price of its own
      variantPrices: [[price(25)], [price(12)], [price(40)]],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.amount, "12.00");
    assert.equal(v.uncertain, true);
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
      variantPrices: [[price(30, { currency: "EUR" })], [price(100, { currency: "PLN" })]],
      baseCurrency: "EUR",
      rates,
    });
    assert.equal(v.currency, "PLN");
    assert.equal(v.amount, "100.00");
    assert.equal(v.baseAmount, 25);
  });

  it("considers each descendant's own headline (latest edition) price", () => {
    const v = valuateCopy({
      conditionId: MNH,
      certificateStatusId: null,
      unknownVariant: true,
      primaryCatalogNameId: MICHEL,
      ownPrices: [],
      variantPrices: [
        [price(18, { year: 2022 }), price(22, { year: 2024 })], // latest = 22
        [price(19, { year: 2024 })],
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
      variantPrices: [[price(10, { conditionId: USED })]],
      baseCurrency: "EUR",
      rates: noRates,
    });
    assert.equal(v.unpriced, true);
    assert.equal(v.uncertain, true);
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
