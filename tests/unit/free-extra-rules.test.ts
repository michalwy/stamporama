import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareFreeExtraCandidates,
  freeExtraSummary,
  readFreeExtraLimits,
  fromCents,
  orderValueCents,
  parseFreeExtraLimits,
  prefillFreeExtras,
  combineFreeExtraTerms,
  freeExtraTermsSummary,
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

// The summary (#2419): budget, ticked and left, side by side, read off the fields as typed.
describe("readFreeExtraLimits", () => {
  it("reads each field on its own, a percentage taken of the order", () => {
    assert.deepEqual(readFreeExtraLimits({ count: "3", budget: "10", budgetKind: "percent" }, 4555), {
      count: 3,
      budgetCents: 455,
    });
  });

  it("takes a blank or unfinished field as no limit, and keeps the other", () => {
    assert.deepEqual(readFreeExtraLimits({ count: "", budget: "2,50", budgetKind: "amount" }, 0), {
      count: null,
      budgetCents: 250,
    });
    assert.deepEqual(readFreeExtraLimits({ count: "4", budget: "0", budgetKind: "amount" }, 1000), {
      count: 4,
      budgetCents: null,
    });
    assert.deepEqual(readFreeExtraLimits({ count: "", budget: "", budgetKind: "amount" }, 1000), {
      count: null,
      budgetCents: null,
    });
  });
});

describe("freeExtraSummary", () => {
  it("sets the ticked copies against each limit, with what is left", () => {
    const s = freeExtraSummary([candidate(1, "1.00"), candidate(2, "1.50")], { count: 5, budgetCents: 300 });
    assert.deepEqual(s, {
      count: 2,
      valueCents: 250,
      countLimit: { limit: 5, left: 3, over: false },
      budget: { limit: 300, left: 50, over: false },
    });
  });

  it("says by how much the ticks go over a limit", () => {
    const s = freeExtraSummary([candidate(1, "1.00"), candidate(2, "1.50")], { count: 1, budgetCents: 200 });
    assert.deepEqual(s.countLimit, { limit: 1, left: -1, over: true });
    assert.deepEqual(s.budget, { limit: 200, left: -50, over: true });
    assert.equal(fromCents(-s.budget!.left), "0.50");
  });

  it("is exactly at a limit without going over it", () => {
    const s = freeExtraSummary([candidate(1, "3.00")], { count: 1, budgetCents: 300 });
    assert.equal(s.countLimit?.over, false);
    assert.equal(s.budget?.over, false);
    assert.equal(s.budget?.left, 0);
  });

  it("with neither limit given, only sums the ticked copies", () => {
    const s = freeExtraSummary([candidate(1, "9.00")], { count: null, budgetCents: null });
    assert.deepEqual(s, { count: 1, valueCents: 900, countLimit: null, budget: null });
  });
});

// A platform's free-extras settings (#2409): what the dialog opens with.
describe("prefillFreeExtras", () => {
  const rule = (min: string | null, pct: number | null, max: string | null) => ({
    minimumOrderCents: min == null ? null : toCents(min),
    budgetPercent: pct,
    maximumBudgetCents: max == null ? null : toCents(max),
  });

  it("opens empty for a platform that states nothing", () => {
    assert.deepEqual(prefillFreeExtras(null, toCents("50.00")), { kind: "none" });
    assert.deepEqual(prefillFreeExtras(rule(null, null, null), toCents("50.00")), { kind: "none" });
  });

  it("takes the percentage of the order, rounded down to the cent", () => {
    assert.deepEqual(prefillFreeExtras(rule(null, 5, null), toCents("33.33")), {
      kind: "due",
      budgetCents: 166,
      capped: false,
    });
  });

  it("caps the percentage at the maximum", () => {
    assert.deepEqual(prefillFreeExtras(rule(null, 10, "3.00"), toCents("50.00")), {
      kind: "due",
      budgetCents: 300,
      capped: true,
    });
    assert.deepEqual(prefillFreeExtras(rule(null, 10, "6.00"), toCents("50.00")), {
      kind: "due",
      budgetCents: 500,
      capped: false,
    });
  });

  it("with the maximum alone, the maximum is the budget", () => {
    assert.deepEqual(prefillFreeExtras(rule(null, null, "4.00"), toCents("50.00")), {
      kind: "due",
      budgetCents: 400,
      capped: false,
    });
  });

  it("under the minimum order, no free extra is due and no budget is filled in", () => {
    assert.deepEqual(prefillFreeExtras(rule("40.00", 10, "3.00"), toCents("39.99")), {
      kind: "below-minimum",
      minimumOrderCents: 4000,
    });
    // At the minimum it is due.
    assert.equal(prefillFreeExtras(rule("40.00", 10, "3.00"), toCents("40.00")).kind, "due");
  });

  it("states free extras due with no budget where the platform gives only a minimum", () => {
    assert.deepEqual(prefillFreeExtras(rule("40.00", null, null), toCents("50.00")), {
      kind: "due",
      budgetCents: null,
      capped: false,
    });
  });

  it("fills nothing in where the percentage comes to under a cent", () => {
    assert.deepEqual(prefillFreeExtras(rule(null, 1, null), toCents("0.50")), {
      kind: "due",
      budgetCents: null,
      capped: false,
    });
  });
});

// A contact's own terms (#2416): each field the better for the buyer of the two that are set.
describe("combineFreeExtraTerms", () => {
  const terms = (min: number | null, pct: number | null, max: number | null) => ({
    minimumOrderCents: min,
    budgetPercent: pct,
    maximumBudgetCents: max,
  });

  it("is null where neither side states anything", () => {
    assert.equal(combineFreeExtraTerms(null, null), null);
  });

  it("is the platform's alone where the contact states none", () => {
    assert.deepEqual(combineFreeExtraTerms(terms(4000, 5, 300), null), {
      terms: terms(4000, 5, 300),
      sources: { minimumOrder: "platform", budgetPercent: "platform", maximumBudget: "platform" },
    });
  });

  it("takes the lower minimum, the higher percentage and the higher maximum", () => {
    assert.deepEqual(combineFreeExtraTerms(terms(4000, 5, 300), terms(2000, 10, 200)), {
      terms: terms(2000, 10, 300),
      sources: { minimumOrder: "contact", budgetPercent: "contact", maximumBudget: "platform" },
    });
    assert.deepEqual(combineFreeExtraTerms(terms(2000, 10, 200), terms(4000, 5, 300)), {
      terms: terms(2000, 10, 300),
      sources: { minimumOrder: "platform", budgetPercent: "platform", maximumBudget: "contact" },
    });
  });

  it("keeps the platform's at a tie — the contact improves on nothing", () => {
    assert.deepEqual(combineFreeExtraTerms(terms(4000, 5, 300), terms(4000, 5, 300))?.sources, {
      minimumOrder: "platform",
      budgetPercent: "platform",
      maximumBudget: "platform",
    });
  });

  it("uses the platform's for a field the contact leaves empty, and the contact's where only it sets one", () => {
    // An empty field is not read as "no minimum" or "no cap": it takes no part.
    assert.deepEqual(combineFreeExtraTerms(terms(4000, null, 300), terms(null, 10, null)), {
      terms: terms(4000, 10, 300),
      sources: { minimumOrder: "platform", budgetPercent: "contact", maximumBudget: "platform" },
    });
    assert.deepEqual(combineFreeExtraTerms(null, terms(null, 10, 500)), {
      terms: terms(null, 10, 500),
      sources: { minimumOrder: null, budgetPercent: "contact", maximumBudget: "contact" },
    });
  });

  it("prefills from the combined terms", () => {
    const combined = combineFreeExtraTerms(terms(4000, 5, 300), terms(2000, 10, null));
    // 30.00 is under the platform's minimum but not the contact's: 10% of it, capped at 3.00.
    assert.deepEqual(prefillFreeExtras(combined?.terms ?? null, toCents("30.00")), {
      kind: "due",
      budgetCents: 300,
      capped: false,
    });
  });
});

describe("freeExtraTermsSummary", () => {
  it("lists what is set, and is null for none", () => {
    assert.equal(
      freeExtraTermsSummary(
        { freeExtrasMinimumOrder: "50.00", freeExtrasBudgetPercent: "10", freeExtrasMaximumBudget: "5.00" },
        "PLN"
      ),
      "10% of the order · at most 5.00 PLN · from an order of 50.00 PLN"
    );
    assert.equal(
      freeExtraTermsSummary(
        { freeExtrasMinimumOrder: null, freeExtrasBudgetPercent: null, freeExtrasMaximumBudget: null },
        "PLN"
      ),
      null
    );
  });
});
