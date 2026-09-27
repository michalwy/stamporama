import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foldChecklistPrices, type ChecklistPricePick } from "../../src/lib/catalog-price";

// A checklist's catalogue value from its stamps' picked prices (#1416). The edition rule is the issue
// list's; the currency rule is new — a checklist spanning issues may reach areas led by catalogues in
// different currencies, and their amounts cannot be added as they stand.

const pick = (amount: number, currency: string, extra: Partial<ChecklistPricePick> = {}) => ({
  amount,
  currency,
  older: false,
  estimated: false,
  derived: false,
  ...extra,
});

const RATES = new Map<string, number | null>([
  ["EUR", 4.25],
  ["USD", 4],
  ["CHF", null],
]);

describe("foldChecklistPrices", () => {
  it("sums one currency as it stands and converts beside it", () => {
    const total = foldChecklistPrices([pick(10, "EUR"), pick(2.5, "EUR")], 3, "PLN", RATES);
    assert.equal(total?.amount, "12.50");
    assert.equal(total?.currency, "EUR");
    assert.equal(total?.convertedAmount, "53.13");
    assert.equal(total?.pricedCount, 2);
    assert.equal(total?.requiredCount, 3);
  });

  it("states several currencies in the base currency, each converted", () => {
    const total = foldChecklistPrices([pick(10, "EUR"), pick(20, "PLN")], 2, "PLN", RATES);
    assert.equal(total?.currency, "PLN");
    assert.equal(total?.amount, "62.50");
    assert.equal(total?.convertedAmount, null);
    assert.equal(total?.pricedCount, 2);
  });

  it("leaves out a price it has no rate for, rather than adding it in the wrong unit", () => {
    const total = foldChecklistPrices(
      [pick(10, "EUR"), pick(5, "CHF"), pick(1, "USD")],
      3,
      "PLN",
      RATES
    );
    assert.equal(total?.amount, "46.50");
    assert.equal(total?.pricedCount, 2);
  });

  it("counts only current-edition prices when there are any, and says how many it left out", () => {
    const total = foldChecklistPrices(
      [pick(10, "EUR"), pick(99, "EUR", { older: true }), pick(1, "EUR", { estimated: true })],
      3,
      "EUR",
      RATES
    );
    assert.equal(total?.amount, "11.00");
    assert.equal(total?.usesOlderEdition, false);
    assert.equal(total?.olderEditionExcludedCount, 1);
    assert.equal(total?.estimatedCount, 1);
  });

  it("falls back to older-edition prices when nothing is current", () => {
    const total = foldChecklistPrices(
      [pick(3, "EUR", { older: true, derived: true }), pick(4, "EUR", { older: true })],
      2,
      "EUR",
      RATES
    );
    assert.equal(total?.amount, "7.00");
    assert.equal(total?.usesOlderEdition, true);
    assert.equal(total?.olderEditionExcludedCount, 0);
    assert.equal(total?.derivedCount, 1);
  });

  it("is null with nothing priced", () => {
    assert.equal(foldChecklistPrices([], 4, "PLN", RATES), null);
  });

  it("still totals one currency it has no rate for, only unconverted", () => {
    const total = foldChecklistPrices([pick(5, "CHF"), pick(2, "CHF")], 2, "PLN", RATES);
    assert.equal(total?.currency, "CHF");
    assert.equal(total?.amount, "7.00");
    assert.equal(total?.convertedAmount, null);
  });
});
