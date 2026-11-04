import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareFreeExtraCandidates,
  freeExtraTotals,
  fromCents,
  orderValueCents,
  parseFreeExtraLimits,
  proposeFreeExtras,
  rankFreeExtraCandidates,
  toCents,
  type FreeExtraCandidate,
} from "../../src/lib/free-extra-rules";

// Free extras on a sale (#2408): the limits as typed, the ranking and the proposal.

function candidate(itemNo: number, value: string, listed = false): FreeExtraCandidate {
  return { itemId: `i${itemNo}`, itemNo, valueCents: toCents(value), listed };
}

describe("orderValueCents", () => {
  it("sums the paid lines and leaves the free extras out", () => {
    assert.equal(
      orderValueCents([
        { price: "12.50", freeExtra: false },
        { price: "7.50", freeExtra: false },
        { price: "0", freeExtra: true },
      ]),
      2000
    );
  });
});

describe("parseFreeExtraLimits", () => {
  it("requires at least one limit", () => {
    const r = parseFreeExtraLimits({ count: " ", budget: "", budgetKind: "amount" }, 1000);
    assert.equal(r.ok, false);
  });

  it("reads a count alone, the budget left open", () => {
    const r = parseFreeExtraLimits({ count: "3", budget: "", budgetKind: "amount" }, 1000);
    assert.deepEqual(r, { ok: true, limits: { count: 3, budgetCents: null } });
  });

  it("refuses a count that is not a positive whole number", () => {
    for (const count of ["0", "1.5", "-2", "two"]) {
      const r = parseFreeExtraLimits({ count, budget: "", budgetKind: "amount" }, 1000);
      assert.equal(r.ok, false, count);
    }
  });

  it("reads an amount budget in cents, a comma accepted", () => {
    const r = parseFreeExtraLimits({ count: "", budget: "2,50", budgetKind: "amount" }, 1000);
    assert.deepEqual(r, { ok: true, limits: { count: null, budgetCents: 250 } });
  });

  it("takes a percentage budget of the order, rounded down to the cent", () => {
    const r = parseFreeExtraLimits({ count: "", budget: "10", budgetKind: "percent" }, 4555);
    assert.deepEqual(r, { ok: true, limits: { count: null, budgetCents: 455 } });
  });

  it("refuses a budget of zero or below", () => {
    for (const budgetKind of ["amount", "percent"] as const) {
      const r = parseFreeExtraLimits({ count: "", budget: "0", budgetKind }, 1000);
      assert.equal(r.ok, false, budgetKind);
    }
  });
});

describe("rankFreeExtraCandidates", () => {
  it("puts the lowest value first", () => {
    const ranked = rankFreeExtraCandidates([candidate(1, "2.00"), candidate(2, "0.50"), candidate(3, "1.00")]);
    assert.deepEqual(ranked.map((c) => c.itemNo), [2, 3, 1]);
  });

  it("puts an unlisted copy before a listed one only at equal value", () => {
    const ranked = rankFreeExtraCandidates([
      candidate(1, "1.00", true),
      candidate(2, "1.00", false),
      candidate(3, "0.90", true),
    ]);
    assert.deepEqual(ranked.map((c) => c.itemNo), [3, 2, 1]);
  });

  it("breaks a full tie by copy number, so the proposal is stable", () => {
    assert.ok(compareFreeExtraCandidates(candidate(4, "1.00"), candidate(9, "1.00")) < 0);
  });
});

describe("proposeFreeExtras", () => {
  const ranked = rankFreeExtraCandidates([
    candidate(1, "0.50"),
    candidate(2, "0.50", true),
    candidate(3, "1.00"),
    candidate(4, "2.00"),
  ]);

  it("takes no more copies than the count", () => {
    assert.deepEqual(proposeFreeExtras(ranked, { count: 2, budgetCents: null }), ["i1", "i2"]);
  });

  it("keeps the total within the budget", () => {
    assert.deepEqual(proposeFreeExtras(ranked, { count: null, budgetCents: 200 }), ["i1", "i2", "i3"]);
  });

  it("respects both limits at once", () => {
    assert.deepEqual(proposeFreeExtras(ranked, { count: 2, budgetCents: 75 }), ["i1"]);
  });

  it("takes a copy worth exactly what is left of the budget", () => {
    assert.deepEqual(proposeFreeExtras(ranked, { count: null, budgetCents: 100 }), ["i1", "i2"]);
  });

  it("proposes nothing when no copy fits", () => {
    assert.deepEqual(proposeFreeExtras(ranked, { count: 3, budgetCents: 10 }), []);
  });

  it("passes over a copy that does not fit in an order it was not ranked in", () => {
    const unranked = [candidate(4, "2.00"), candidate(1, "0.50")];
    assert.deepEqual(proposeFreeExtras(unranked, { count: null, budgetCents: 100 }), ["i1"]);
  });
});

describe("freeExtraTotals", () => {
  it("sums the ticked copies and says which limit they go over", () => {
    const t = freeExtraTotals([candidate(1, "1.00"), candidate(2, "1.50")], { count: 1, budgetCents: 300 });
    assert.deepEqual(t, { count: 2, valueCents: 250, overCount: true, overBudget: false });
    assert.equal(fromCents(t.valueCents), "2.50");
  });

  it("is over nothing before a proposal was made", () => {
    const t = freeExtraTotals([candidate(1, "9.00")], null);
    assert.equal(t.overCount || t.overBudget, false);
  });
});
