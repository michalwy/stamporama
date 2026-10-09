import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contactPeriodRange,
  isContactPeriod,
  NOT_DELIVERED_PURCHASE_STATUSES,
  sumMoney,
  toBaseAmount,
  UNPAID_SALE_STATUSES,
  UNSENT_SALE_STATUSES,
} from "../../src/lib/contact-page-rules";

// A contact's page (#1708): the period switch and the money totals its figures are stated in.

describe("contactPeriodRange", () => {
  it("is open at both ends for all time", () => {
    assert.deepEqual(contactPeriodRange("all", "2026-10-09"), { from: null, to: null });
  });

  it("starts this year on 1 January and ends today", () => {
    assert.deepEqual(contactPeriodRange("year", "2026-10-09"), { from: "2026-01-01", to: "2026-10-09" });
  });

  it("covers the last twelve months up to and including today", () => {
    assert.deepEqual(contactPeriodRange("12m", "2026-10-09"), { from: "2025-10-10", to: "2026-10-09" });
    assert.deepEqual(contactPeriodRange("12m", "2026-01-01"), { from: "2025-01-02", to: "2026-01-01" });
    assert.deepEqual(contactPeriodRange("12m", "2026-12-31"), { from: "2026-01-01", to: "2026-12-31" });
  });

  it("starts the twelve months to 29 February on 1 March", () => {
    assert.deepEqual(contactPeriodRange("12m", "2028-02-29"), { from: "2027-03-01", to: "2028-02-29" });
  });
});

describe("isContactPeriod", () => {
  it("accepts the three periods and nothing else", () => {
    for (const p of ["year", "12m", "all"]) assert.equal(isContactPeriod(p), true);
    for (const p of ["month", "", null, undefined]) assert.equal(isContactPeriod(p), false);
  });
});

describe("sumMoney", () => {
  it("sums the base currency, with nothing beside it when everything is in the base currency", () => {
    const total = sumMoney(
      [
        { amount: 10.1, currency: "EUR", base: 10.1 },
        { amount: 0.2, currency: "EUR", base: 0.2 },
      ],
      "EUR"
    );
    assert.deepEqual(total, { baseCurrency: "EUR", base: "10.30", unconvertedCount: 0, tx: null });
  });

  it("states the transaction currency beside the base where every entry shares one", () => {
    const total = sumMoney(
      [
        { amount: 100, currency: "PLN", base: 23.5 },
        { amount: 50, currency: "PLN", base: 11.75 },
      ],
      "EUR"
    );
    assert.deepEqual(total.tx, { currency: "PLN", total: "150.00" });
    assert.equal(total.base, "35.25");
  });

  it("states no transaction total across two currencies", () => {
    const total = sumMoney(
      [
        { amount: 100, currency: "PLN", base: 23.5 },
        { amount: 5, currency: "EUR", base: 5 },
      ],
      "EUR"
    );
    assert.equal(total.tx, null);
    assert.equal(total.base, "28.50");
  });

  it("states no base total at all when any entry cannot be converted, and says how many", () => {
    const total = sumMoney(
      [
        { amount: 100, currency: "USD", base: null },
        { amount: 40, currency: "USD", base: 36 },
      ],
      "EUR"
    );
    assert.equal(total.base, null);
    assert.equal(total.unconvertedCount, 1);
    assert.deepEqual(total.tx, { currency: "USD", total: "140.00" });
  });

  it("is zero over nothing", () => {
    assert.deepEqual(sumMoney([], "EUR"), { baseCurrency: "EUR", base: "0.00", unconvertedCount: 0, tx: null });
  });
});

describe("toBaseAmount", () => {
  it("is the amount itself in the base currency, rate or none", () => {
    assert.equal(toBaseAmount(12.5, "EUR", "EUR", null), 12.5);
  });

  it("converts at the recorded rate, to the cent", () => {
    assert.equal(toBaseAmount(10, "GBP", "EUR", 1.16667), 11.67);
  });

  it("has no figure for a foreign currency with no rate", () => {
    assert.equal(toBaseAmount(10, "GBP", "EUR", null), null);
  });
});

describe("the status sets the figures and their links share", () => {
  it("counts a purchase as not yet delivered while it is preparing or in transit", () => {
    assert.deepEqual([...NOT_DELIVERED_PURCHASE_STATUSES], ["preparing", "in_transit"]);
  });

  it("counts a sale as unpaid while ordered, and unsent until it is sent", () => {
    assert.deepEqual([...UNPAID_SALE_STATUSES], ["ordered"]);
    assert.deepEqual([...UNSENT_SALE_STATUSES], ["ordered", "paid", "packed"]);
  });
});
