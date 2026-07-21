import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLotKind,
  isLotState,
  canHoldItems,
  canHoldSubLots,
  checkKindInvariant,
  checkReadyable,
  deriveLotSaleStatus,
  deriveLotLabel,
  wouldCreateCycle,
  shapeSignature,
  sameShape,
  isSingleComponentShape,
} from "../../src/lib/sale-lot-rules";

// Type guards ---------------------------------------------------------------

describe("isLotKind / isLotState", () => {
  it("accepts valid values and rejects everything else", () => {
    assert.equal(isLotKind("unit"), true);
    assert.equal(isLotKind("quantity"), true);
    assert.equal(isLotKind("bundle"), false);
    assert.equal(isLotKind(undefined), false);

    assert.equal(isLotState("draft"), true);
    assert.equal(isLotState("ready"), true);
    assert.equal(isLotState("dissolved"), true);
    assert.equal(isLotState("sold"), false);
  });
});

// Kind capabilities ---------------------------------------------------------

describe("canHoldItems / canHoldSubLots", () => {
  it("routes items to unit lots and sub-lots to quantity lots", () => {
    assert.equal(canHoldItems("unit"), true);
    assert.equal(canHoldItems("quantity"), false);
    assert.equal(canHoldSubLots("quantity"), true);
    assert.equal(canHoldSubLots("unit"), false);
  });
});

// Kind invariant ------------------------------------------------------------

describe("checkKindInvariant", () => {
  it("passes a well-formed unit lot (items, no sub-lots)", () => {
    assert.equal(checkKindInvariant("unit", { itemCount: 3, subLotCount: 0 }), null);
  });

  it("passes a well-formed quantity lot (sub-lots, no items)", () => {
    assert.equal(checkKindInvariant("quantity", { itemCount: 0, subLotCount: 4 }), null);
  });

  it("rejects a unit lot that holds sub-lots", () => {
    assert.match(
      checkKindInvariant("unit", { itemCount: 1, subLotCount: 1 }) ?? "",
      /unit lot cannot contain sub-lots/i
    );
  });

  it("rejects a quantity lot that holds items directly", () => {
    assert.match(
      checkKindInvariant("quantity", { itemCount: 2, subLotCount: 1 }) ?? "",
      /quantity lot cannot contain copies/i
    );
  });

  it("passes empty lots of either kind", () => {
    assert.equal(checkKindInvariant("unit", { itemCount: 0, subLotCount: 0 }), null);
    assert.equal(checkKindInvariant("quantity", { itemCount: 0, subLotCount: 0 }), null);
  });
});

// Ready transition ----------------------------------------------------------

describe("checkReadyable", () => {
  it("blocks an empty unit lot with a copy-specific message", () => {
    assert.match(
      checkReadyable("unit", { itemCount: 0, subLotCount: 0 }) ?? "",
      /at least one copy/i
    );
  });

  it("blocks an empty quantity lot with a sub-lot-specific message", () => {
    assert.match(
      checkReadyable("quantity", { itemCount: 0, subLotCount: 0 }) ?? "",
      /at least one sub-lot/i
    );
  });

  it("allows a non-empty lot", () => {
    assert.equal(checkReadyable("unit", { itemCount: 1, subLotCount: 0 }), null);
    assert.equal(checkReadyable("quantity", { itemCount: 0, subLotCount: 1 }), null);
  });
});

// Derived sale status -------------------------------------------------------

describe("deriveLotSaleStatus", () => {
  it("treats a unit lot as atomic", () => {
    assert.equal(
      deriveLotSaleStatus({ kind: "unit", selfSold: false, subLotSold: [] }),
      "available"
    );
    assert.equal(
      deriveLotSaleStatus({ kind: "unit", selfSold: true, subLotSold: [] }),
      "sold"
    );
  });

  it("derives quantity-lot status from member sub-lots", () => {
    assert.equal(
      deriveLotSaleStatus({ kind: "quantity", selfSold: false, subLotSold: [] }),
      "available"
    );
    assert.equal(
      deriveLotSaleStatus({
        kind: "quantity",
        selfSold: false,
        subLotSold: [false, false],
      }),
      "available"
    );
    assert.equal(
      deriveLotSaleStatus({
        kind: "quantity",
        selfSold: false,
        subLotSold: [true, false, false],
      }),
      "partially-sold"
    );
    assert.equal(
      deriveLotSaleStatus({
        kind: "quantity",
        selfSold: false,
        subLotSold: [true, true],
      }),
      "sold"
    );
  });
});

// Label fallback ------------------------------------------------------------

describe("deriveLotLabel", () => {
  it("prefers an explicit title", () => {
    assert.equal(deriveLotLabel("unit", "  Poland 1950s  ", ["A"]), "Poland 1950s");
  });

  it("joins unit-lot copies as a komplet", () => {
    assert.equal(deriveLotLabel("unit", null, ["Mi 1", "Mi 2"]), "Mi 1 + Mi 2");
  });

  it("summarises a quantity lot by count", () => {
    assert.equal(deriveLotLabel("quantity", "", ["10gr green", "10gr green"]), "2× (10gr green)");
  });

  it("labels empty lots by kind", () => {
    assert.equal(deriveLotLabel("unit", null, []), "Empty lot");
    assert.equal(deriveLotLabel("quantity", null, []), "Empty quantity lot");
  });
});

// Shape signature -----------------------------------------------------------

describe("shapeSignature / sameShape", () => {
  it("is order-independent", () => {
    assert.equal(shapeSignature(["b", "a"]), shapeSignature(["a", "b"]));
    assert.equal(sameShape(["x", "y"], ["y", "x"]), true);
  });

  it("distinguishes different stamp sets", () => {
    assert.equal(sameShape(["x"], ["y"]), false);
    assert.equal(sameShape(["x", "y"], ["x"]), false);
  });

  it("preserves multiplicity (a komplet of two of the same stamp)", () => {
    assert.equal(sameShape(["x", "x"], ["x"]), false);
    assert.equal(sameShape(["x", "x"], ["x", "x"]), true);
  });

  it("treats empty shapes as equal", () => {
    assert.equal(sameShape([], []), true);
    assert.equal(shapeSignature([]), "");
  });
});

describe("isSingleComponentShape", () => {
  it("is true only for exactly one stamp", () => {
    assert.equal(isSingleComponentShape(["x"]), true);
    assert.equal(isSingleComponentShape([]), false);
    assert.equal(isSingleComponentShape(["x", "y"]), false);
    assert.equal(isSingleComponentShape(["x", "x"]), false);
  });
});

// Cycle guard ---------------------------------------------------------------

describe("wouldCreateCycle", () => {
  it("rejects a self-edge", () => {
    assert.equal(wouldCreateCycle("a", "a", new Map()), true);
  });

  it("allows an independent edge", () => {
    assert.equal(wouldCreateCycle("a", "b", new Map()), false);
  });

  it("rejects a direct back-edge (b already contains a)", () => {
    const edges = new Map([["b", ["a"]]]);
    assert.equal(wouldCreateCycle("a", "b", edges), true);
  });

  it("rejects a transitive cycle (b → c → a)", () => {
    const edges = new Map([
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    assert.equal(wouldCreateCycle("a", "b", edges), true);
  });

  it("allows an edge into a disjoint subtree", () => {
    const edges = new Map([
      ["b", ["c"]],
      ["d", ["e"]],
    ]);
    assert.equal(wouldCreateCycle("a", "b", edges), false);
  });
});
