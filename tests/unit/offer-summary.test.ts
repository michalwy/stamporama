import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateOfferAsking, type OfferSummaryRow } from "../../src/lib/offer-summary";

function row(over: Partial<OfferSummaryRow> = {}): OfferSummaryRow {
  return {
    platformId: "p1",
    platformName: "Allegro",
    price: "10.00",
    currency: "PLN",
    setCount: 1,
    itemIds: ["i1"],
    ...over,
  };
}

describe("aggregateOfferAsking", () => {
  it("is all zeros for an empty set", () => {
    const total = aggregateOfferAsking([], "PLN", new Map());
    assert.equal(total.offerCount, 0);
    assert.equal(total.askingBaseAmount, "0.00");
    assert.equal(total.setCount, 0);
    assert.equal(total.itemCount, 0);
    assert.deepEqual(total.platforms, []);
  });

  it("sums base-currency prices and the sets/copies behind them", () => {
    const total = aggregateOfferAsking(
      [row({ price: "10.00", setCount: 2, itemIds: ["a", "b", "c", "d", "e"] }), row({ price: "2.50" })],
      "PLN",
      new Map()
    );
    assert.equal(total.askingBaseAmount, "12.50");
    assert.equal(total.offerCount, 2);
    assert.equal(total.pricedCount, 2);
    assert.equal(total.setCount, 3);
    assert.equal(total.itemCount, 6);
  });

  it("converts a foreign currency at the supplied rate", () => {
    const total = aggregateOfferAsking(
      [row({ price: "10.00", currency: "EUR" }), row({ price: "5.00" })],
      "PLN",
      new Map([["EUR", 4.3]])
    );
    assert.equal(total.askingBaseAmount, "48.00");
    assert.equal(total.pricedCount, 2);
  });

  it("counts an offer with no rate as unconvertible, never at face value", () => {
    const total = aggregateOfferAsking(
      [row({ price: "10.00", currency: "USD" }), row({ price: "5.00" })],
      "PLN",
      new Map()
    );
    assert.equal(total.askingBaseAmount, "5.00");
    assert.equal(total.unconvertibleCount, 1);
    assert.equal(total.pricedCount, 1);
  });

  it("counts a zero or absent price as not priced yet, apart from unconvertible", () => {
    const total = aggregateOfferAsking(
      [row({ price: "0.00" }), row({ price: "0" }), row({ price: "7.00" })],
      "PLN",
      new Map()
    );
    assert.equal(total.unpricedCount, 2);
    assert.equal(total.unconvertibleCount, 0);
    assert.equal(total.askingBaseAmount, "7.00");
  });

  it("counts a copy once per offer holding it", () => {
    // The same physical copy listed on two platforms is two sellable offers, so `itemCount`
    // counts it twice. Deduplication belongs to the holdings figures, not here.
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p1", itemIds: ["i1"] }),
        row({ platformId: "p2", platformName: "Delcampe", itemIds: ["i1"] }),
      ],
      "PLN",
      new Map()
    );
    assert.equal(total.itemCount, 2);
  });

  it("deduplicates a platform's copy ids, so its stock is valued once", () => {
    // Two offers on the same marketplace holding one copy: two listings, one piece of stock.
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p1", itemIds: ["i1", "i2"] }),
        row({ platformId: "p1", itemIds: ["i2", "i3"] }),
      ],
      "PLN",
      new Map()
    );
    assert.equal(total.itemCount, 4);
    assert.deepEqual(total.platforms[0].itemIds, ["i1", "i2", "i3"]);
  });

  it("gives each platform the same figures as the total, over its own offers", () => {
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p1", price: "10.00", setCount: 2, itemIds: ["a", "b"] }),
        row({ platformId: "p1", price: "0.00", setCount: 1, itemIds: ["c"] }),
        row({
          platformId: "p2",
          platformName: "Delcampe",
          price: "5.00",
          currency: "USD",
          itemIds: ["d"],
        }),
      ],
      "PLN",
      new Map()
    );
    const [allegro, delcampe] = total.platforms;
    assert.deepEqual(
      {
        askingBaseAmount: allegro.askingBaseAmount,
        offerCount: allegro.offerCount,
        setCount: allegro.setCount,
        itemCount: allegro.itemCount,
        unpricedCount: allegro.unpricedCount,
      },
      { askingBaseAmount: "10.00", offerCount: 2, setCount: 3, itemCount: 3, unpricedCount: 1 }
    );
    assert.equal(delcampe.unconvertibleCount, 1);
    assert.equal(delcampe.askingBaseAmount, "0.00");
  });

  it("breaks down by platform, largest asking value first", () => {
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p1", platformName: "Allegro", price: "10.00" }),
        row({ platformId: "p2", platformName: "Delcampe", price: "30.00" }),
        row({ platformId: "p1", platformName: "Allegro", price: "5.00" }),
      ],
      "PLN",
      new Map()
    );
    assert.deepEqual(
      total.platforms.map((p) => [p.platformName, p.askingBaseAmount, p.offerCount]),
      [
        ["Delcampe", "30.00", 1],
        ["Allegro", "15.00", 2],
      ]
    );
  });

  it("orders equal-valued platforms by name, so the breakdown is stable", () => {
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p2", platformName: "Delcampe", price: "10.00" }),
        row({ platformId: "p1", platformName: "Allegro", price: "10.00" }),
      ],
      "PLN",
      new Map()
    );
    assert.deepEqual(
      total.platforms.map((p) => p.platformName),
      ["Allegro", "Delcampe"]
    );
  });

  it("keeps a platform whose offers are all unpriced, showing it at zero", () => {
    const total = aggregateOfferAsking(
      [
        row({ platformId: "p1", platformName: "Allegro", price: "10.00" }),
        row({ platformId: "p2", platformName: "Delcampe", price: "0.00" }),
      ],
      "PLN",
      new Map()
    );
    const delcampe = total.platforms.find((p) => p.platformName === "Delcampe");
    assert.equal(delcampe?.askingBaseAmount, "0.00");
    assert.equal(delcampe?.unpricedCount, 1);
  });
});
