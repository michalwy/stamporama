import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETENESS_DISPOSITION_CHIPS,
  completenessPercent,
  copyMatchesDispositions,
  dispositionChipsValue,
  dispositionChipsWhere,
  incompleteClosestFirst,
  readConditionIds,
  readDispositionChips,
  summarizeCompleteness,
  toggleDispositionChip,
} from "../../src/lib/completeness-screen-rules";

// The Completeness screen's pure half (#2266).

const ALL = [...COMPLETENESS_DISPOSITION_CHIPS];

describe("disposition chips", () => {
  it("reads an absent or unknown value as every chip on", () => {
    assert.deepEqual(readDispositionChips(null), ALL);
    assert.deepEqual(readDispositionChips(""), ALL);
    assert.deepEqual(readDispositionChips("sold,lost"), ALL);
  });

  it("reads the chips named, in the screen's order", () => {
    assert.deepEqual(readDispositionChips("none,in-collection"), ["in-collection", "none"]);
  });

  it("leaves every chip on out of the address", () => {
    assert.equal(dispositionChipsValue(ALL), "");
    assert.equal(dispositionChipsValue(["for-trade", "for-sale"]), "for-sale,for-trade");
  });

  it("switches a chip off and on, but keeps the last one on", () => {
    assert.deepEqual(toggleDispositionChip(ALL, "for-sale"), ["in-collection", "for-trade", "none"]);
    assert.deepEqual(toggleDispositionChip(["none"], "for-sale"), ["for-sale", "none"]);
    assert.deepEqual(toggleDispositionChip(["none"], "none"), ["none"]);
  });

  it("counts a copy carrying any chip that is on, None being no disposition at all", () => {
    const undecided = { inCollection: false, forSale: false, forTrade: false };
    const keptAndForSale = { inCollection: true, forSale: true, forTrade: false };
    assert.equal(copyMatchesDispositions(undecided, ["none"]), true);
    assert.equal(copyMatchesDispositions(undecided, ["in-collection", "for-sale"]), false);
    assert.equal(copyMatchesDispositions(keptAndForSale, ["for-sale"]), true);
    assert.equal(copyMatchesDispositions(keptAndForSale, ["none", "for-trade"]), false);
  });

  it("narrows nothing with every chip on, and ORs the chips otherwise", () => {
    assert.equal(dispositionChipsWhere(ALL), null);
    assert.deepEqual(dispositionChipsWhere(["for-sale", "none"]), {
      OR: [{ forSale: true }, { inCollection: false, forSale: false, forTrade: false }],
    });
  });
});

describe("condition ids", () => {
  it("reads an empty value as every condition", () => {
    assert.deepEqual(readConditionIds(null), []);
    assert.deepEqual(readConditionIds(""), []);
    assert.deepEqual(readConditionIds("a,b,a"), ["a", "b"]);
  });
});

describe("summarizeCompleteness", () => {
  it("sums stamps per checklist and counts the complete ones, leaving empty ones out", () => {
    assert.deepEqual(
      summarizeCompleteness([
        { owned: 11, requiredCount: 12 },
        { owned: 3, requiredCount: 3 },
        { owned: 0, requiredCount: 0 },
      ]),
      { held: 14, total: 15, completeChecklists: 1, checklists: 2 }
    );
  });
});

describe("completenessPercent", () => {
  it("rounds down, so nothing reads complete before it is", () => {
    assert.equal(completenessPercent(199, 200), 99);
    assert.equal(completenessPercent(200, 200), 100);
    assert.equal(completenessPercent(0, 0), null);
  });
});

describe("incompleteClosestFirst", () => {
  const row = (name: string, owned: number, requiredCount: number, issueYear: number | null = 1950) => ({
    name,
    owned,
    requiredCount,
    issueYear,
    issueName: "Issue",
  });

  it("drops complete and empty checklists and lists the larger share first, then the smaller gap", () => {
    const ordered = incompleteClosestFirst([
      row("half", 1, 2),
      row("complete", 3, 3),
      row("empty", 0, 0),
      row("eleven", 11, 12),
      row("half of twenty", 10, 20),
    ]);
    assert.deepEqual(
      ordered.map((r) => r.name),
      ["eleven", "half", "half of twenty"]
    );
  });

  it("breaks a tie by the issue's year, then the names", () => {
    const ordered = incompleteClosestFirst([
      row("b", 1, 2, 1960),
      row("a", 1, 2, null),
      row("c", 1, 2, 1950),
    ]);
    assert.deepEqual(
      ordered.map((r) => r.name),
      ["c", "b", "a"]
    );
  });
});
