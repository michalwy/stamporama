import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freeExtraProposal,
  resolveFreeExtraLimits,
  type FreeExtraCandidatesSource,
  type FreeExtraCopySource,
} from "../../src/lib/agent-api/free-extra-reads";
import { isApiError } from "../../src/lib/agent-api/errors";

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(isApiError(error), `expected an ApiError, got ${String(error)}`);
    return error.message;
  }
  assert.fail("expected a refusal");
}

function copy(itemNo: number, value: string, listed = false): FreeExtraCopySource {
  return {
    item: {
      id: `c${itemNo}`,
      itemNo,
      stampName: `Stamp ${itemNo}`,
      issueName: null,
      issueYear: 1960,
      conditionName: "Used",
      certificateStatusName: null,
      formatName: null,
    },
    value,
    listed,
  };
}

const NO_LIMITS = { count: null, budget: null, budgetPercent: null };

function source(over: Partial<FreeExtraCandidatesSource> = {}): FreeExtraCandidatesSource {
  return {
    currency: "PLN",
    orderValue: "100.00",
    series: [],
    candidates: [copy(1, "0.50"), copy(2, "1.00"), copy(3, "1.00", true), copy(4, "2.00")],
    unvaluedCount: 0,
    truncated: false,
    platformDefaults: null,
    contactTerms: null,
    ...over,
  };
}

const TERMS = { minimumOrder: "50.00", budgetPercent: "2", maximumBudget: "10.00", convertedFrom: null };

describe("the limits find_free_extras proposes within (#2532)", () => {
  it("takes the terms' budget when the call states none, and nothing when neither does", () => {
    assert.deepEqual(resolveFreeExtraLimits(NO_LIMITS, 250, 10000), { count: null, budgetCents: 250 });
    assert.equal(resolveFreeExtraLimits(NO_LIMITS, null, 10000), null);
  });

  it("sets a count beside the terms' budget, as the dialog's typed count does", () => {
    assert.deepEqual(resolveFreeExtraLimits({ ...NO_LIMITS, count: 2 }, 250, 10000), { count: 2, budgetCents: 250 });
  });

  it("replaces the terms' budget with an amount or a percentage, and drops it with none", () => {
    assert.deepEqual(resolveFreeExtraLimits({ ...NO_LIMITS, budget: "3,50" }, 250, 10000), {
      count: null,
      budgetCents: 350,
    });
    assert.deepEqual(resolveFreeExtraLimits({ ...NO_LIMITS, budgetPercent: "5" }, 250, 10000), {
      count: null,
      budgetCents: 500,
    });
    assert.deepEqual(resolveFreeExtraLimits({ ...NO_LIMITS, count: 3, budget: "none" }, 250, 10000), {
      count: 3,
      budgetCents: null,
    });
    assert.equal(resolveFreeExtraLimits({ ...NO_LIMITS, budget: "none" }, 250, 10000), null);
  });

  it("refuses both budgets at once, and a figure the dialog refuses, with its sentence", () => {
    assert.match(refusal(() => resolveFreeExtraLimits({ ...NO_LIMITS, budget: "5", budgetPercent: "5" }, null, 0)), /not both/);
    assert.match(refusal(() => resolveFreeExtraLimits({ ...NO_LIMITS, count: 0 }, null, 0)), /"count": .*at least 1/);
    assert.match(refusal(() => resolveFreeExtraLimits({ ...NO_LIMITS, budget: "0" }, null, 0)), /"budget": The budget must be an amount above 0/);
    assert.match(
      refusal(() => resolveFreeExtraLimits({ ...NO_LIMITS, budgetPercent: "x" }, null, 0)),
      /"budget_percent": The budget must be a percentage above 0/
    );
  });
});

describe("what find_free_extras answers (#2532)", () => {
  it("proposes the cheapest copies within the terms' budget — the percentage capped, the buyer's better term winning", () => {
    const proposal = freeExtraProposal(
      "s1",
      source({
        platformDefaults: { ...TERMS, platformName: "Facebook" },
        contactTerms: { minimumOrder: null, budgetPercent: "3", maximumBudget: null, convertedFrom: null, contactName: "Jan" },
      }),
      NO_LIMITS
    );
    // 3% of 100.00 is 3.00 (the buyer's percentage beats the platform's 2%), under the 10.00 cap.
    assert.equal(proposal.terms.due, "due");
    assert.equal(proposal.terms.budget, "3.00");
    assert.equal(proposal.terms.sources?.budgetPercent, "contact");
    assert.deepEqual(proposal.limits, { count: null, budget: "3.00" });
    // 0.50 + 1.00 (the unlisted one first) + … the listed 1.00 brings it to 2.50; 2.00 would go over.
    assert.deepEqual(
      proposal.copies.map((c) => c.copyNo),
      ["#1", "#2", "#3"]
    );
    assert.equal(proposal.count, 3);
    assert.equal(proposal.value, "2.50");
    assert.equal(proposal.copies[2].listed, true);
    assert.equal(proposal.copies[0].issue, undefined, "an absent field is left out, not null");
  });

  it("proposes nothing below the terms' minimum unless the call states a limit", () => {
    const below = source({ orderValue: "20.00", platformDefaults: { ...TERMS, platformName: "Facebook" } });
    const none = freeExtraProposal("s1", below, NO_LIMITS);
    assert.equal(none.terms.due, "below-minimum");
    assert.equal(none.limits, null);
    assert.deepEqual([...none.copies, ...none.series], []);
    assert.equal(none.value, "0.00");
    const counted = freeExtraProposal("s1", below, { ...NO_LIMITS, count: 2 });
    assert.deepEqual(
      counted.copies.map((c) => c.copyNo),
      ["#1", "#2"]
    );
  });

  it("proposes a complete series whole, before loose copies, and never part of one", () => {
    const series = [{ key: "k1:10", title: "Birds · Set", value: "1.50", copies: [copy(10, "0.75"), copy(11, "0.75")] }];
    const proposal = freeExtraProposal("s1", source({ series }), { ...NO_LIMITS, count: 3 });
    assert.deepEqual(
      proposal.series.map((s) => [s.title, s.copies.map((c) => c.copyNo)]),
      [["Birds · Set", ["#10", "#11"]]]
    );
    assert.deepEqual(
      proposal.copies.map((c) => c.copyNo),
      ["#1"]
    );
    assert.equal(proposal.count, 3);
    // A count of one leaves the series out whole rather than taking half of it.
    const one = freeExtraProposal("s1", source({ series }), { ...NO_LIMITS, count: 1 });
    assert.deepEqual(one.series, []);
    assert.deepEqual(
      one.copies.map((c) => c.copyNo),
      ["#1"]
    );
  });
});
