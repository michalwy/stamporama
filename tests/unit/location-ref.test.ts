import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareLocationRef,
  incrementLocationRef,
  locationRefStrip,
  nextLocationRef,
  parseLocationRef,
} from "../../src/lib/location-ref";

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

// The next-ref allocator (#565). The suggestion is what a strip of blank ref cards is up to, so its
// job is to count on in the shape the collector already writes, and to say nothing at all about a
// location that has never used a ref — the normal case for an album.

describe("incrementLocationRef", () => {
  it("counts on from the trailing number", () => {
    assert.equal(incrementLocationRef("A147"), "A148");
    assert.equal(incrementLocationRef("42"), "43");
  });

  it("keeps the separator and the zero padding", () => {
    assert.equal(incrementLocationRef("B-3000"), "B-3001");
    assert.equal(incrementLocationRef("A007"), "A008");
    assert.equal(incrementLocationRef("K 12"), "K 13");
  });

  it("widens the number only when it has to", () => {
    assert.equal(incrementLocationRef("A099"), "A100");
    assert.equal(incrementLocationRef("A9"), "A10");
  });

  it("counts on past 2^53 exactly", () => {
    assert.equal(incrementLocationRef("A9007199254740993"), "A9007199254740994");
  });

  it("refuses a ref with no trailing number", () => {
    assert.equal(incrementLocationRef("Album"), null);
    assert.equal(incrementLocationRef(""), null);
  });
});

describe("nextLocationRef", () => {
  it("suggests one past the highest ref in use", () => {
    assert.equal(nextLocationRef(["A1", "A147", "A12"]), "A148");
  });

  it("suggests nothing for a location that has never been ref'd in", () => {
    assert.equal(nextLocationRef([]), null);
    assert.equal(nextLocationRef([null, "", "  "]), null);
  });

  it("follows the strip currently being filled when a location holds two", () => {
    // `compareLocationRef` orders by prefix first, so `B` is the newer strip even though `A`
    // reaches a higher number.
    assert.equal(nextLocationRef(["A1", "A200", "B1", "B5"]), "B6");
  });

  it("ignores labels that carry no number", () => {
    assert.equal(nextLocationRef(["Loose", "A3"]), "A4");
    assert.equal(nextLocationRef(["Loose"]), null);
  });
});

describe("locationRefStrip", () => {
  it("returns a consecutive run from the start ref", () => {
    assert.deepEqual(locationRefStrip("A147", 3), ["A147", "A148", "A149"]);
  });

  it("keeps the start ref's shape across the whole run", () => {
    assert.deepEqual(locationRefStrip("B-08", 3), ["B-08", "B-09", "B-10"]);
  });

  it("is empty when the start ref cannot be counted from", () => {
    assert.deepEqual(locationRefStrip("Album", 5), []);
    assert.deepEqual(locationRefStrip("", 5), []);
  });
});
