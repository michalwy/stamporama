import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../src/generated/prisma/client";
import {
  wantCatalogRange,
  type WantValuationDictionaries,
  type WantValuationStamp,
} from "../../src/lib/want-valuation";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import type { WantAcceptance } from "../../src/lib/want-rules";

const CATALOG = "cat-michel";
const U = "cond-used";
const MNH = "cond-mnh";
const CERT = "cert-photo";
const BLOCK4 = "fmt-block4";

const DICTIONARIES: WantValuationDictionaries = {
  conditionIds: [U, MNH],
  certificateStatusIds: [null, CERT],
  formatIds: [null, BLOCK4],
};

const price = (
  amount: string,
  conditionId: string,
  over: Partial<RawCatalogPrice> = {}
): RawCatalogPrice => ({
  price: new Prisma.Decimal(amount),
  currency: "EUR",
  conditionId,
  certificateStatusId: null,
  formatId: null,
  catalogEdition: { year: 2024, catalogNameId: CATALOG },
  ...over,
});

const stamp = (over: Partial<WantValuationStamp> = {}): WantValuationStamp => ({
  unknownVariant: false,
  primaryCatalogNameId: CATALOG,
  ownPrices: [],
  variantPrices: [],
  ...over,
});

const want = (over: Partial<WantAcceptance> = {}): WantAcceptance => ({
  stampId: "stamp-1",
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
  ...over,
});

const NO_RATES = new Map<string, number | null>();
const NO_FACTOR = () => null;

describe("wantCatalogRange", () => {
  it("ranges from the cheapest accepted combination to the dearest", () => {
    const range = wantCatalogRange(
      want(),
      stamp({ ownPrices: [price("1.50", U), price("40.00", MNH)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    assert.equal(range?.minBase, "1.50");
    assert.equal(range?.maxBase, "40.00");
  });

  it("narrows with the want — a mint-only want does not quote the used price", () => {
    const range = wantCatalogRange(
      want({ conditionIds: [MNH] }),
      stamp({ ownPrices: [price("1.50", U), price("40.00", MNH)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    assert.equal(range?.minBase, "40.00");
    assert.equal(range?.maxBase, "40.00");
  });

  it("counts every accepted combination, priced or not", () => {
    const range = wantCatalogRange(
      want(),
      stamp({ ownPrices: [price("1.50", U)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    // 2 conditions × 2 certificate values × 2 formats, of which only the used single is priced.
    assert.equal(range?.totalCombinations, 8);
    assert.equal(range?.pricedCombinations, 1);
  });

  it("is null when nothing the want accepts carries a price", () => {
    assert.equal(
      wantCatalogRange(want(), stamp(), DICTIONARIES, "EUR", NO_RATES, NO_FACTOR),
      null
    );
  });

  it("an unpriced combination is not a zero — it must not drag the range down", () => {
    const range = wantCatalogRange(
      want(),
      stamp({ ownPrices: [price("40.00", MNH)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    assert.equal(range?.minBase, "40.00");
  });

  it("keeps the certificate axis exact — a null price row is not a certified one", () => {
    const certOnly = wantCatalogRange(
      want({ certificateStatusIds: [CERT] }),
      stamp({ ownPrices: [price("40.00", MNH)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    assert.equal(certOnly, null, "an uncertified price answered a want for a certified copy");
  });

  it("marks a format-derived figure as an estimate, and an explicit one as not", () => {
    const derived = wantCatalogRange(
      want({ conditionIds: [MNH], certificateStatusIds: [null], formatIds: [BLOCK4] }),
      stamp({ ownPrices: [price("10.00", MNH)] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      (formatId) => (formatId === BLOCK4 ? 4 : null)
    );
    assert.equal(derived?.minBase, "40.00");
    assert.equal(derived?.estimated, true);

    const explicit = wantCatalogRange(
      want({ conditionIds: [MNH], certificateStatusIds: [null], formatIds: [BLOCK4] }),
      stamp({ ownPrices: [price("38.00", MNH, { formatId: BLOCK4 })] }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      (formatId) => (formatId === BLOCK4 ? 4 : null)
    );
    assert.equal(explicit?.minBase, "38.00");
    assert.equal(explicit?.estimated, false, "a recorded block price is not an estimate");
  });

  it("marks an unknown-variant want as an estimate, priced off its cheapest variant", () => {
    const range = wantCatalogRange(
      want({ conditionIds: [MNH], certificateStatusIds: [null], formatIds: [null] }),
      stamp({
        unknownVariant: true,
        variantPrices: [
          { stampId: "v-a", prices: [price("30.00", MNH)] },
          { stampId: "v-b", prices: [price("12.00", MNH)] },
        ],
      }),
      DICTIONARIES,
      "EUR",
      NO_RATES,
      NO_FACTOR
    );
    assert.equal(range?.minBase, "12.00");
    assert.equal(range?.estimated, true);
  });

  it("converts to the base currency, and drops what it cannot convert", () => {
    const rates = new Map<string, number | null>([
      ["PLN", 0.25],
      ["GBP", null],
    ]);
    const range = wantCatalogRange(
      want({ certificateStatusIds: [null], formatIds: [null] }),
      stamp({
        ownPrices: [
          price("40.00", U, { currency: "PLN" }),
          price("100.00", MNH, { currency: "GBP" }),
        ],
      }),
      DICTIONARIES,
      "EUR",
      rates,
      NO_FACTOR
    );
    // 40 PLN → 10 EUR; the unconvertible GBP row is counted as unpriced rather than guessed at.
    assert.equal(range?.minBase, "10.00");
    assert.equal(range?.maxBase, "10.00");
    assert.equal(range?.pricedCombinations, 1);
    assert.equal(range?.totalCombinations, 2);
  });
});
