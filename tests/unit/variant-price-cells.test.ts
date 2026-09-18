import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  derivedCellAmount,
  lowestVariantAmount,
  shownCellAmount,
  summarizeUmbrellaCell,
  variantDescendantMap,
  type VariantTreeRow,
} from "../../src/lib/variant-price-cells";

// The arithmetic the variant price grid (#618, #627) and the identification step's variant section
// (#1337) share. What matters most is the section heading: the umbrella's value and how many of its
// variants are still unpriced, which have to be the grid's own reading of the same tree.

// 309 → 309A (umbrella) → 309Aa, 309Ab; 309B; and 309X filed under 309 without being a variant.
const TREE: VariantTreeRow[] = [
  { stampId: "309", depth: 0, identified: false, isVariant: false },
  { stampId: "309A", depth: 1, identified: false, isVariant: true },
  { stampId: "309Aa", depth: 2, identified: true, isVariant: true },
  { stampId: "309Ab", depth: 2, identified: true, isVariant: true },
  { stampId: "309B", depth: 1, identified: true, isVariant: true },
  { stampId: "309X", depth: 1, identified: true, isVariant: false },
];

const amounts = (map: Record<string, number>) => (id: string) => map[id] ?? null;

describe("variantDescendantMap", () => {
  it("collects variant-kind descendants at any depth, skipping entries merely filed under", () => {
    const map = variantDescendantMap(TREE);
    assert.deepEqual(map.get("309"), ["309A", "309Aa", "309Ab", "309B"]);
    assert.deepEqual(map.get("309A"), ["309Aa", "309Ab"]);
    assert.deepEqual(map.get("309B"), []);
  });
});

describe("cell amounts", () => {
  it("derives a format's cell from the single only when both facts exist", () => {
    assert.equal(derivedCellAmount("10,5", 4), "42.00");
    assert.equal(derivedCellAmount("", 4), null);
    assert.equal(derivedCellAmount("10", undefined), null);
  });

  it("prefers the typed figure over the derived one, and reads neither from a blank", () => {
    assert.equal(shownCellAmount("3,20", "42.00"), 3.2);
    assert.equal(shownCellAmount("  ", "42.00"), 42);
    assert.equal(shownCellAmount("", null), null);
  });

  it("takes the lowest priced variant as the rollup", () => {
    assert.equal(lowestVariantAmount(["a", "b", "c"], amounts({ a: 5, c: 2.5 })), "2.50");
    assert.equal(lowestVariantAmount(["a"], amounts({})), null);
  });
});

describe("summarizeUmbrellaCell", () => {
  it("rolls the umbrella's value up from its variants and counts the unpriced ones", () => {
    const summary = summarizeUmbrellaCell({
      rows: TREE,
      umbrellaId: "309",
      own: "",
      amountOf: amounts({ "309Aa": 8, "309B": 3 }),
    });
    // 309A is an umbrella of its own and 309X does not roll up: three variants, one unpriced.
    assert.deepEqual(summary, { value: "3.00", rolledUp: true, variantCount: 3, unpricedCount: 1 });
  });

  it("does not let an entry filed under the umbrella lower its value", () => {
    const summary = summarizeUmbrellaCell({
      rows: TREE,
      umbrellaId: "309",
      own: "",
      amountOf: amounts({ "309Aa": 8, "309X": 1 }),
    });
    assert.equal(summary.value, "8.00");
  });

  it("shows a figure recorded on the umbrella itself plainly, over the rollup", () => {
    const summary = summarizeUmbrellaCell({
      rows: TREE,
      umbrellaId: "309",
      own: "12",
      amountOf: amounts({ "309Aa": 8 }),
    });
    assert.equal(summary.value, "12.00");
    assert.equal(summary.rolledUp, false);
    assert.equal(summary.unpricedCount, 2);
  });

  it("has no value while nothing is priced", () => {
    const summary = summarizeUmbrellaCell({
      rows: TREE,
      umbrellaId: "309",
      own: "",
      amountOf: amounts({}),
    });
    assert.deepEqual(summary, { value: null, rolledUp: false, variantCount: 3, unpricedCount: 3 });
  });
});
