import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candidateSetLabel,
  candidateSetShape,
  canonicalCandidateSet,
  variantRoot,
  type CandidateTreeNode,
} from "../../src/lib/candidate-set-rules";

// A copy identified as one of several candidate stamps (#1651, ADR-0065).
//
//   123                    Mi 85            Mi 101          2
//   ├─ 123a  (colour)                                       └─ 2 B1 (error — not a variant)
//   │  ├─ 123aI  (type)
//   │  └─ 123aII
//   └─ 123b
//      ├─ 123bI
//      └─ 123bII

function node(id: string, parentId: string | null, isVariant = true): CandidateTreeNode {
  return { id, parentId, isVariant: parentId !== null && isVariant, sortKey: id };
}

const TREE = new Map(
  [
    node("123", null),
    node("123a", "123"),
    node("123aI", "123a"),
    node("123aII", "123a"),
    node("123b", "123"),
    node("123bI", "123b"),
    node("123bII", "123b"),
    node("85", null),
    node("101", null),
    node("2", null),
    node("2B1", "2", false),
  ].map((n) => [n.id, n])
);

describe("canonicalCandidateSet", () => {
  it("keeps a set whose members say something different", () => {
    assert.deepEqual(canonicalCandidateSet(["123bI", "123aI"], TREE), ["123aI", "123bI"]);
  });

  it("drops a candidate already covered by its variant ancestor", () => {
    assert.deepEqual(canonicalCandidateSet(["123aI", "123a", "123bI"], TREE), ["123a", "123bI"]);
  });

  it("stores every variant of one umbrella as the umbrella, at every depth", () => {
    assert.deepEqual(canonicalCandidateSet(["123aI", "123aII", "123bI"], TREE), ["123a", "123bI"]);
    assert.deepEqual(
      canonicalCandidateSet(["123aI", "123aII", "123bI", "123bII"], TREE),
      ["123"],
      "a and b collapse, and a + b is 123 — a plain umbrella copy"
    );
  });

  it("does not climb out of a distinct entry", () => {
    assert.deepEqual(canonicalCandidateSet(["2B1", "2"], TREE), ["2", "2B1"]);
  });
});

describe("candidateSetShape", () => {
  it("points a one-tree set at the candidates' nearest common variant ancestor", () => {
    assert.deepEqual(candidateSetShape(["123aI", "123bI"], TREE), { trees: 1, pointerStampId: "123" });
    assert.deepEqual(candidateSetShape(["123aI", "123aII"], TREE), { trees: 1, pointerStampId: "123a" });
  });

  it("counts the trees of a set across issues, pointing at the first candidate", () => {
    assert.deepEqual(candidateSetShape(["85", "101"], TREE), { trees: 2, pointerStampId: "101" });
    assert.deepEqual(candidateSetShape(["123aI", "85", "101"], TREE), { trees: 3, pointerStampId: "101" });
  });

  it("treats a base stamp and its distinct entry as two trees", () => {
    assert.equal(variantRoot("2B1", TREE), "2B1");
    assert.equal(candidateSetShape(["2", "2B1"], TREE).trees, 2);
  });

  it("refuses fewer than two candidates", () => {
    assert.throws(() => candidateSetShape(["85"], TREE));
  });
});

describe("candidateSetLabel", () => {
  it("names a short set in full, printing a shared vendor once", () => {
    assert.equal(candidateSetLabel(["Mi 123aI", "Mi 123bI"]), "Mi 123aI or 123bI");
    assert.equal(candidateSetLabel(["Mi 85", "Mi 101", "Mi 110"]), "Mi 85, 101 or 110");
    assert.equal(candidateSetLabel(["Mi 85", "Sc 101"]), "Mi 85 or Sc 101");
  });

  it("shortens a long set to the shared part and the differing parts", () => {
    assert.equal(
      candidateSetLabel(["Mi·PL 123aI", "Mi·PL 123aII", "Mi·PL 123bI", "Mi·PL 123bII"]),
      "Mi·PL 123aI/aII/bI/bII"
    );
  });

  it("never cuts inside a number", () => {
    const labels = ["Mi·PL 1201", "Mi·PL 1202", "Mi·PL 1203", "Mi·PL 1204", "Mi·PL 1205"];
    assert.equal(candidateSetLabel(labels), "Mi·PL 1201, 1202, 1203, 1204 or 1205");
  });

  it("names a single stamp as itself", () => {
    assert.equal(candidateSetLabel(["Mi 85"]), "Mi 85");
  });
});
