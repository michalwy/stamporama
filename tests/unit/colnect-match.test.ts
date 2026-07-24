import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  colnectRefKey,
  decideColnectItem,
  type CandidateStampRefs,
  type ResolvedRef,
} from "../../src/lib/colnect-match";

// A stamp keyed as catalogMatchKey("Mi", "PL", "200") === "mipl200".
const ref = (catalogVendorId: string, key: string): ResolvedRef => ({ catalogVendorId, key });
const candidate = (
  stampId: string,
  existingColnectId: string | null,
  refs: ResolvedRef[]
): CandidateStampRefs => ({ stampId, existingColnectId, refs });

describe("colnectRefKey", () => {
  it("folds vendor abbreviation + prefixed number into the strict key", () => {
    assert.equal(colnectRefKey("Mi", "PL 200"), "mipl200");
    assert.equal(colnectRefKey("Mi", "PL200"), "mipl200");
    assert.equal(colnectRefKey("Mi", "PL·200"), "mipl200");
  });

  it("keeps a bare (prefixless) number distinct from a prefixed one", () => {
    assert.equal(colnectRefKey("Mi", "200"), "mi200");
    assert.notEqual(colnectRefKey("Mi", "200"), colnectRefKey("Mi", "PL 200"));
  });
});

describe("decideColnectItem", () => {
  const V_MI = "vendor-mi";
  const V_SC = "vendor-sc";

  it("skips when no refs resolved", () => {
    const d = decideColnectItem("111", [], [candidate("s1", null, [ref(V_MI, "mipl200")])]);
    assert.deepEqual(d, { status: "skipped", reason: "unresolved-refs" });
  });

  it("skips when no candidate shares an exact key", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [candidate("s1", null, [ref(V_MI, "mipl201")])]
    );
    assert.deepEqual(d, { status: "skipped", reason: "no-candidates" });
  });

  it("auto-matches a lone clean candidate with no existing id", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [candidate("s1", null, [ref(V_MI, "mipl200")])]
    );
    assert.deepEqual(d, { status: "auto", stampId: "s1", alreadySet: false });
  });

  it("auto-matches (alreadySet) when the candidate already holds this exact id", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [candidate("s1", "111", [ref(V_MI, "mipl200")])]
    );
    assert.deepEqual(d, { status: "auto", stampId: "s1", alreadySet: true });
  });

  it("needs-confirm (existing-different) rather than overwrite a different id", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [candidate("s1", "999", [ref(V_MI, "mipl200")])]
    );
    assert.deepEqual(d, {
      status: "needs-confirm",
      reason: "existing-different",
      candidateStampIds: ["s1"],
    });
  });

  it("needs-confirm (partial-conflict) when a lone candidate agrees on one vendor, conflicts on another", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200"), ref(V_SC, "sc55")],
      [candidate("s1", null, [ref(V_MI, "mipl200"), ref(V_SC, "sc99")])]
    );
    assert.deepEqual(d, {
      status: "needs-confirm",
      reason: "partial-conflict",
      candidateStampIds: ["s1"],
    });
  });

  it("needs-confirm (multiple-candidates) when more than one stamp agrees", () => {
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [
        candidate("s1", null, [ref(V_MI, "mipl200")]),
        candidate("s2", null, [ref(V_MI, "mipl200")]),
      ]
    );
    assert.equal(d.status, "needs-confirm");
    if (d.status === "needs-confirm") {
      assert.equal(d.reason, "multiple-candidates");
      assert.deepEqual([...d.candidateStampIds].sort(), ["s1", "s2"]);
    }
  });

  it("a non-agreeing candidate that only conflicts does not count toward candidates", () => {
    // s2 shares the vendor but a different number → conflict-only, not a candidate. Lone agreeing
    // s1 stays auto.
    const d = decideColnectItem(
      "111",
      [ref(V_MI, "mipl200")],
      [
        candidate("s1", null, [ref(V_MI, "mipl200")]),
        candidate("s2", null, [ref(V_MI, "mipl201")]),
      ]
    );
    assert.deepEqual(d, { status: "auto", stampId: "s1", alreadySet: false });
  });
});
