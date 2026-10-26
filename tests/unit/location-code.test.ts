import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  locationCodeBase,
  locationCodeProblem,
  locationPathNames,
  normalizeLocationCode,
  suggestLocationCode,
} from "../../src/lib/location-code";

describe("locationCodeBase (#2191)", () => {
  it("takes the initial of each level's last word, root to leaf", () => {
    assert.equal(locationCodeBase(["Segment A", "Shelf B", "Stockbook X"]), "ABX");
    assert.equal(locationCodeBase(["Safe", "Certificates envelope"]), "SE");
  });

  it("takes a number whole", () => {
    assert.equal(locationCodeBase(["Szafa 1", "Klaser A"]), "1A");
    assert.equal(locationCodeBase(["Box 12"]), "12");
  });

  it("folds Polish letters and drops what is not a letter or digit", () => {
    assert.equal(locationCodeBase(["Szafa Łódź"]), "L");
    assert.equal(locationCodeBase(["Box (spare)"]), "S");
  });

  it("keeps the leaf end of a path longer than six", () => {
    assert.equal(locationCodeBase(["A a", "B b", "C c", "D d", "E e", "F f", "G g"]), "BCDEFG");
  });

  it("is L when no level gives anything", () => {
    assert.equal(locationCodeBase(["—"]), "L");
  });
});

describe("suggestLocationCode (#2191)", () => {
  const path = ["Segment A", "Shelf B", "Stockbook X"];

  it("is the base when it is free", () => {
    assert.equal(suggestLocationCode(path, new Set()), "ABX");
  });

  it("numbers a clash from 2", () => {
    assert.equal(suggestLocationCode(path, new Set(["ABX"])), "ABX2");
    assert.equal(suggestLocationCode(path, new Set(["ABX", "ABX2"])), "ABX3");
  });

  it("gives up the base's front so the number fits in six", () => {
    const long = ["A a", "B b", "C c", "D d", "E e", "F f"];
    assert.equal(suggestLocationCode(long, new Set(["ABCDEF"])), "BCDEF2");
    const taken = new Set(["ABCDEF", ...Array.from({ length: 8 }, (_, i) => `BCDEF${i + 2}`)]);
    assert.equal(suggestLocationCode(long, taken), "CDEF10");
  });
});

describe("normalizeLocationCode and locationCodeProblem (#2191)", () => {
  it("stores a code trimmed and upper-cased", () => {
    assert.equal(normalizeLocationCode("  abx2 "), "ABX2");
  });

  it("accepts up to six letters and digits", () => {
    assert.equal(locationCodeProblem("ABX2"), null);
    assert.equal(locationCodeProblem("ABCDEF"), null);
  });

  it("refuses an empty, long or punctuated code", () => {
    assert.match(locationCodeProblem("") ?? "", /required/);
    assert.match(locationCodeProblem("ABCDEFG") ?? "", /at most 6/);
    assert.match(locationCodeProblem("A-1") ?? "", /letters and digits/);
  });
});

describe("locationPathNames (#2191)", () => {
  it("walks from the root down to a location not yet made", () => {
    const locations = [
      { id: "s", name: "Segment A", parentId: null },
      { id: "b", name: "Shelf B", parentId: "s" },
    ];
    assert.deepEqual(locationPathNames(locations, "b", "Stockbook X"), [
      "Segment A",
      "Shelf B",
      "Stockbook X",
    ]);
    assert.deepEqual(locationPathNames(locations, null, "Desk tray"), ["Desk tray"]);
  });
});
