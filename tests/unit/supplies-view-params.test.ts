import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPLIES_VIEW_DEFAULTS,
  SUPPLIES_VIEW_PARAMS,
  filterSupplySummary,
  pruneStoredSupplies,
  registerClearUpdates,
  registerNarrowings,
  resolveSuppliesView,
  suppliesTabOf,
  suppliesViewUpdatesFor,
  suppliesViewUrlUpdates,
} from "../../src/app/c/[collectionSlug]/supplies/supplies-view-params";

// The Packing supplies screen's two toolbars as a value (#2195, #2196): what the address and the
// memory resolve to, what a press writes, and what the summary shows.

function reader(params: Record<string, string>) {
  return (key: string) => (key in params ? params[key] : null);
}

describe("resolveSuppliesView", () => {
  it("is the defaults with nothing said", () => {
    assert.deepEqual(resolveSuppliesView(reader({})), SUPPLIES_VIEW_DEFAULTS);
  });

  it("reads every setting, dropping an unknown type and a malformed date", () => {
    assert.deepEqual(
      resolveSuppliesView(
        reader({ name: "env", onhand: "1", supply: "a,b,a", type: "own,nope,bought", from: "2026-01-01", to: "soon", q: "box", month: "1" })
      ),
      {
        name: "env",
        onHand: true,
        supplies: ["a", "b"],
        kinds: ["own", "bought"],
        from: "2026-01-01",
        to: "",
        q: "box",
        byMonth: true,
      }
    );
  });
});

describe("suppliesTabOf", () => {
  it("opens on the summary unless the address says register", () => {
    assert.equal(suppliesTabOf(null), "summary");
    assert.equal(suppliesTabOf("other"), "summary");
    assert.equal(suppliesTabOf("register"), "register");
  });
});

describe("writing the view", () => {
  it("writes only the keys named, a default as a deletion", () => {
    assert.deepEqual(suppliesViewUpdatesFor({ kinds: ["sale", "own"], byMonth: false }), { type: "sale,own", month: "" });
  });

  it("tracks every setting and nothing else", () => {
    assert.deepEqual([...SUPPLIES_VIEW_PARAMS].sort(), ["from", "month", "name", "onhand", "q", "supply", "to", "type"]);
  });

  it("mirrors into the address only what differs from it and from the default", () => {
    const view = { ...SUPPLIES_VIEW_DEFAULTS, supplies: ["a"], byMonth: true };
    assert.deepEqual(suppliesViewUrlUpdates(view, reader({ supply: "a" })), { month: "1" });
    assert.equal(suppliesViewUrlUpdates(SUPPLIES_VIEW_DEFAULTS, reader({})), null);
  });

  it("clears the register's filters, leaving the summary's and the grouping", () => {
    assert.deepEqual(registerClearUpdates(), { supply: "", type: "", from: "", to: "", q: "" });
  });
});

describe("registerNarrowings", () => {
  it("names what narrows the register, not the grouping", () => {
    assert.deepEqual(
      registerNarrowings({ ...SUPPLIES_VIEW_DEFAULTS, kinds: ["own"], to: "2026-02-01", q: "  box ", byMonth: true }),
      [
        { key: "kinds", value: ["own"] },
        { key: "dates", from: "", to: "2026-02-01" },
        { key: "q", value: "box" },
      ]
    );
  });
});

describe("pruneStoredSupplies", () => {
  it("drops supplies that no longer exist", () => {
    assert.equal(pruneStoredSupplies("a,gone,b", new Set(["a", "b"])), "a,b");
    assert.equal(pruneStoredSupplies("gone", new Set(["a"])), null);
  });
});

describe("filterSupplySummary", () => {
  const supplies = [
    { name: "C5 envelope", onHand: 503 },
    { name: "C6 envelope", onHand: 0 },
    { name: "Transport card", onHand: 12 },
  ];

  it("filters by name, without regard to case, and to what is on hand", () => {
    assert.deepEqual(filterSupplySummary(supplies, { name: "ENVELOPE", onHand: false }).map((s) => s.name), [
      "C5 envelope",
      "C6 envelope",
    ]);
    assert.deepEqual(filterSupplySummary(supplies, { name: "", onHand: true }).map((s) => s.name), [
      "C5 envelope",
      "Transport card",
    ]);
  });
});
