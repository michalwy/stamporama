import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asCompletenessFilter,
  hasCompletenessChips,
  issueMatchesCompleteness,
  type ChecklistCompletenessFigures,
} from "../../src/lib/completeness-filter";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import { REMEMBERED_FILTER_KEYS } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// The Copies list's *Complete* filter (#1884) — the pure half: what a query-string value reads as,
// and which issues each value keeps, from the figures the issue group header's chips are drawn from.

/** One checklist of `required` stamps: `any` held in some condition, `perCondition` per condition. */
function checklist(required: number, any: number, perCondition: number[]): ChecklistCompletenessFigures {
  return { requiredCount: required, owned: any, conditions: perCondition.map((owned) => ({ owned })) };
}

describe("asCompletenessFilter", () => {
  it("reads the three values the filter has", () => {
    assert.equal(asCompletenessFilter("any"), "any");
    assert.equal(asCompletenessFilter("one"), "one");
    assert.equal(asCompletenessFilter("incomplete"), "incomplete");
  });

  it("reads anything else as no filter, never as an unmatchable one", () => {
    for (const value of [null, undefined, "", "all", "ANY", "true"]) {
      assert.equal(asCompletenessFilter(value), undefined, String(value));
    }
  });
});

describe("issueMatchesCompleteness", () => {
  it("keeps a set held whole in mixed conditions under *any*, not under *one*", () => {
    // MNH 1/12 · MH 11/12 — Any 12/12, the case #1859 drew the chip for.
    const mixed = [checklist(12, 12, [1, 11])];
    assert.equal(issueMatchesCompleteness(mixed, "any"), true);
    assert.equal(issueMatchesCompleteness(mixed, "one"), false);
    assert.equal(issueMatchesCompleteness(mixed, "incomplete"), false);
  });

  it("keeps a set held whole in one condition under both complete values", () => {
    const whole = [checklist(5, 5, [5, 2])];
    assert.equal(issueMatchesCompleteness(whole, "any"), true);
    assert.equal(issueMatchesCompleteness(whole, "one"), true);
    assert.equal(issueMatchesCompleteness(whole, "incomplete"), false);
  });

  it("keeps a set short of a stamp under *incomplete* only", () => {
    const short = [checklist(5, 4, [4])];
    assert.equal(issueMatchesCompleteness(short, "any"), false);
    assert.equal(issueMatchesCompleteness(short, "one"), false);
    assert.equal(issueMatchesCompleteness(short, "incomplete"), true);
  });

  it("lets any one checklist decide for an issue carrying several", () => {
    // The collector, 2026-10-13: a basic set complete beside an unfinished finer one is complete.
    const basicDone = [checklist(4, 4, [4]), checklist(9, 6, [6])];
    assert.equal(issueMatchesCompleteness(basicDone, "any"), true);
    assert.equal(issueMatchesCompleteness(basicDone, "one"), true);
    assert.equal(issueMatchesCompleteness(basicDone, "incomplete"), false);
  });

  it("leaves an issue with no chips out of every value", () => {
    // No checklist; an empty one; one with nothing held — none of them draws a chip line.
    for (const sets of [[], [checklist(0, 0, [])], [checklist(6, 0, [])]]) {
      for (const value of ["any", "one", "incomplete"] as const) {
        assert.equal(issueMatchesCompleteness(sets, value), false, `${JSON.stringify(sets)} ${value}`);
      }
    }
  });

  it("judges only the checklists that draw chips", () => {
    // An untouched specialised list beside a finished basic one does not make the issue incomplete.
    const sets = [checklist(3, 3, [3]), checklist(8, 0, [])];
    assert.equal(issueMatchesCompleteness(sets, "incomplete"), false);
    assert.equal(hasCompletenessChips(sets[1]), false);
  });
});

describe("the filter round-trips through the URL", () => {
  it("reaches the server's filter set from the query string the list writes", () => {
    assert.equal(readItemFilters(new URLSearchParams("complete=any")).complete, "any");
    assert.equal(readItemFilters(new URLSearchParams("complete=one")).complete, "one");
    assert.equal(readItemFilters(new URLSearchParams("complete=incomplete")).complete, "incomplete");
  });

  it("is absent from a link that does not name it, or names nonsense", () => {
    assert.equal(readItemFilters(new URLSearchParams("")).complete, undefined);
    assert.equal(readItemFilters(new URLSearchParams("complete=all")).complete, undefined);
  });

  it("is remembered with the list's other filters, so Reset filters clears it", () => {
    assert.ok((REMEMBERED_FILTER_KEYS as readonly string[]).includes("complete"));
  });
});
