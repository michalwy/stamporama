import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capBoundedCapacity,
  checklistCoverage,
  duplicateKey,
  pileDepths,
  planLot,
  type LotCandidate,
  type LotChecklist,
  type LotCriteria,
} from "../../src/lib/lot-builder-rules";

// The bulk-lot builder's selection rules (#758): given a pool, the criteria and a seed, which
// copies go into the lot.

function copy(itemId: string, stampId: string, overrides: Partial<LotCandidate> = {}): LotCandidate {
  return {
    itemId,
    stampId,
    variantChain: [stampId],
    conditionId: "cond-mnh",
    formatId: null,
    catalogValue: 1,
    ...overrides,
  };
}

/** A copy of a variant, filed under the stamp the checklist names (#661). */
function variantCopy(itemId: string, stampId: string, parentId: string, overrides: Partial<LotCandidate> = {}) {
  return copy(itemId, stampId, { variantChain: [stampId, parentId], ...overrides });
}

function criteria(overrides: Partial<LotCriteria> = {}): LotCriteria {
  return {
    maxCatalogValue: null,
    count: null,
    catalogValue: null,
    series: "neutral",
    maxPerStamp: null,
    duplicates: "neutral",
    ...overrides,
  };
}

const SEED = "seed-1";

function plan(pool: LotCandidate[], overrides: Partial<Parameters<typeof planLot>[0]> = {}) {
  return planLot({ pool, checklists: [], criteria: criteria(), seed: SEED, ...overrides });
}

function stampsOf(pool: LotCandidate[], itemIds: string[]): string[] {
  const byId = new Map(pool.map((c) => [c.itemId, c.stampId]));
  return itemIds.map((id) => byId.get(id) ?? "?");
}

// A duplicate is a stamp, rolled up through variants ---------------------------

describe("duplicateKey", () => {
  it("is the stamp itself when nothing rolls up", () => {
    assert.equal(duplicateKey(copy("i1", "s226")), "s226");
  });

  it("rolls a variant up to the stamp it is a variant of", () => {
    assert.equal(duplicateKey(variantCopy("i1", "s226yw", "s226")), "s226");
  });

  it("counts a variant and its parent as one pile", () => {
    const pool = [copy("i1", "s226"), copy("i2", "s226"), variantCopy("i3", "s226yw", "s226")];
    assert.deepEqual([...pileDepths(pool)], [["s226", 3]]);
  });
});

describe("capBoundedCapacity", () => {
  it("is the pool with no cap", () => {
    assert.equal(capBoundedCapacity([copy("i1", "a"), copy("i2", "a")], null), 2);
  });

  it("is Σ min(pile, cap)", () => {
    const pool = [copy("i1", "a"), copy("i2", "a"), copy("i3", "a"), copy("i4", "b")];
    assert.equal(capBoundedCapacity(pool, 2), 3);
  });
});

// Coverage: which series the pool can assemble ---------------------------------

const SERIES: LotChecklist = { checklistId: "cl-a", stampIds: ["s1", "s2", "s3"] };

describe("checklistCoverage", () => {
  it("is complete when every slot is covered", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3")];
    assert.deepEqual(checklistCoverage(pool, [SERIES]), [
      { checklistId: "cl-a", requiredCount: 3, coveredCount: 3, complete: true },
    ]);
  });

  it("counts a variant copy as covering its parent's slot", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), variantCopy("i3", "s3yw", "s3")];
    assert.equal(checklistCoverage(pool, [SERIES])[0].complete, true);
  });

  it("is incomplete when a slot has nothing, and says how far it got", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s9")];
    assert.deepEqual(checklistCoverage(pool, [SERIES]), [
      { checklistId: "cl-a", requiredCount: 3, coveredCount: 2, complete: false },
    ]);
  });

  it("gives one copy to the nearest slot only — a variant named on the checklist stays itself", () => {
    // The specialized checklist names both. One piece of paper cannot fill two slots of a set.
    const specialized: LotChecklist = { checklistId: "cl-s", stampIds: ["s226", "s226yw"] };
    const pool = [variantCopy("i1", "s226yw", "s226")];
    assert.deepEqual(checklistCoverage(pool, [specialized]), [
      { checklistId: "cl-s", requiredCount: 2, coveredCount: 1, complete: false },
    ]);
  });

  it("calls an empty checklist incomplete rather than complete", () => {
    assert.equal(checklistCoverage([], [{ checklistId: "cl-0", stampIds: [] }])[0].complete, false);
  });
});

// Pins, rejections, and the ceiling -------------------------------------------

describe("planLot — pins and rejections", () => {
  it("takes pins first and eats the target from the top", () => {
    const pool = [copy("p1", "s1"), copy("i2", "s2"), copy("i3", "s3")];
    const result = plan(pool, { criteria: criteria({ count: { min: 2, max: 2 } }), pinnedItemIds: ["p1"] });
    assert.equal(result.picks.length, 2);
    assert.deepEqual(result.picks[0], { itemId: "p1", phase: "pinned", checklistId: null });
  });

  it("never proposes a rejected copy", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2")];
    const result = plan(pool, { criteria: criteria({ count: { min: 2, max: 2 } }), rejectedItemIds: ["i1"] });
    assert.deepEqual(result.itemIds, ["i2"]);
    assert.equal(result.count.shortBy, 1);
  });

  it("leaves out a copy that is both pinned and rejected", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2")];
    const result = plan(pool, {
      criteria: criteria({ count: { min: 1, max: 1 } }),
      pinnedItemIds: ["i1"],
      rejectedItemIds: ["i1"],
    });
    assert.equal(result.itemIds.includes("i1"), false);
  });

  it("names a pin the pool no longer holds rather than releasing it silently", () => {
    const result = plan([copy("i1", "s1")], { pinnedItemIds: ["gone"] });
    assert.deepEqual(result.missingPinnedItemIds, ["gone"]);
  });

  it("takes a pin over the ceiling — the ceiling guards against accidents, not choices", () => {
    const pool = [copy("p1", "s1", { catalogValue: 500 }), copy("i2", "s2", { catalogValue: 1 })];
    const result = plan(pool, {
      criteria: criteria({ maxCatalogValue: 10, count: { min: 1, max: 1 } }),
      pinnedItemIds: ["p1"],
    });
    assert.deepEqual(result.itemIds, ["p1"]);
  });
});

describe("planLot — the per-copy catalog-value ceiling", () => {
  it("drops what is known to be dear, keeps what is unpriced, and names the unpriced (#378)", () => {
    const pool = [
      copy("dear", "s1", { catalogValue: 50 }),
      copy("cheap", "s2", { catalogValue: 2 }),
      copy("unknown", "s3", { catalogValue: null }),
    ];
    const result = plan(pool, { criteria: criteria({ maxCatalogValue: 10, count: { min: 3, max: null } }) });
    assert.equal(result.itemIds.includes("dear"), false);
    assert.deepEqual([...result.itemIds].sort(), ["cheap", "unknown"]);
    assert.deepEqual(result.unpricedItemIds, ["unknown"]);
    // The unpriced copy is counted as a piece and left out of the sum, never read as zero.
    assert.equal(result.count.value, 2);
    assert.equal(result.catalogValue.value, 2);
  });
});

// The duplicate cap and the duplicate direction --------------------------------

describe("planLot — duplicates", () => {
  const deepPool = () => [
    ...[1, 2, 3, 4, 5].map((n) => copy(`a${n}`, "s226")),
    copy("b1", "s227"),
    copy("c1", "s228"),
    copy("c2", "s228"),
  ];

  it("caps a pile, rolled up through variants", () => {
    const pool = [copy("i1", "s226"), copy("i2", "s226"), variantCopy("i3", "s226yw", "s226"), copy("i4", "s227")];
    const result = plan(pool, { criteria: criteria({ maxPerStamp: 2, count: { min: 4, max: null } }) });
    assert.equal(result.itemIds.length, 3);
    assert.equal(stampsOf(pool, result.itemIds).filter((s) => s !== "s227").length, 2);
    assert.equal(result.count.shortBy, 1);
  });

  it("counts the pins toward the cap", () => {
    const pool = [copy("p1", "s226"), copy("i2", "s226"), copy("i3", "s227")];
    const result = plan(pool, {
      criteria: criteria({ maxPerStamp: 1, count: { min: 3, max: null } }),
      pinnedItemIds: ["p1"],
    });
    assert.deepEqual([...result.itemIds].sort(), ["i3", "p1"]);
  });

  it("preferDuplicates drains the deepest pile first and leaves the single copy for last", () => {
    const pool = deepPool();
    const result = plan(pool, {
      criteria: criteria({ duplicates: "preferDuplicates", maxPerStamp: 2, count: { min: 5, max: null } }),
    });
    assert.deepEqual(stampsOf(pool, result.itemIds), ["s226", "s226", "s228", "s228", "s227"]);
  });

  it("neutral ignores pile depth but still respects the cap", () => {
    const pool = deepPool();
    const result = plan(pool, { criteria: criteria({ maxPerStamp: 2, count: { min: 5, max: null } }) });
    assert.equal(result.itemIds.length, 5);
    for (const depth of pileDepths(pool.filter((c) => result.itemIds.includes(c.itemId))).values()) {
      assert.ok(depth <= 2);
    }
  });
});

// The series pass --------------------------------------------------------------

describe("planLot — a series enters atomically", () => {
  const loose = [copy("x1", "s7"), copy("x2", "s8"), copy("x3", "s9")];

  it("takes a pool-complete checklist whole, and attributes every copy to it", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3"), ...loose];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 3, max: null } }),
    });
    assert.deepEqual(result.takenChecklistIds, ["cl-a"]);
    assert.deepEqual([...result.itemIds].sort(), ["i1", "i2", "i3"]);
    assert.deepEqual(
      result.picks.map((p) => p.phase + ":" + p.checklistId),
      ["series:cl-a", "series:cl-a", "series:cl-a"]
    );
  });

  it("fills a slot with a variant copy", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), variantCopy("i3", "s3yw", "s3")];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 3, max: null } }),
    });
    assert.deepEqual(result.takenChecklistIds, ["cl-a"]);
    assert.equal(result.itemIds.includes("i3"), true);
  });

  it("takes the cheapest copy of a slot, and an unpriced one only when it is alone", () => {
    const pool = [
      copy("s1-dear", "s1", { catalogValue: 8 }),
      copy("s1-cheap", "s1", { catalogValue: 2 }),
      copy("s2-unpriced", "s2", { catalogValue: null }),
      copy("s2-priced", "s2", { catalogValue: 4 }),
      copy("s3-only", "s3", { catalogValue: null }),
    ];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 3, max: null } }),
    });
    assert.deepEqual([...result.itemIds].sort(), ["s1-cheap", "s2-priced", "s3-only"]);
    assert.deepEqual(result.unpricedItemIds, ["s3-only"]);
  });

  it("does not offer a series the pool cannot assemble", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), ...loose];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 2, max: null } }),
    });
    assert.deepEqual(result.takenChecklistIds, []);
    assert.deepEqual(result.refusedChecklists, []);
  });

  it("charges a series nothing for a slot a pin already covers", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3")];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 3, max: 3 } }),
      pinnedItemIds: ["i1"],
    });
    assert.deepEqual(result.takenChecklistIds, ["cl-a"]);
    assert.deepEqual(result.picks.map((p) => p.phase), ["pinned", "series", "series"]);
  });

  it("shares one copy between two checklists rather than refusing the second", () => {
    const other: LotChecklist = { checklistId: "cl-b", stampIds: ["s1", "s4"] };
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3"), copy("i4", "s4")];
    const result = plan(pool, {
      checklists: [SERIES, other],
      criteria: criteria({ series: "preferComplete", count: { min: 4, max: null } }),
    });
    assert.deepEqual([...result.takenChecklistIds].sort(), ["cl-a", "cl-b"]);
    assert.equal(result.itemIds.length, 4);
  });
});

describe("planLot — the cap beats the series", () => {
  // A specialized checklist naming both the stamp and its variant needs two copies of one pile.
  const specialized: LotChecklist = { checklistId: "cl-s", stampIds: ["s226", "s226yw"] };
  const pool = () => [copy("i1", "s226"), variantCopy("i2", "s226yw", "s226"), copy("i3", "s227")];

  it("refuses the series and names the stamp that blocked it", () => {
    const result = plan(pool(), {
      checklists: [specialized],
      criteria: criteria({ series: "preferComplete", maxPerStamp: 1, count: { min: 2, max: null } }),
    });
    assert.deepEqual(result.takenChecklistIds, []);
    assert.deepEqual(result.refusedChecklists, [{ checklistId: "cl-s", reason: "cap", stampId: "s226" }]);
  });

  it("takes it when the cap allows the whole take", () => {
    const result = plan(pool(), {
      checklists: [specialized],
      criteria: criteria({ series: "preferComplete", maxPerStamp: 2, count: { min: 2, max: null } }),
    });
    assert.deepEqual(result.takenChecklistIds, ["cl-s"]);
  });

  it("refuses a series whose take would cross the count max", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3"), copy("x1", "s7")];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferComplete", count: { min: 2, max: 2 } }),
    });
    assert.deepEqual(result.refusedChecklists, [{ checklistId: "cl-a", reason: "target", stampId: null }]);
    assert.equal(result.count.value, 2);
  });

  it("refuses a second series once the target is reached", () => {
    const other: LotChecklist = { checklistId: "cl-b", stampIds: ["s4", "s5"] };
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("i3", "s3"), copy("i4", "s4"), copy("i5", "s5")];
    const result = plan(pool, {
      checklists: [SERIES, other],
      criteria: criteria({ series: "preferComplete", count: { min: 3, max: 3 } }),
    });
    assert.equal(result.takenChecklistIds.length, 1);
    assert.equal(result.refusedChecklists.length, 1);
    assert.equal(result.refusedChecklists[0].reason, "target");
  });
});

describe("planLot — preferSingles protects an assemblable series", () => {
  const pool = () => [
    copy("i1", "s1"),
    copy("i2", "s2"),
    copy("i3", "s3"),
    copy("x1", "s7"),
    copy("x2", "s8"),
    copy("x3", "s9"),
  ];

  it("keeps the series copies back while anything else is left", () => {
    const result = plan(pool(), {
      checklists: [SERIES],
      criteria: criteria({ series: "preferSingles", count: { min: 3, max: null } }),
    });
    assert.deepEqual([...result.itemIds].sort(), ["x1", "x2", "x3"]);
    assert.deepEqual(result.takenChecklistIds, []);
  });

  it("takes them once nothing else is left rather than shrinking the lot", () => {
    const result = plan(pool(), {
      checklists: [SERIES],
      criteria: criteria({ series: "preferSingles", count: { min: 4, max: null } }),
    });
    assert.equal(result.itemIds.length, 4);
    assert.equal(result.count.shortBy, 0);
  });

  it("leaves a series that the pool cannot assemble unprotected", () => {
    const pool = [copy("i1", "s1"), copy("i2", "s2"), copy("x1", "s7")];
    const result = plan(pool, {
      checklists: [SERIES],
      criteria: criteria({ series: "preferSingles", count: { min: 3, max: null } }),
    });
    assert.equal(result.itemIds.length, 3);
  });

  it("neutral neither seeks nor avoids the series", () => {
    const result = plan(pool(), { checklists: [SERIES], criteria: criteria({ count: { min: 6, max: null } }) });
    assert.equal(result.itemIds.length, 6);
    assert.deepEqual(result.takenChecklistIds, []);
  });
});

// Where a range lands ----------------------------------------------------------

describe("planLot — the targets", () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => copy(`i${i}`, `s${i}`, { catalogValue: 4 }));

  it("stops at the min of the count axis", () => {
    const result = plan(ten(), { criteria: criteria({ count: { min: 3, max: 8 } }) });
    assert.equal(result.count.value, 3);
    assert.equal(result.count.withinRange, true);
  });

  it("stops at the min of the value axis", () => {
    const result = plan(ten(), { criteria: criteria({ catalogValue: { min: 10, max: null } }) });
    assert.equal(result.catalogValue.value, 12);
    assert.equal(result.count.value, 3);
  });

  it("fills both axes when both are set", () => {
    const result = plan(ten(), {
      criteria: criteria({ count: { min: 2, max: null }, catalogValue: { min: 20, max: null } }),
    });
    assert.equal(result.count.value, 5);
    assert.equal(result.catalogValue.value, 20);
  });

  it("aims at the max when it is the only bound given", () => {
    const result = plan(ten(), { criteria: criteria({ count: { min: null, max: 4 } }) });
    assert.equal(result.count.value, 4);
  });

  it("never crosses a max, and skips a copy that would rather than stopping", () => {
    const pool = [
      copy("dear", "s1", { catalogValue: 9 }),
      copy("cheap1", "s2", { catalogValue: 1 }),
      copy("cheap2", "s3", { catalogValue: 1 }),
    ];
    const result = plan(pool, { criteria: criteria({ catalogValue: { min: 2, max: 5 } }) });
    assert.equal(result.itemIds.includes("dear"), false);
    assert.equal(result.catalogValue.value, 2);
  });

  it("takes the pins alone when neither axis has a floor", () => {
    const result = plan(ten(), { criteria: criteria({ count: null }), pinnedItemIds: ["i1"] });
    assert.deepEqual(result.itemIds, ["i1"]);
  });

  it("says how far short it fell rather than throwing", () => {
    const result = plan([copy("i1", "s1"), copy("i2", "s2")], { criteria: criteria({ count: { min: 5, max: 6 } }) });
    assert.deepEqual(result.count, {
      value: 2,
      min: 5,
      max: 6,
      shortBy: 3,
      overBy: 0,
      withinRange: false,
    });
  });

  it("reports an overshoot the pins caused", () => {
    const pool = [copy("p1", "s1"), copy("p2", "s2"), copy("p3", "s3")];
    const result = plan(pool, {
      criteria: criteria({ count: { min: 1, max: 2 } }),
      pinnedItemIds: ["p1", "p2", "p3"],
    });
    assert.equal(result.count.overBy, 1);
    assert.equal(result.count.withinRange, false);
  });
});

// Reproducibility --------------------------------------------------------------

describe("planLot — the seed", () => {
  const pool = () => Array.from({ length: 20 }, (_, i) => copy(`i${i}`, `s${i % 7}`, { catalogValue: i % 5 }));

  it("reproduces a pick exactly for a fixed seed", () => {
    const args = { criteria: criteria({ count: { min: 6, max: 9 }, maxPerStamp: 2 }) };
    assert.deepEqual(plan(pool(), args), plan(pool(), args));
  });

  it("does not depend on the order the pool was read in", () => {
    const args = { criteria: criteria({ count: { min: 6, max: 9 }, maxPerStamp: 2 }) };
    const forwards = plan(pool(), args);
    const backwards = plan(pool().reverse(), args);
    assert.deepEqual(backwards.itemIds, forwards.itemIds);
  });

  it("re-rolls to a different pick under a different seed", () => {
    const args = { criteria: criteria({ count: { min: 6, max: 6 } }) };
    const first = planLot({ pool: pool(), checklists: [], seed: "seed-1", ...args });
    const second = planLot({ pool: pool(), checklists: [], seed: "seed-2", ...args });
    assert.notDeepEqual(second.itemIds, first.itemIds);
    assert.equal(second.itemIds.length, 6);
  });

  it("keeps the pins and the rejections across a re-roll", () => {
    const args = { criteria: criteria({ count: { min: 6, max: 6 } }), pinnedItemIds: ["i3"], rejectedItemIds: ["i4"] };
    for (const seed of ["seed-1", "seed-2", "seed-3"]) {
      const result = planLot({ pool: pool(), checklists: [], seed, ...args });
      assert.equal(result.itemIds[0], "i3");
      assert.equal(result.itemIds.includes("i4"), false);
    }
  });
});
