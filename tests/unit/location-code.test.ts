import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLocationCode,
  joinLocationCode,
  locationCodeBase,
  locationCodeProblem,
  locationCodeSibling,
  normalizeLocationCode,
  suggestLocationCode,
} from "../../src/lib/location-code";

describe("locationCodeBase (#2191, per level since #2235)", () => {
  it("takes the initial of the name's last word", () => {
    assert.equal(locationCodeBase("Klaser A"), "A");
    assert.equal(locationCodeBase("Certificates envelope"), "E");
  });

  it("takes a number whole", () => {
    assert.equal(locationCodeBase("Szafa 1"), "1");
    assert.equal(locationCodeBase("Box 12"), "12");
  });

  it("folds Polish letters and drops what is not a letter or digit", () => {
    assert.equal(locationCodeBase("Szafa Łódź"), "L");
    assert.equal(locationCodeBase("Box (spare)"), "S");
  });

  it("is L when the name gives nothing", () => {
    assert.equal(locationCodeBase("—"), "L");
  });
});

describe("suggestLocationCode (#2235)", () => {
  it("is the base when no sibling holds it", () => {
    assert.equal(suggestLocationCode("Klaser A", []), "A");
  });

  it("numbers a clash among the siblings from 2, without length limit", () => {
    assert.equal(suggestLocationCode("Klaser A", ["A"]), "A2");
    assert.equal(suggestLocationCode("Klaser A", ["A", "A2"]), "A3");
    const taken = ["A", ...Array.from({ length: 9 }, (_, i) => `A${i + 2}`)];
    assert.equal(suggestLocationCode("Klaser A", taken), "A11");
  });

  it("compares the siblings' codes without regard to case", () => {
    assert.equal(suggestLocationCode("Klaser A", ["a"]), "A2");
  });
});

describe("normalizeLocationCode and locationCodeProblem (#2235)", () => {
  it("trims a code and otherwise keeps it as typed", () => {
    assert.equal(normalizeLocationCode("  Klaser-a 2 "), "Klaser-a 2");
  });

  it("accepts any text of any length", () => {
    assert.equal(locationCodeProblem("ABX2"), null);
    assert.equal(locationCodeProblem("Stockbook seven"), null);
    assert.equal(locationCodeProblem("A-1/ż"), null);
  });

  it("refuses an empty code and a dot", () => {
    assert.match(locationCodeProblem("") ?? "", /required/);
    assert.match(locationCodeProblem("A.1") ?? "", /dot/);
  });
});

const TREE = [
  { id: "cab", name: "Cabinet A", code: "A", parentId: null },
  { id: "shelf", name: "Shelf B", code: "B", parentId: "cab" },
  { id: "book", name: "Stockbook C", code: "C", parentId: "shelf" },
  { id: "page", name: "Page 1", code: "1", parentId: "book" },
  { id: "box", name: "Box", code: "b", parentId: null },
];

describe("buildLocationCode and joinLocationCode (#2235)", () => {
  it("joins the levels' codes from the top down with dots", () => {
    assert.equal(buildLocationCode(TREE, "page"), "A.B.C.1");
    assert.equal(buildLocationCode(TREE, "cab"), "A");
  });

  it("is null for no location or an unknown one", () => {
    assert.equal(buildLocationCode(TREE, null), null);
    assert.equal(buildLocationCode(TREE, "nope"), null);
  });

  it("follows a parent's code", () => {
    const renamed = TREE.map((l) => (l.id === "shelf" ? { ...l, code: "S" } : l));
    assert.equal(buildLocationCode(renamed, "page"), "A.S.C.1");
  });

  it("puts a code under a parent, or alone at the top", () => {
    assert.equal(joinLocationCode(TREE, "book", "2"), "A.B.C.2");
    assert.equal(joinLocationCode(TREE, null, "Z"), "Z");
  });
});

describe("locationCodeSibling (#2235)", () => {
  it("finds the sibling holding a code, case aside", () => {
    assert.equal(locationCodeSibling(TREE, null, "a")?.id, "cab");
    assert.equal(locationCodeSibling(TREE, null, "B")?.id, "box");
  });

  it("does not look past the siblings", () => {
    assert.equal(locationCodeSibling(TREE, "cab", "A"), undefined);
    assert.equal(locationCodeSibling(TREE, "book", "C"), undefined);
  });
});
