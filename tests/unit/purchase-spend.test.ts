import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePurchaseSpend } from "../../src/lib/purchase-spend";

// What an order or a lot cost, in both currencies (#852). The arithmetic is one multiplication and
// one apportionment, and both of the things that can go wrong with it are silent:
//
//  - a breakdown that does not add up to its own total, because each part was converted on its own
//    and each rounding went its own way;
//  - a base-currency figure invented for an order that has no exchange rate.
//
// Both are exercised here on numbers chosen so a wrong implementation differs, rather than on
// round figures where every implementation agrees.

describe("resolvePurchaseSpend", () => {
  it("states the total, price and shipping in the transaction currency", () => {
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 120,
      shippingTx: 14.5,
      currency: "PLN",
      baseCurrency: "EUR",
      fxRateToBase: 0.23,
      lines: { lots: 3, expenses: 1 },
    });
    assert.equal(spend.tx.currency, "PLN");
    assert.equal(spend.tx.price, "120.00");
    assert.equal(spend.tx.shipping, "14.50");
    assert.equal(spend.tx.total, "134.50");
    assert.deepEqual(spend.lines, { lots: 3, expenses: 1 });
    assert.equal(spend.scope, "order");
  });

  it("converts the total at the frozen rate", () => {
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 120,
      shippingTx: 14.5,
      currency: "PLN",
      baseCurrency: "EUR",
      fxRateToBase: 0.23,
    });
    assert.equal(spend.base?.currency, "EUR");
    // 134.50 × 0.23 = 30.935 → 30.94, the same round-the-whole the lot pool conversion does.
    assert.equal(spend.base?.total, "30.94");
  });

  it("apportions the base breakdown out of the base total, so the parts sum to it exactly", () => {
    // Both halves land on a half-cent: converted separately each rounds up to 5.03 and the
    // breakdown reads 10.06 against a total of 10.05. The apportionment gives the odd cent to one
    // of them instead, which is the only answer that reconciles.
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 10.05,
      shippingTx: 10.05,
      currency: "PLN",
      baseCurrency: "EUR",
      fxRateToBase: 0.5,
    });
    assert.equal(spend.tx.total, "20.10");
    assert.equal(spend.base?.total, "10.05");
    assert.equal(spend.base?.price, "5.03");
    assert.equal(spend.base?.shipping, "5.02");
    // In cents, the unit these are stored in: adding two 2-dp strings back as floats would
    // reintroduce exactly the drift being asserted away.
    const cents = (amount: string) => Math.round(Number(amount) * 100);
    assert.equal(
      cents(spend.base!.price) + cents(spend.base!.shipping),
      cents(spend.base!.total)
    );
  });

  it("has no base figures at all when the order is foreign and carries no rate", () => {
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 120,
      shippingTx: 14.5,
      currency: "PLN",
      baseCurrency: "EUR",
      fxRateToBase: null,
    });
    // Absent, never partial: the transaction figures are exact and complete, and there is simply
    // no conversion to state. Nothing is dropped from the sum, because a purchase has one currency.
    assert.equal(spend.base, null);
    assert.equal(spend.tx.total, "134.50");
    assert.equal(spend.baseCurrency, "EUR");
  });

  it("mirrors the transaction figures when the order is already in the base currency", () => {
    // `fxRateToBase` is deliberately null in this case too, so the null rate alone cannot be what
    // decides whether a conversion exists.
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 120,
      shippingTx: 14.5,
      currency: "EUR",
      baseCurrency: "EUR",
      fxRateToBase: null,
    });
    assert.deepEqual(spend.base, {
      currency: "EUR",
      total: "134.50",
      price: "120.00",
      shipping: "14.50",
    });
  });

  it("names the whole shipping charge a lot's share came out of", () => {
    const spend = resolvePurchaseSpend({
      scope: "lot",
      priceTx: 60,
      shippingTx: 7.25,
      currency: "EUR",
      baseCurrency: "EUR",
      fxRateToBase: null,
      shippingShareOf: 14.5,
    });
    assert.equal(spend.scope, "lot");
    assert.equal(spend.tx.total, "67.25");
    assert.equal(spend.shippingShareOf, "14.50");
    assert.equal(spend.lines, null);
  });

  it("names no whole charge when the order had no shipping at all", () => {
    const spend = resolvePurchaseSpend({
      scope: "lot",
      priceTx: 60,
      shippingTx: 0,
      currency: "EUR",
      baseCurrency: "EUR",
      fxRateToBase: null,
      shippingShareOf: 0,
    });
    assert.equal(spend.shippingShareOf, null);
    assert.equal(spend.tx.shipping, "0.00");
    assert.equal(spend.tx.total, "60.00");
  });

  it("survives a free order, where the apportionment has no weight to split by", () => {
    // A trade's incoming half can carry nothing at all (#644). Zero must yield zeroes rather than
    // the "positive total with zero weight base" the apportionment throws on.
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: 0,
      shippingTx: 0,
      currency: "EUR",
      baseCurrency: "EUR",
      fxRateToBase: null,
    });
    assert.equal(spend.tx.total, "0.00");
    assert.deepEqual(spend.base, {
      currency: "EUR",
      total: "0.00",
      price: "0.00",
      shipping: "0.00",
    });
  });
});
