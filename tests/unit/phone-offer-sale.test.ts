import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phoneSaleLine, phoneSalePriceDefault, phoneSaleSetsNote } from "../../src/lib/phone-offer-sale";

// Selling an offer from the phone (#2009): one set at a time, the first left, flagged as picked rather
// than chosen when the buyer took one of several interchangeable sets (#697).

describe("phoneSaleLine", () => {
  const sets = [
    { offerSetId: "s1", itemIds: ["a", "b"] },
    { offerSetId: "s2", itemIds: ["c"] },
    { offerSetId: "s3", itemIds: ["d"] },
  ];

  it("sells the first set left, its copies whole, at the price given", () => {
    const line = phoneSaleLine("o1", sets, "12.50");
    assert.deepEqual(line, {
      offerId: "o1",
      offerSetId: "s1",
      price: "12.50",
      itemIds: ["a", "b"],
      setChoicePending: true,
    });
  });

  it("flags the line as picked, not chosen, only when other sets were left", () => {
    assert.equal(phoneSaleLine("o1", sets.slice(0, 2), "1")?.setChoicePending, true);
    assert.equal(phoneSaleLine("o1", sets.slice(2), "1")?.setChoicePending, false);
  });

  it("records nothing for an offer with no set left", () => {
    assert.equal(phoneSaleLine("o1", [], "1"), null);
  });
});

describe("phoneSalePriceDefault", () => {
  it("starts at the offer's price", () => {
    assert.equal(phoneSalePriceDefault("25.00"), "25.00");
  });

  it("starts blank on an offer with no price yet, rather than at a zero", () => {
    assert.equal(phoneSalePriceDefault("0.00"), "");
  });
});

describe("phoneSaleSetsNote", () => {
  it("says nothing when the one set left is the one sold", () => {
    assert.equal(phoneSaleSetsNote(1), null);
  });

  it("says which copy goes is chosen at the desk when several are left", () => {
    assert.match(phoneSaleSetsNote(3) ?? "", /One of the 3 sets left is sold/);
  });
});
