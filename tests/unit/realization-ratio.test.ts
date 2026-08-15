import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RATIO_SAMPLE,
  ratioBucketLabel,
  resolveRealizationRatio,
  type RatioObservation,
  type RatioSubject,
} from "../../src/lib/realization-ratio";

// The learned realization ratio (#520; ADR-0029 §2). Everything here is the ladder and the median —
// the datapoints, their catalogue values and the areas they belong to are the domain layer's job,
// which is the whole reason the module is pure.

let seq = 0;

/** One recorded ratio, with the parts a test does not care about filled in. */
function obs(overrides: Partial<RatioObservation> = {}): RatioObservation {
  return {
    lotId: `lot-${++seq}`,
    lineId: `line-${seq}`,
    split: false,
    ratio: 0.5,
    areaId: "poland",
    conditionId: "mnh",
    issuedYear: 1950,
    ...overrides,
  };
}

/** The line being anchored: a 1950 Polish MNH stamp unless a test says otherwise. */
function subject(overrides: Partial<RatioSubject> = {}): RatioSubject {
  return { areaId: "poland", conditionId: "mnh", issuedYear: 1950, ...overrides };
}

const FALLBACK = 100;

describe("resolveRealizationRatio — the ladder", () => {
  it("takes the most specific bucket once it holds the minimum sample", () => {
    const observations = [
      obs({ ratio: 0.4 }),
      obs({ ratio: 0.5 }),
      obs({ ratio: 0.6 }),
      // Broader evidence that would pull the figure the other way if the narrow bucket lost.
      obs({ ratio: 0.9, conditionId: "used" }),
      obs({ ratio: 0.9, conditionId: "used" }),
      obs({ ratio: 0.9, conditionId: "used" }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.level, "area-condition-period");
    assert.equal(resolved.ratio, 0.5);
    assert.equal(resolved.n, 3);
    assert.deepEqual([resolved.fromYear, resolved.toYear], [1948, 1952]);
  });

  it("falls through to area × condition when the period bucket is short", () => {
    const observations = [
      obs({ ratio: 0.4, issuedYear: 1950 }),
      obs({ ratio: 0.6, issuedYear: 1950 }),
      // Same area and condition, well outside the window — enough to carry bucket 2 only.
      obs({ ratio: 0.8, issuedYear: 1980 }),
      obs({ ratio: 1.0, issuedYear: 1980 }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.level, "area-condition");
    assert.equal(resolved.n, 4);
    assert.equal(resolved.ratio, 0.7);
    assert.deepEqual([resolved.fromYear, resolved.toYear], [null, null]);
  });

  it("falls through to area — condition drops out before area does", () => {
    const observations = [
      obs({ ratio: 0.2, conditionId: "used", issuedYear: 1900 }),
      obs({ ratio: 0.4, conditionId: "used", issuedYear: 1900 }),
      obs({ ratio: 0.6, conditionId: "fine", issuedYear: 1900 }),
      // Another area entirely, which bucket 3 must not reach.
      obs({ ratio: 9, areaId: "germany" }),
      obs({ ratio: 9, areaId: "germany" }),
      obs({ ratio: 9, areaId: "germany" }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.level, "area");
    assert.equal(resolved.n, 3);
    assert.equal(resolved.ratio, 0.4);
  });

  it("falls through to the whole collection when the area has too little", () => {
    const observations = [
      obs({ ratio: 0.3, areaId: "germany" }),
      obs({ ratio: 0.5, areaId: "germany" }),
      obs({ ratio: 0.7, areaId: "france" }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.level, "collection");
    assert.equal(resolved.n, 3);
    assert.equal(resolved.ratio, 0.5);
  });

  it("falls back to the configured percentage when nothing has been learned", () => {
    const observations = [obs({ ratio: 0.4 }), obs({ ratio: 0.6 })];
    const resolved = resolveRealizationRatio(subject(), observations, 80);
    assert.equal(resolved.level, "fallback");
    assert.equal(resolved.ratio, 0.8);
    assert.equal(resolved.n, 0);
  });

  it("falls back with no evidence at all", () => {
    const resolved = resolveRealizationRatio(subject(), [], FALLBACK);
    assert.deepEqual(resolved, {
      ratio: 1,
      level: "fallback",
      n: 0,
      observations: [],
      fromYear: null,
      toYear: null,
    });
  });

  it("needs exactly MIN_RATIO_SAMPLE, not more", () => {
    const observations = Array.from({ length: MIN_RATIO_SAMPLE }, () => obs({ ratio: 0.5 }));
    assert.equal(resolveRealizationRatio(subject(), observations, FALLBACK).level, "area-condition-period");
    assert.equal(
      resolveRealizationRatio(subject(), observations.slice(1), FALLBACK).level,
      "fallback"
    );
  });
});

describe("resolveRealizationRatio — the ±2-year window", () => {
  it("includes both edges and excludes the year past them", () => {
    const inside = [
      obs({ ratio: 0.5, issuedYear: 1948 }),
      obs({ ratio: 0.5, issuedYear: 1952 }),
      obs({ ratio: 0.5, issuedYear: 1950 }),
    ];
    assert.equal(
      resolveRealizationRatio(subject(), inside, FALLBACK).level,
      "area-condition-period"
    );

    const outside = [
      obs({ ratio: 0.5, issuedYear: 1947 }),
      obs({ ratio: 0.5, issuedYear: 1953 }),
      obs({ ratio: 0.5, issuedYear: 1950 }),
    ];
    // Two of the three fall outside, so the period bucket is short and the broader one answers.
    assert.equal(resolveRealizationRatio(subject(), outside, FALLBACK).level, "area-condition");
  });

  it("slides with the stamp — two adjacent years resolve different samples", () => {
    const observations = [
      obs({ ratio: 0.2, issuedYear: 1946 }),
      obs({ ratio: 0.2, issuedYear: 1947 }),
      obs({ ratio: 0.2, issuedYear: 1948 }),
      obs({ ratio: 0.9, issuedYear: 1951 }),
      obs({ ratio: 0.9, issuedYear: 1952 }),
      obs({ ratio: 0.9, issuedYear: 1953 }),
    ];
    const early = resolveRealizationRatio(subject({ issuedYear: 1946 }), observations, FALLBACK);
    assert.equal(early.level, "area-condition-period");
    assert.equal(early.ratio, 0.2);

    const late = resolveRealizationRatio(subject({ issuedYear: 1953 }), observations, FALLBACK);
    assert.equal(late.level, "area-condition-period");
    assert.equal(late.ratio, 0.9);
  });

  it("skips the period bucket for a stamp with no issue year", () => {
    const observations = [
      obs({ ratio: 0.4 }),
      obs({ ratio: 0.5 }),
      obs({ ratio: 0.6 }),
    ];
    const resolved = resolveRealizationRatio(subject({ issuedYear: null }), observations, FALLBACK);
    assert.equal(resolved.level, "area-condition");
    assert.equal(resolved.n, 3);
  });

  it("ignores observations with no issue year inside the period bucket", () => {
    const observations = [
      obs({ ratio: 0.5, issuedYear: 1950 }),
      obs({ ratio: 0.5, issuedYear: null }),
      obs({ ratio: 0.5, issuedYear: null }),
    ];
    // Only one of the three can be placed in a period, so bucket 1 is short.
    assert.equal(resolveRealizationRatio(subject(), observations, FALLBACK).level, "area-condition");
  });
});

describe("resolveRealizationRatio — missing axes and unusable ratios", () => {
  it("skips every area bucket for a stamp linked to no area", () => {
    const observations = [
      obs({ ratio: 0.4 }),
      obs({ ratio: 0.5 }),
      obs({ ratio: 0.6 }),
    ];
    const resolved = resolveRealizationRatio(subject({ areaId: null }), observations, FALLBACK);
    assert.equal(resolved.level, "collection");
    assert.equal(resolved.n, 3);
  });

  it("counts an observation with no area into the collection bucket only", () => {
    const observations = [
      obs({ ratio: 0.4, areaId: null }),
      obs({ ratio: 0.5, areaId: null }),
      obs({ ratio: 0.6, areaId: null }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.level, "collection");
    assert.equal(resolved.ratio, 0.5);
  });

  it("drops ratios that are not a figure about a price", () => {
    const observations = [
      obs({ ratio: 0.5 }),
      obs({ ratio: 0 }),
      obs({ ratio: Number.NaN }),
      obs({ ratio: Number.POSITIVE_INFINITY }),
      obs({ ratio: -1 }),
    ];
    assert.equal(resolveRealizationRatio(subject(), observations, FALLBACK).level, "fallback");
  });
});

describe("resolveRealizationRatio — split-lot dedup", () => {
  it("counts one twenty-line dealer lot once", () => {
    const observations = Array.from({ length: 20 }, () =>
      obs({ lotId: "mixed-lot", split: true, ratio: 0.9 })
    );
    assert.equal(resolveRealizationRatio(subject(), observations, FALLBACK).level, "fallback");
  });

  it("lets whole datapoints from one lot count individually", () => {
    // A single-line lot yields one whole datapoint, so the lot ids differ in practice; the rule is
    // that `split: false` is never deduplicated even when they do not.
    const observations = [
      obs({ lotId: "lot-x", ratio: 0.4 }),
      obs({ lotId: "lot-x", ratio: 0.5 }),
      obs({ lotId: "lot-x", ratio: 0.6 }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    assert.equal(resolved.n, 3);
    assert.equal(resolved.ratio, 0.5);
  });

  it("does not let a split lot outvote the whole ones beside it", () => {
    const observations = [
      obs({ lotId: "split", split: true, ratio: 0.9 }),
      obs({ lotId: "split", split: true, ratio: 0.9 }),
      obs({ lotId: "split", split: true, ratio: 0.9 }),
      obs({ ratio: 0.4 }),
      obs({ ratio: 0.5 }),
    ];
    const resolved = resolveRealizationRatio(subject(), observations, FALLBACK);
    // Three observations survive: the lot once, plus the two whole ones.
    assert.equal(resolved.n, 3);
    assert.equal(resolved.ratio, 0.5);
  });

  it("gives a lot spanning two buckets one observation in each", () => {
    const observations = [
      obs({ lotId: "wide", split: true, ratio: 0.9, conditionId: "used" }),
      obs({ lotId: "wide", split: true, ratio: 0.9, conditionId: "mnh" }),
      obs({ ratio: 0.3, conditionId: "used" }),
      obs({ ratio: 0.3, conditionId: "fine" }),
    ];
    // Bucket 3 (area) sees the lot once beside the two whole ones — three, not four.
    const resolved = resolveRealizationRatio(subject({ conditionId: "other" }), observations, FALLBACK);
    assert.equal(resolved.level, "area");
    assert.equal(resolved.n, 3);
  });
});

describe("ratioBucketLabel", () => {
  const names = { areaName: "Polska Ludowa", conditionName: "MNH" };

  it("names the period bucket in full", () => {
    const resolved = {
      ratio: 0.55,
      level: "area-condition-period" as const,
      n: 6,
      observations: [],
      fromYear: 1945,
      toYear: 1949,
    };
    assert.equal(ratioBucketLabel(resolved, names), "Polska Ludowa, MNH, 1945–1949");
  });

  it("drops the axes a broader bucket did not use", () => {
    const base = { ratio: 0.55, n: 6, observations: [], fromYear: null, toYear: null };
    assert.equal(ratioBucketLabel({ ...base, level: "area-condition" }, names), "Polska Ludowa, MNH");
    assert.equal(ratioBucketLabel({ ...base, level: "area" }, names), "Polska Ludowa");
    assert.equal(ratioBucketLabel({ ...base, level: "collection" }, names), "All recorded results");
    assert.equal(ratioBucketLabel({ ...base, level: "fallback" }, names), "No recorded results");
  });

  it("leaves a name it could not resolve out rather than blank", () => {
    const resolved = {
      ratio: 0.55,
      level: "area-condition" as const,
      n: 6,
      observations: [],
      fromYear: null,
      toYear: null,
    };
    assert.equal(ratioBucketLabel(resolved, { areaName: null, conditionName: "MNH" }), "MNH");
    assert.equal(
      ratioBucketLabel(resolved, { areaName: null, conditionName: null }),
      "All recorded results"
    );
  });
});
