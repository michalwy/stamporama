import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { priceListStep } from "../../src/lib/price-list-step";

// Enter and Tab move down a list of price fields, Shift+Tab back up it (#2031, #2489).

const all = () => true;

describe("priceListStep", () => {
  const ids = ["a", "b", "c", "d"];

  it("goes to the next row's field forward and the previous one's back", () => {
    assert.equal(priceListStep(ids, "b", 1, all), "c");
    assert.equal(priceListStep(ids, "b", -1, all), "a");
  });

  it("has nowhere to go past either end, so the key does its ordinary thing", () => {
    assert.equal(priceListStep(ids, "d", 1, all), null);
    assert.equal(priceListStep(ids, "a", -1, all), null);
  });

  it("steps over a row that has no price field", () => {
    const has = (id: string) => id !== "c";
    assert.equal(priceListStep(ids, "b", 1, has), "d");
    assert.equal(priceListStep(ids, "d", -1, has), "b");
    assert.equal(priceListStep(["a", "b", "c"], "b", 1, has), null);
  });

  it("finds nothing from a row no longer in the list", () => {
    assert.equal(priceListStep(ids, "z", 1, all), null);
  });
});
