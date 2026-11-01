import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeLotCoverage,
  lotPriceFor,
  postPriceTotals,
  statedPrice,
  typedAmount,
  type PostTotalsLot,
  type PriceDraft,
} from "../../src/lib/facebook-post-price-totals";

function lot(over: Partial<PostTotalsLot> & { id: string }): PostTotalsLot {
  return {
    listingType: "fixed",
    price: "0.00",
    startingPrice: null,
    currency: "PLN",
    catalogPrice: null,
    suggestedPrice: null,
    marketPrice: null,
    costPrice: null,
    ...over,
  };
}

const none: ReadonlyMap<string, PriceDraft> = new Map();
const column = (totals: ReturnType<typeof postPriceTotals>, key: string) =>
  totals.columns.find((c) => c.key === key)!;

describe("statedPrice", () => {
  it("is a quick buy's asking price, blank while it has none", () => {
    assert.equal(statedPrice(lot({ id: "a", price: "12.00" })), "12.00");
    assert.equal(statedPrice(lot({ id: "a" })), "");
  });

  it("is an auction's starting price", () => {
    assert.equal(statedPrice(lot({ id: "a", listingType: "auction", price: "30.00", startingPrice: "5.00" })), "5.00");
    assert.equal(statedPrice(lot({ id: "a", listingType: "auction", price: "30.00" })), "");
  });
});

describe("typedAmount", () => {
  it("reads a figure above zero to 2 dp, and nothing else", () => {
    assert.equal(typedAmount(" 12.5 "), "12.50");
    assert.equal(typedAmount(""), null);
    assert.equal(typedAmount("0"), null);
    assert.equal(typedAmount("abc"), null);
  });
});

describe("lotPriceFor", () => {
  const priced = lot({ id: "a", price: "10.00" });

  it("counts what is being typed over the saved figure", () => {
    assert.equal(lotPriceFor(priced, { text: "14", from: "10.00" }), "14.00");
  });

  it("drops a draft once the saved figure has moved on", () => {
    assert.equal(lotPriceFor(priced, { text: "14", from: "" }), "10.00");
  });

  it("counts a field typed empty as no price", () => {
    assert.equal(lotPriceFor(priced, { text: "", from: "10.00" }), null);
  });
});

describe("postPriceTotals", () => {
  it("sums the prices and weighs them against each total, in a row's signs", () => {
    const totals = postPriceTotals(
      [
        lot({ id: "a", price: "30.00", catalogPrice: "100.00", suggestedPrice: "25.00", costPrice: "10.00" }),
        lot({ id: "b", price: "20.00", catalogPrice: "50.00", suggestedPrice: "25.00", costPrice: "10.00" }),
      ],
      none,
      "PLN"
    );
    assert.equal(totals.price, "50.00");
    assert.equal(totals.priced, 2);
    assert.equal(totals.priceKind, "price");
    assert.deepEqual(column(totals, "catalogue"), {
      key: "catalogue",
      amount: "150.00",
      lots: 2,
      margin: { amount: "-100.00", percent: -67 },
      marginLots: 2,
    });
    assert.deepEqual(column(totals, "estimated").margin, { amount: "0.00", percent: 0 });
    assert.deepEqual(column(totals, "cost").margin, { amount: "30.00", percent: 150 });
  });

  it("leaves unpriced lots and missing figures out, never as 0, counting what it summed", () => {
    const totals = postPriceTotals(
      [
        lot({ id: "a", price: "30.00", costPrice: "10.00", marketPrice: { amount: "40.00" } }),
        lot({ id: "b", costPrice: "5.00" }),
        lot({ id: "c", price: "20.00" }),
      ],
      none,
      "PLN"
    );
    assert.equal(totals.price, "50.00");
    assert.equal(totals.priced, 2);
    assert.equal(totals.lotCount, 3);
    const cost = column(totals, "cost");
    assert.equal(cost.amount, "15.00");
    assert.equal(cost.lots, 2);
    // Only lot a has both a price and a cost: 30 against 10.
    assert.equal(cost.marginLots, 1);
    assert.deepEqual(cost.margin, { amount: "20.00", percent: 200 });
    const market = column(totals, "market");
    assert.equal(market.amount, "40.00");
    assert.equal(market.lots, 1);
    assert.deepEqual(column(totals, "catalogue"), { key: "catalogue", amount: null, lots: 0, margin: null, marginLots: 0 });
  });

  it("keeps a cost of zero as a known cost", () => {
    const cost = column(postPriceTotals([lot({ id: "a", price: "8.00", costPrice: "0.00" })], none, "PLN"), "cost");
    assert.equal(cost.amount, "0.00");
    assert.equal(cost.lots, 1);
    assert.deepEqual(cost.margin, { amount: "8.00", percent: null });
  });

  it("follows a price being typed, before it is saved", () => {
    const lots = [lot({ id: "a", price: "10.00" }), lot({ id: "b" })];
    const totals = postPriceTotals(lots, new Map([["b", { text: "7", from: "" }]]), "PLN");
    assert.equal(totals.price, "17.00");
    assert.equal(totals.priced, 2);
  });

  it("counts an auction by its starting price and names the kind", () => {
    const auction = lot({ id: "a", listingType: "auction", price: "50.00", startingPrice: "5.00" });
    const starting = postPriceTotals([auction], none, "PLN");
    assert.equal(starting.price, "5.00");
    assert.equal(starting.priceKind, "starting");
    assert.equal(postPriceTotals([auction, lot({ id: "b", price: "9.00" })], none, "PLN").priceKind, "mixed");
  });

  it("sums no lot in another currency", () => {
    const totals = postPriceTotals(
      [lot({ id: "a", price: "10.00" }), lot({ id: "b", price: "10.00", currency: "EUR" })],
      none,
      "PLN"
    );
    assert.equal(totals.price, "10.00");
    assert.equal(totals.lotCount, 1);
    assert.equal(totals.otherCurrency, 1);
  });

  it("has no price total while nothing is priced", () => {
    const totals = postPriceTotals([lot({ id: "a", catalogPrice: "10.00" })], none, "PLN");
    assert.equal(totals.price, null);
    assert.equal(column(totals, "catalogue").margin, null);
  });
});

describe("describeLotCoverage", () => {
  it("says over how many lots, only when some are left out", () => {
    assert.equal(describeLotCoverage(5, 8), "over 5 of 8 lots");
    assert.equal(describeLotCoverage(8, 8), null);
  });
});

// The cost column says what is under it, and why it is missing, over the lots (#2333).
describe("postPriceTotals — the cost's marks and gaps (#2333)", () => {
  const marks = (costEstimated: boolean, costOpening: boolean, gaps: [number, number, number]) => ({
    costEstimated,
    costOpening,
    costGaps: { unrecorded: gaps[0], unestimated: gaps[1], noOpeningValue: gaps[2] },
  });

  it("marks the cost when any lot's includes opening values or leans on an estimate, and sums the gaps", () => {
    const totals = postPriceTotals(
      [
        lot({ id: "a", costPrice: "6.00", setsTotals: marks(false, true, [0, 0, 1]) }),
        lot({ id: "b", costPrice: null, setsTotals: marks(true, false, [2, 1, 0]) }),
        lot({ id: "c", costPrice: "3.00" }),
      ],
      none,
      "PLN"
    );
    assert.deepEqual(totals.cost, {
      estimated: true,
      opening: true,
      gaps: { unrecorded: 2, unestimated: 1, noOpeningValue: 1 },
    });
    assert.equal(column(totals, "cost").amount, "9.00");
  });

  it("leaves a lot in another currency out of the marks, as out of the totals", () => {
    const totals = postPriceTotals(
      [lot({ id: "a", currency: "EUR", setsTotals: marks(true, true, [1, 0, 0]) })],
      none,
      "PLN"
    );
    assert.deepEqual(totals.cost, { estimated: false, opening: false, gaps: { unrecorded: 0, unestimated: 0, noOpeningValue: 0 } });
  });
});
