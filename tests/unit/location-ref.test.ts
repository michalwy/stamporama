import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareLocationRef, parseLocationRef } from "../../src/lib/location-ref";

function sorted(refs: (string | null)[]): (string | null)[] {
  return [...refs].sort(compareLocationRef);
}

describe("parseLocationRef", () => {
  it("splits prefix + trailing number, dropping the separator", () => {
    assert.deepEqual(parseLocationRef("A100"), { prefix: "A", digits: "100" });
    assert.deepEqual(parseLocationRef("B-3000"), { prefix: "B", digits: "3000" });
    assert.deepEqual(parseLocationRef("K 12"), { prefix: "K", digits: "12" });
  });

  it("strips leading zeros and upper-cases the prefix", () => {
    assert.deepEqual(parseLocationRef("a007"), { prefix: "A", digits: "7" });
  });

  it("treats a ref with no trailing number as prefix only", () => {
    assert.deepEqual(parseLocationRef("A10b"), { prefix: "A10B", digits: null });
  });

  it("handles a bare number", () => {
    assert.deepEqual(parseLocationRef("42"), { prefix: "", digits: "42" });
  });
});

describe("compareLocationRef", () => {
  it("orders by prefix first, then by number", () => {
    assert.deepEqual(sorted(["B-3000", "A1200", "A100", "B-40"]), ["A100", "A1200", "B-40", "B-3000"]);
  });

  it("ignores the separator when comparing", () => {
    assert.deepEqual(sorted(["A-1200", "A100"]), ["A100", "A-1200"]);
  });

  it("sorts numbers numerically, not lexicographically", () => {
    assert.deepEqual(sorted(["A10", "A9", "A100"]), ["A9", "A10", "A100"]);
  });

  it("keeps blank refs last", () => {
    assert.deepEqual(sorted(["B1", null, "A1", ""]), ["A1", "B1", null, ""]);
  });

  it("puts an unnumbered ref after the numbered ones sharing its prefix", () => {
    assert.deepEqual(sorted(["A", "A2", "A1"]), ["A1", "A2", "A"]);
  });

  it("compares very long numbers exactly", () => {
    const big = "A" + "9".repeat(25);
    const bigger = "A1" + "0".repeat(25);
    assert.equal(compareLocationRef(big, bigger) < 0, true);
  });
});
